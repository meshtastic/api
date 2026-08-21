import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// Validates data/maintenanceUf2.json's invariants in CI. This replaces the guarantee
// Meshtastic-Android's SoftDeviceQuirkCoverageTest + Kotlin require()/board-ID-uniqueness test
// used to provide for this data when it lived only in that repo — now that it's authored here,
// this repo needs its own check, or a bad edit ships silently to every client.
//
// A failure here means: do not merge. This data gates an irreversible write.

const DATA_PATH = new URL("../data/maintenanceUf2.json", import.meta.url);
const ASSET_DIR = new URL("../static/maintenanceUf2/", import.meta.url);

const SHA256_RE = /^[0-9a-f]{64}$/;
const FILENAME_RE = /^[a-z0-9_.-]+\.uf2$/;
const BOARD_RE = /^[a-z0-9_]+$/;

const errors: string[] = [];
const fail = (msg: string) => errors.push(msg);

interface EraseImageEntry {
  fileName: string;
  sha256: string;
  expectedFirstTargetAddress?: number;
}

const manifest = JSON.parse(readFileSync(DATA_PATH, "utf8")) as {
  manifestVersion: number;
  otafixReleaseTag: string;
  otafixBase: string;
  erase: {
    nrf52: Record<string, EraseImageEntry>;
    rp2040: EraseImageEntry;
  };
  otafixByBoardId: Record<string, { otafixBoardSlug: string; sha256: string }>;
  otafixSupportedTargets: string[];
};

const checkFileName = (fileName: string, where: string) => {
  if (
    fileName.includes("/") ||
    fileName.includes("\\") ||
    fileName.includes("..")
  ) {
    fail(`${where}: unsafe fileName "${fileName}"`);
    return;
  }
  if (!FILENAME_RE.test(fileName)) {
    fail(`${where}: fileName "${fileName}" doesn't match ${FILENAME_RE}`);
  }
};

const checkSha256 = (sha256: string, where: string) => {
  if (!SHA256_RE.test(sha256)) {
    fail(`${where}: sha256 "${sha256}" is not 64 lowercase hex chars`);
  }
};

// --- erase images: fileName/sha256 shape, and the vendored bytes actually match ---
const checkEraseEntry = (entry: EraseImageEntry, where: string) => {
  checkFileName(entry.fileName, where);
  checkSha256(entry.sha256, where);
  try {
    const bytes = readFileSync(new URL(entry.fileName, ASSET_DIR));
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== entry.sha256) {
      fail(
        `${where}: vendored ${entry.fileName} hashes to ${actual}, manifest says ${entry.sha256}`,
      );
    }
  } catch (err) {
    fail(
      `${where}: could not read static/maintenanceUf2/${entry.fileName}: ${(err as Error).message}`,
    );
  }
};

let eraseImageCount = 0;
for (const [softDevice, entry] of Object.entries(manifest.erase.nrf52)) {
  checkEraseEntry(entry, `erase.nrf52["${softDevice}"]`);
  eraseImageCount++;
}
checkEraseEntry(manifest.erase.rp2040, "erase.rp2040");
eraseImageCount++;

// --- OTAFIX board map: unique non-blank Board-IDs, valid board slugs, valid digests ---
const seenBoardIds = new Set<string>();
const seenBoardSlugs = new Set<string>();
for (const [boardId, entry] of Object.entries(manifest.otafixByBoardId)) {
  if (!boardId.trim()) fail("otafixByBoardId: blank Board-ID key");
  if (seenBoardIds.has(boardId))
    fail(`otafixByBoardId: duplicate Board-ID "${boardId}"`);
  seenBoardIds.add(boardId);

  if (!BOARD_RE.test(entry.otafixBoardSlug)) {
    fail(
      `otafixByBoardId["${boardId}"]: otafixBoardSlug "${entry.otafixBoardSlug}" doesn't match ${BOARD_RE}`,
    );
  }
  if (seenBoardSlugs.has(entry.otafixBoardSlug)) {
    fail(
      `otafixByBoardId["${boardId}"]: otafixBoardSlug "${entry.otafixBoardSlug}" reused by another Board-ID`,
    );
  }
  seenBoardSlugs.add(entry.otafixBoardSlug);
  checkSha256(entry.sha256, `otafixByBoardId["${boardId}"]`);
}

// --- supported targets: no duplicates ---
const seenTargets = new Set<string>();
for (const target of manifest.otafixSupportedTargets) {
  if (seenTargets.has(target))
    fail(`otafixSupportedTargets: duplicate "${target}"`);
  seenTargets.add(target);
}

if (errors.length > 0) {
  console.error(
    `maintenanceUf2.json failed validation (${errors.length} issue(s)):`,
  );
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  `maintenanceUf2.json OK: ${eraseImageCount} erase image(s), ` +
    `${Object.keys(manifest.otafixByBoardId).length} OTAFIX board(s), ` +
    `${manifest.otafixSupportedTargets.length} supported target(s).`,
);
