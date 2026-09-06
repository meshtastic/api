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
  expectedFamilyId?: number;
}

const manifest = JSON.parse(readFileSync(DATA_PATH, "utf8")) as {
  manifestVersion: number;
  otafixReleaseTag: string;
  otafixBase: string;
  erase: {
    nrf52: Record<string, EraseImageEntry>;
    nrf52Bootloader?: EraseImageEntry;
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

// --- bootloader-consumed erase image: one UF2 block whose family ID is the whole contract ---
// The OTAFIX bootloader acts on this file by family ID alone (targetAddr is 0, so the clients'
// first-target-address check does not apply); a wrong family here would make every device treat
// it as an ordinary firmware block. Check the header the way the bootloader reads it.
const UF2_BLOCK_SIZE = 512;
const UF2_MAGIC0 = 0x0a324655;
const UF2_MAGIC1 = 0x9e5d5157;
const UF2_MAGIC_END = 0x0ab16f30;
const UF2_FLAG_FAMILY_ID_PRESENT = 0x2000;

const checkUf2FamilyBlock = (
  bytes: Buffer,
  expectedFamilyId: number,
  where: string,
) => {
  if (bytes.length !== UF2_BLOCK_SIZE) {
    fail(
      `${where}: expected exactly one ${UF2_BLOCK_SIZE}-byte UF2 block, got ${bytes.length} bytes`,
    );
    return;
  }
  const magic0 = bytes.readUInt32LE(0);
  const magic1 = bytes.readUInt32LE(4);
  const flags = bytes.readUInt32LE(8);
  const familyId = bytes.readUInt32LE(28);
  const magicEnd = bytes.readUInt32LE(508);
  if (magic0 !== UF2_MAGIC0 || magic1 !== UF2_MAGIC1) {
    fail(
      `${where}: bad UF2 start magic 0x${magic0.toString(16)}/0x${magic1.toString(16)}`,
    );
  }
  if (magicEnd !== UF2_MAGIC_END) {
    fail(`${where}: bad UF2 end magic 0x${magicEnd.toString(16)}`);
  }
  if ((flags & UF2_FLAG_FAMILY_ID_PRESENT) === 0) {
    fail(
      `${where}: UF2 flags 0x${flags.toString(16)} lack the family-ID-present bit`,
    );
  }
  if (familyId !== expectedFamilyId) {
    fail(
      `${where}: UF2 family ID 0x${familyId.toString(16)}, manifest expects 0x${expectedFamilyId.toString(16)}`,
    );
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
    if (entry.expectedFamilyId !== undefined) {
      checkUf2FamilyBlock(bytes, entry.expectedFamilyId, where);
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
if (manifest.erase.nrf52Bootloader) {
  checkEraseEntry(manifest.erase.nrf52Bootloader, "erase.nrf52Bootloader");
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
