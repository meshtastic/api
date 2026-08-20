import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Run by .github/workflows/sync-maintenance-uf2.yml, manually dispatched by whoever cuts a new
// OTAFIX release — never scheduled, and never auto-merged. Unlike deviceLinks.json (a pure
// pass-through catalog), this data gates an irreversible bootloader write, so a new board's
// Board-ID needs a human to confirm it on real hardware before it's trusted; this script updates
// digests for boards it already knows and calls out anything it doesn't, rather than guessing.
//
// Usage: tsx scripts/sync-maintenance-uf2.ts <otafixReleaseTag>

const REPO = "meshtastic/Adafruit_nRF52_Bootloader_OTAFIX";
const DATA_PATH = new URL("../data/maintenanceUf2.json", import.meta.url);
const ASSET_FILE_RE = /^update-(.+)_bootloader-(.+)_nosd\.uf2$/;

interface Manifest {
  manifestVersion: number;
  otafixReleaseTag: string;
  otafixBase: string;
  erase: Record<
    string,
    { fileName: string; sha256: string; expectedFirstTargetAddress?: number }
  >;
  otafixByBoardId: Record<string, { board: string; sha256: string }>;
  otafixSupportedTargets: string[];
}

const tag = process.argv[2];
if (!tag) {
  console.error(
    "usage: tsx scripts/sync-maintenance-uf2.ts <otafixReleaseTag>",
  );
  process.exit(1);
}

const manifest: Manifest = JSON.parse(readFileSync(DATA_PATH, "utf8"));

const workdir = mkdtempSync(join(tmpdir(), "otafix-sync-"));
console.log(
  `Downloading release assets for ${REPO}@${tag} into ${workdir} ...`,
);
execFileSync(
  "gh",
  [
    "release",
    "download",
    tag,
    "--repo",
    REPO,
    "--pattern",
    "update-*_nosd.uf2",
    "--dir",
    workdir,
  ],
  {
    stdio: "inherit",
  },
);

const boardBySlug = new Map(
  Object.entries(manifest.otafixByBoardId).map(([boardId, e]) => [
    e.board,
    boardId,
  ]),
);

const changedBoards: string[] = [];
const unmappedAssets: string[] = [];

for (const fileName of readdirSync(workdir)) {
  const match = ASSET_FILE_RE.exec(fileName);
  if (!match) continue;
  const [, board, assetTag] = match;
  if (assetTag !== tag) continue; // defensive — gh should only have downloaded this tag's assets

  const sha256 = createHash("sha256")
    .update(readFileSync(join(workdir, fileName)))
    .digest("hex");
  const boardId = boardBySlug.get(board);
  if (!boardId) {
    unmappedAssets.push(
      `${fileName} (board slug "${board}" has no Board-ID mapping yet)`,
    );
    continue;
  }

  const entry = manifest.otafixByBoardId[boardId];
  if (entry.sha256 !== sha256) {
    console.log(`  ${boardId} (${board}): digest changed`);
    entry.sha256 = sha256;
    changedBoards.push(boardId);
  }
}

manifest.otafixReleaseTag = tag;
manifest.otafixBase = `https://github.com/${REPO}/releases/download/${tag}`;

writeFileSync(DATA_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

const summaryLines = [
  `## OTAFIX sync: ${tag}`,
  "",
  changedBoards.length > 0
    ? `Digest updated for ${changedBoards.length} board(s): ${changedBoards.join(", ")}`
    : "No digest changes for already-mapped boards.",
  "",
];
if (unmappedAssets.length > 0) {
  summaryLines.push(
    `**${unmappedAssets.length} release asset(s) have no Board-ID mapping and were NOT added:**`,
    "",
    ...unmappedAssets.map((a) => `- ${a}`),
    "",
    "Someone must confirm each new board's `Board-ID:` on real hardware (read it off " +
      "`INFO_UF2.TXT` on a mounted device) before adding a row to `otafixByBoardId` — this " +
      "script will not guess a mapping.",
  );
}
writeFileSync("otafix-sync-summary.md", `${summaryLines.join("\n")}\n`);
console.log(summaryLines.join("\n"));
