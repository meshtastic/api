/**
 * Regenerates the two GitHub-derived documents: /github/firmware/list and /github/releases.
 *
 * Deliberately uses bare fetch rather than octokit. Octokit is what dragged in the
 * jwa -> buffer.SlowBuffer import chain that stopped the server booting on a newer Node, and none
 * of its features are needed here. But it was also supplying two things implicitly that GitHub
 * requires, so they are explicit below:
 *
 *   - User-Agent. GitHub rejects API requests without one. Octokit sent "meshtastic-api v1".
 *   - The default per_page of 30. The live /github/releases returns exactly 30 entries, so the
 *     absence of a per_page parameter is part of the observable contract. Do not add one.
 *
 * Two upstream bugs are reproduced ON PURPOSE, because this must be byte-comparable against the
 * old server during the migration. Both are filed separately and fixed after cutover, never here:
 *
 *   - pullRequests[].zip_url is whatever the FIRST markdown link in the github-actions[bot]
 *     comment happens to be, which today is a Discord invite for every entry.
 *   - zip_url picks the first asset whose name starts with "firmware-", which for some releases
 *     is a .json manifest rather than a zip.
 */
const OWNER = "meshtastic";
const REPO = "firmware";
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;

const headers = {
  "user-agent": "meshtastic-api v1",
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
  ...(process.env.GITHUB_TOKEN
    ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    : {}),
};

const gh = async (url) => {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GitHub ${res.status} ${res.statusText} for ${url}`);
  }
  return res.json();
};

// Matches the old server's GitHub.FirmwareLinkRegex.
const FIRMWARE_LINK_RE = /\(([^)]+)\)/;

const zipUrlOf = (release) =>
  release.assets.find((a) => a.name.startsWith("firmware-"))
    ?.browser_download_url;

/** JSON.stringify drops undefined keys entirely -- that is how the old server behaved, so a
 *  release with no matching asset has NO zip_url key at all. Never substitute null. */
const toResource = (release) => ({
  id: release.tag_name,
  title: release.name,
  page_url: release.html_url,
  zip_url: zipUrlOf(release),
  release_notes: release.body,
});

export const buildDocuments = async () => {
  const allReleases = await gh(`${API}/releases`);

  // /github/releases: every release, unfiltered.
  const releasesDoc = allReleases.map(toResource);

  // /github/firmware/list: major version > 1, and not revoked.
  const releases = allReleases
    .filter((r) => Number.parseInt(r.tag_name.substring(1, 2)) > 1)
    .filter((r) => !r.name?.includes("(Revoked)"));

  const prs = await gh(`${API}/pulls`);
  const prArtifacts = await Promise.all(
    prs.map(async (pr) => {
      let zipUrl;
      const comments = await gh(pr.comments_url);
      const botComments = comments.filter(
        (c) => c.user.login === "github-actions[bot]",
      );
      if (botComments.length > 0) {
        const m = FIRMWARE_LINK_RE.exec(botComments[0].body);
        if (m && m.length > 0) zipUrl = m[1];
      }
      return {
        id: pr.number.toString(),
        title: pr.title,
        page_url: pr.html_url,
        zip_url: zipUrl,
      };
    }),
  );

  const firmwareList = {
    releases: {
      stable: releases.filter((r) => !r.prerelease).map(toResource),
      alpha: releases.filter((r) => r.prerelease).map(toResource),
    },
    pullRequests: prArtifacts.filter((pr) => pr.zip_url),
  };

  return { firmwareList, releasesDoc };
};

/**
 * Validation gate. On failure the publisher does NOT write, so the object already in R2 keeps
 * serving -- a stale list is strictly better than a truncated one.
 *
 * The thresholds are RELATIVE, never absolute. Only 2 of the current 30 releases are stable, so a
 * burst of alphas can legitimately push stable off the page; a hardcoded floor would fire on
 * ordinary upstream behaviour and train everyone to ignore it.
 */
export const validate = (firmwareList, releasesDoc, previous) => {
  const problems = [];

  for (const key of ["stable", "alpha"]) {
    if (!Array.isArray(firmwareList.releases[key])) {
      problems.push(`releases.${key} is missing`);
    }
  }
  if (!Array.isArray(firmwareList.pullRequests)) {
    // meshtastic/c-sharp deserializes this into a positional record that throws on a missing
    // member, so an absent key is worse than an empty array.
    problems.push("pullRequests is missing");
  }

  const all = [
    ...(firmwareList.releases.stable ?? []),
    ...(firmwareList.releases.alpha ?? []),
  ];
  for (const r of all) {
    // zip_url and release_notes are OPTIONAL: release v2.8.0.47db0e3 is live right now carrying
    // only id/page_url/release_notes/title, and a validator demanding all four would reject the
    // exact payload production is serving.
    for (const k of ["id", "title", "page_url"]) {
      if (!r[k]) problems.push(`release ${r.id ?? "?"} has empty ${k}`);
    }
  }

  if (releasesDoc.length !== 30) {
    problems.push(
      `/github/releases returned ${releasesDoc.length} entries, expected 30`,
    );
  }

  if (previous) {
    const before = previous.releases?.stable?.length ?? 0;
    const now = firmwareList.releases.stable.length;
    if (before > 0 && now === 0) {
      problems.push(`stable dropped from ${before} to 0`);
    }
    const shrink =
      JSON.stringify(firmwareList).length / JSON.stringify(previous).length;
    if (shrink < 0.5) {
      problems.push(
        `payload shrank to ${(shrink * 100).toFixed(0)}% of the previous one`,
      );
    }
  }

  return problems;
};
