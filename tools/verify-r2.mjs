/**
 * Verifies every object the publisher just uploaded is actually in R2, with the right bytes and
 * the right content-type.
 *
 * This HEADs the S3 endpoint via `aws s3api`, NOT the public hostname. A HEAD through the CDN is
 * answered from cache and, on a compressed response, returns a weakened/transformed ETag -- so it
 * would both re-upload everything on every run and, far worse, report "unchanged" for an object
 * R2 does not actually hold. Shelling out to the AWS CLI also means no SigV4 implementation and
 * no SDK dependency here.
 *
 * A mismatch fails the job loudly rather than leaving a half-published bucket behind.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const bucket = process.env.R2_BUCKET;
const endpoint = process.env.R2_ENDPOINT;
if (!bucket || !endpoint) {
  console.error("R2_BUCKET and R2_ENDPOINT must be set");
  process.exit(2);
}

const manifest = JSON.parse(readFileSync("dist-static/manifest.json", "utf8"));
const extra = JSON.parse(process.env.EXTRA_KEYS ?? "[]");
const wanted = [...manifest, ...extra];

const problems = [];
for (const e of wanted) {
  let head;
  try {
    head = JSON.parse(
      execFileSync(
        "aws",
        [
          "s3api",
          "head-object",
          "--bucket",
          bucket,
          "--key",
          e.key,
          "--endpoint-url",
          endpoint,
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ),
    );
  } catch {
    problems.push(`${e.key}: MISSING from R2`);
    continue;
  }

  if (typeof e.bytes === "number" && head.ContentLength !== e.bytes) {
    problems.push(
      `${e.key}: size ${head.ContentLength} in R2, expected ${e.bytes}`,
    );
  }
  // R2's ETag is the MD5 for a single-part upload. Multipart uploads get "<hash>-<n>", which we
  // cannot compare this way -- every object here is far below the multipart threshold, so a
  // suffixed ETag means something uploaded in a way we did not intend.
  if (e.md5) {
    const etag = (head.ETag ?? "").replace(/"/g, "");
    if (etag.includes("-")) {
      problems.push(
        `${e.key}: multipart ETag ${etag} -- expected a single-part upload`,
      );
    } else if (etag !== e.md5) {
      problems.push(`${e.key}: ETag ${etag} in R2, expected ${e.md5}`);
    }
  }
  if (e.contentType && head.ContentType !== e.contentType) {
    problems.push(
      `${e.key}: content-type "${head.ContentType}" in R2, expected "${e.contentType}"`,
    );
  }
}

if (problems.length > 0) {
  console.error(`\nR2 verification failed (${problems.length}):\n`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`verify-r2: OK (${wanted.length} objects)`);
