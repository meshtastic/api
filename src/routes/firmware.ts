import { app } from "../index.js";
import { GitHub, redis } from "../lib/index.js";

export interface FirmwareReleases {
  releases: {
    stable: GitHub.DeviceFirmwareResource[];
    alpha: GitHub.DeviceFirmwareResource[];
  };
  pullRequests: GitHub.DeviceFirmwareResource[];
}

export const FirmwareRoutes = () => {
  return app.get("/github/firmware/list", async (_, res) => {
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
          let zip_url: string | undefined;
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
              zip_url = matches[1];
            }
          }

          return <GitHub.DeviceFirmwareResource>{
            id: pr.number.toString(),
            title: pr.title,
            page_url: pr.html_url,
            zip_url: zip_url,
          };
        }),
      );

      const firmwareReleases: FirmwareReleases = {
        releases: {
          stable: releases
            .filter((r) => !r.prerelease)
            .map((release) => {
              return <GitHub.DeviceFirmwareResource>{
                id: release.tag_name,
                title: release.name,
                page_url: release.html_url,
                zip_url: release.assets.find((asset) =>
                  asset.name.startsWith("firmware-"),
                )?.browser_download_url,
              };
            }),
          alpha: releases
            .filter((r) => r.prerelease)
            .map((release) => {
              return <GitHub.DeviceFirmwareResource>{
                id: release.tag_name,
                title: release.name,
                page_url: release.html_url,
                zip_url: release.assets.find((asset) =>
                  asset.name.startsWith("firmware-"),
                )?.browser_download_url,
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
