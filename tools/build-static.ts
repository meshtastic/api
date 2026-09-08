/**
 * Emits everything that belongs in R2, plus a manifest describing exactly how each object must be
 * uploaded (key, local path, content-type). The publisher reads the manifest rather than globbing
 * a directory, so an object can never be uploaded with an inferred content-type -- extensionless
 * keys silently become binary/octet-stream under `aws s3 sync`, which breaks strict JSON clients.
 *
 * ATTRIBUTION.md lives in static/maintenanceUf2/ and is deliberately NOT published: this walks an
 * explicit list, never a directory.
 */

import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { sha256 } from "./canonical.js";
import { collectEraseImages } from "./eraseImages.js";

export interface Entry {
  /** R2 object key. */
  readonly key: string;
  /** Path under dist-static/ that holds the bytes. */
  readonly file: string;
  readonly contentType: string;
  readonly bytes: number;
  readonly sha256: string;
  /** R2's ETag is the object's MD5, so the publisher can verify an upload without re-downloading. */
  readonly md5: string;
}

const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));

const OUT = "dist-static";

const ICONS = [
  "burningman2026.png",
  "defcon34.png",
  "dragoncon2026.png",
  "fab26.png",
  "hamvention.png",
];

// Every .uf2 the manifest can name, read FROM the manifest via the same helper validate.ts uses.
// It was a hardcoded list of three, with a comment asserting validate.ts cross-checked it; that
// cross-check read only the `nrf52` and `rp2040` keys, so `erase.nrf52Bootloader` was published in
// the manifest and never uploaded -- a 404 on the one flow ending in a bootloader write. Deriving
// it makes that class of drift impossible rather than merely checked for.
//
// This is still an explicit per-file emit with a stated content-type, never a directory glob, so
// ATTRIBUTION.md stays unpublished.
const UF2S = collectEraseImages(readJson("data/maintenanceUf2.json").erase).map(
  (e) => e.fileName,
);

const entries: Entry[] = [];

const emit = (key: string, source: string, contentType: string): void => {
  const rel = key.replace(/^v1\//, "");
  const dest = `${OUT}/${rel}`;
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(source, dest);
  const bytes = readFileSync(dest);
  entries.push({
    key,
    file: rel,
    contentType,
    bytes: bytes.length,
    sha256: sha256(bytes),
    md5: createHash("md5").update(bytes).digest("hex"),
  });
};

mkdirSync(OUT, { recursive: true });

for (const icon of ICONS) {
  emit(
    `v1/resource/eventFirmware/icons/${icon}`,
    `static/eventFirmware/${icon}`,
    "image/png",
  );
}
for (const uf2 of UF2S) {
  emit(
    `v1/resource/maintenanceUf2/asset/${uf2}`,
    `static/maintenanceUf2/${uf2}`,
    "application/octet-stream",
  );
}
emit("v1/favicon.ico", "static/favicon.ico", "image/x-icon");

writeFileSync(`${OUT}/manifest.json`, JSON.stringify(entries, null, 2));

let total = 0;
for (const e of entries) {
  total += e.bytes;
  console.log(
    `${e.key.padEnd(52)} ${String(e.bytes).padStart(9)} B  ${e.contentType}`,
  );
}
console.log(
  `${String(entries.length).padStart(2)} objects, ${(total / 1024 / 1024).toFixed(2)} MB`,
);
