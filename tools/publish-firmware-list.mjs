/**
 * Builds the two GitHub-derived documents and stages them for upload, with the validation gate in
 * front. If validation fails this exits non-zero WITHOUT writing anything, so the object already
 * in R2 keeps serving: a stale list is strictly better than a truncated or empty one.
 *
 * Usage: node tools/publish-firmware-list.mjs [--previous <path-to-current-list.json>]
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildDocuments, validate } from "./fetch-firmware-list.mjs";

const argv = process.argv.slice(2);
const previousPath = argv.includes("--previous")
  ? argv[argv.indexOf("--previous") + 1]
  : null;

const previous =
  previousPath && existsSync(previousPath)
    ? JSON.parse(readFileSync(previousPath, "utf8"))
    : null;
if (previousPath && !previous) {
  console.warn(
    `(no previous object at ${previousPath} -- relative checks skipped; expected on the first run)`,
  );
}

const { firmwareList, releasesDoc } = await buildDocuments();

const problems = validate(firmwareList, releasesDoc, previous);
if (problems.length > 0) {
  console.error(`\nrefusing to publish (${problems.length} problem(s)):\n`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const OUT = "dist-github";
mkdirSync(`${OUT}/github/firmware`, { recursive: true });

// Canonical wire format: 2-space indent, no trailing newline. Same invariant as every other
// JSON document this API serves.
const staged = [
  ["v1/github/firmware/list.json", "github/firmware/list.json", firmwareList],
  ["v1/github/releases.json", "github/releases.json", releasesDoc],
];

const manifest = staged.map(([key, file, value]) => {
  const body = JSON.stringify(value, null, 2);
  writeFileSync(`${OUT}/${file}`, body);
  return {
    key,
    file,
    contentType: "application/json",
    bytes: Buffer.byteLength(body),
    md5: createHash("md5").update(body).digest("hex"),
  };
});

writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));

for (const m of manifest) {
  console.log(`${m.key.padEnd(34)} ${String(m.bytes).padStart(8)} B`);
}
console.log(
  `stable=${firmwareList.releases.stable.length} alpha=${firmwareList.releases.alpha.length} ` +
    `pullRequests=${firmwareList.pullRequests.length} releases=${releasesDoc.length}`,
);
