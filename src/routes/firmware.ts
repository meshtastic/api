import { app } from "../index.js";
import { GitHub, redis } from "../lib/index.js";

export interface FirmwareReleases {
  releases: {
    stable: GitHub.DeviceFirmwareResource[];
    alpha: GitHub.DeviceFirmwareResource[];
  };
  pullRequests: GitHub.DeviceFirmwareResource[];
}

// Per-architecture firmware artifacts produced by the gather-artifacts job of
// the firmware CI workflow, e.g. "firmware-esp32s3-2.8.0.7a414be". The strict
// arch alternation and version shape exclude the per-board intermediate
// artifacts ("firmware-esp32s3-station-g3-2.8.0.7a414be") present on the
// same run.
const ARCH_ARTIFACT_RE =
  /^firmware-(esp32|esp32s3|esp32c3|esp32c6|nrf52840|rp2040|rp2350|stm32)-(\d+\.\d+\.\d+\.[0-9a-f]+)$/;

// The firmware CI workflow ("CI") that builds PR artifacts
const CI_WORKFLOW_FILE = "main_matrix.yml";

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const FirmwareRoutes = () => {
  app.get("/github/firmware/pr/:number", async (req, res) => {
    const prNumber = Number.parseInt(req.params.number ?? "", 10);
    if (!Number.isSafeInteger(prNumber) || prNumber <= 0) {
      return res.status(400).send({ error: "invalid_pr_number" });
    }

    const cacheKey = `gh-pr-build:${prNumber}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.send(JSON.parse(cached));
    }

    try {
      const pr = await GitHub.deviceOctokit.rest.pulls.get({
        ...GitHub.DeviceRequestOptions,
        pull_number: prNumber,
      });
      const headSha = pr.data.head.sha;

      const runs = await GitHub.deviceOctokit.rest.actions.listWorkflowRuns({
        ...GitHub.DeviceRequestOptions,
        workflow_id: CI_WORKFLOW_FILE,
        head_sha: headSha,
        status: "success",
        event: "pull_request",
        per_page: 1,
      });
      const run = runs.data.workflow_runs[0];
      if (!run) {
        return res.status(404).send({ error: "no_successful_run" });
      }

      // A PR run has 100+ artifacts (per-board intermediates, debug elfs)
      const artifacts = await GitHub.deviceOctokit.paginate(
        GitHub.deviceOctokit.rest.actions.listWorkflowRunArtifacts,
        { ...GitHub.DeviceRequestOptions, run_id: run.id, per_page: 100 },
      );

      const archArtifacts = artifacts.filter((artifact) =>
        ARCH_ARTIFACT_RE.test(artifact.name),
      );
      if (archArtifacts.length === 0) {
        return res.status(404).send({ error: "no_artifacts" });
      }
      const live = archArtifacts.filter((artifact) => !artifact.expired);
      if (live.length === 0) {
        return res.status(410).send({ error: "artifacts_expired" });
      }

      const version = ARCH_ARTIFACT_RE.exec(live[0].name)?.[2] ?? "";

      // Per-board manifest artifacts ("manifest-{platform}-{board}-{version}")
      // enumerate the boards built by this run. Platform directories contain
      // no dashes, so the first dash-delimited token is always the platform.
      const boardRe = new RegExp(
        `^manifest-([a-z0-9]+)-(.+)-${escapeRegex(version)}$`,
      );
      const targets = artifacts
        .map((artifact) => boardRe.exec(artifact.name))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => ({ board: match[2], platform: match[1] }));

      const payload = {
        pr: {
          number: pr.data.number,
          title: pr.data.title,
          page_url: pr.data.html_url,
          author: pr.data.user?.login ?? "",
          head_sha: headSha,
          state: pr.data.state,
          merged: pr.data.merged,
        },
        run_id: run.id,
        version,
        expires_at: live
          .map((artifact) => artifact.expires_at)
          .filter((date): date is string => !!date)
          .sort()[0],
        artifacts: live.map((artifact) => ({
          arch: ARCH_ARTIFACT_RE.exec(artifact.name)?.[1] ?? "",
          artifact_id: artifact.id,
          name: artifact.name,
          size_in_bytes: artifact.size_in_bytes,
          expires_at: artifact.expires_at,
        })),
        targets,
      };

      redis.set(cacheKey, JSON.stringify(payload), { EX: 120 });
      return res.send(payload);
    } catch (error) {
      if ((error as { status?: number }).status === 404) {
        return res.status(404).send({ error: "pr_not_found" });
      }
      console.error(`Error resolving PR build for #${prNumber}:`, error);
      return res.status(502).send({ error: "github_error" });
    }
  });

  app.get("/github/firmware/artifact/:id/download", async (req, res) => {
    const artifactId = Number.parseInt(req.params.id ?? "", 10);
    if (!Number.isSafeInteger(artifactId) || artifactId <= 0) {
      return res.status(400).send({ error: "invalid_artifact_id" });
    }

    try {
      // redirect: "manual" surfaces GitHub's short-lived signed download URL
      // instead of following it, so the client can fetch the bytes directly
      // (the storage host sends Access-Control-Allow-Origin: *)
      const response = await GitHub.deviceOctokit.rest.actions.downloadArtifact(
        {
          ...GitHub.DeviceRequestOptions,
          artifact_id: artifactId,
          archive_format: "zip",
          request: { redirect: "manual" },
        },
      );
      const location =
        (response.headers as { location?: string }).location ?? response.url;
      if (!location) {
        return res.status(502).send({ error: "no_redirect_location" });
      }
      // The signed URL expires within minutes; never cache this response
      return res.redirect(location, 302);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 410) {
        return res.status(410).send({ error: "artifact_expired" });
      }
      if (status === 404) {
        return res.status(404).send({ error: "artifact_not_found" });
      }
      console.error(`Error resolving artifact download ${artifactId}:`, error);
      return res.status(502).send({ error: "github_error" });
    }
  });

  return app.get("/github/firmware/list", async (_req, res) => {
    const releaseCache = await redis.get("gh-releases");

    if (releaseCache) {
      res.send(JSON.parse(releaseCache));
    } else {
      const releases = (
        await GitHub.deviceOctokit.rest.repos.listReleases(
          GitHub.DeviceRequestOptions,
        )
      ).data
        .filter((r) => Number.parseInt(r.tag_name.substring(1, 2)) > 1)
        .filter((r) => !r.name?.includes("(Revoked)"));
      const prs = await GitHub.deviceOctokit.rest.pulls.list(
        GitHub.DeviceRequestOptions,
      );

      const prArtifacts = await Promise.all(
        prs.data.map(async (pr) => {
          let zipUrl: string | undefined;
          const comments = await GitHub.deviceOctokit.request(pr.comments_url);
          const artifactComments = comments.data.filter(
            (comment: { user: { login: string } }) =>
              comment.user.login === "github-actions[bot]",
          );

          if (artifactComments.length > 0) {
            const matches = GitHub.FirmwareLinkRegex.exec(
              artifactComments[0].body,
            );
            if (matches && matches.length > 0) {
              zipUrl = matches[1];
            }
          }

          return <GitHub.DeviceFirmwareResource>{
            id: pr.number.toString(),
            title: pr.title,
            page_url: pr.html_url,
            zip_url: zipUrl,
          };
        }),
      );

      // Firmware is now separated & suffixed by platform (e.g. firmware-esp32) as of 2.5.5
      // If we don't find a result (or it's not provided), fallback to the old firmware- prefix
      // to avoid a breaking change to the API
      const filteredString: string = `firmware-$req.query.platform·??·""`;

      const firmwareReleases: FirmwareReleases = {
        releases: {
          stable: releases
            .filter((r) => !r.prerelease)
            .map((release) => {
              return <GitHub.DeviceFirmwareResource>{
                id: release.tag_name,
                title: release.name,
                page_url: release.html_url,
                zip_url: (
                  release.assets.find((asset) =>
                    asset.name.startsWith(filteredString),
                  ) ??
                  release.assets.find((asset) =>
                    asset.name.startsWith("firmware-"),
                  )
                )?.browser_download_url,
                release_notes: release.body,
              };
            }),
          alpha: releases
            .filter((r) => r.prerelease)
            .map((release) => {
              return <GitHub.DeviceFirmwareResource>{
                id: release.tag_name,
                title: release.name,
                page_url: release.html_url,
                zip_url: (
                  release.assets.find((asset) =>
                    asset.name.startsWith(filteredString),
                  ) ??
                  release.assets.find((asset) =>
                    asset.name.startsWith("firmware-"),
                  )
                )?.browser_download_url,
                release_notes: release.body,
              };
            }),
        },
        pullRequests: prArtifacts.filter((pr) => pr.zip_url),
      };
      redis.set("gh-releases", JSON.stringify(firmwareReleases), {
        EX: 120,
      });
      res.send(firmwareReleases);
    }
  });
};
