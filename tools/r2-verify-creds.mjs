/**
 * Proves an R2 Access Key ID / Secret Access Key pair actually works, before anything stores it.
 *
 * Does a minimal SigV4-signed ListObjectsV2 against the bucket. Written by hand rather than
 * pulling in the AWS SDK because this repo's Worker has zero runtime dependencies and the tooling
 * should not be the thing that reintroduces a dependency chain -- and because `aws` is not
 * necessarily installed locally.
 *
 * Reads credentials from the environment so they never appear in a process listing:
 *   R2_ACCOUNT_ID R2_BUCKET R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY
 *
 * Exit 0 = credentials work. Exit 1 = they do not, with the reason.
 */
import { createHash, createHmac } from "node:crypto";

const {
  R2_ACCOUNT_ID: account,
  R2_BUCKET: bucket,
  R2_ACCESS_KEY_ID: accessKeyId,
  R2_SECRET_ACCESS_KEY: secretAccessKey,
} = process.env;

for (const [k, v] of Object.entries({
  account,
  bucket,
  accessKeyId,
  secretAccessKey,
})) {
  if (!v) {
    console.error(`missing ${k}`);
    process.exit(2);
  }
}

const sha256hex = (data) => createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

const host = `${account}.r2.cloudflarestorage.com`;
const region = "auto"; // R2 always signs as "auto"
const service = "s3";

// Cheapest call that still proves both authentication and bucket access.
const query = "list-type=2&max-keys=1";
const canonicalUri = `/${bucket}`;

const now = new Date();
const amzDate = `${now.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
const dateStamp = amzDate.slice(0, 8);
const emptyHash = sha256hex("");

const canonicalHeaders =
  `host:${host}\n` +
  `x-amz-content-sha256:${emptyHash}\n` +
  `x-amz-date:${amzDate}\n`;
const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

const canonicalRequest = [
  "GET",
  canonicalUri,
  query,
  canonicalHeaders,
  signedHeaders,
  emptyHash,
].join("\n");

const scope = `${dateStamp}/${region}/${service}/aws4_request`;
const stringToSign = [
  "AWS4-HMAC-SHA256",
  amzDate,
  scope,
  sha256hex(canonicalRequest),
].join("\n");

const signingKey = ["aws4_request"].reduce(
  (k, part) => hmac(k, part),
  [region, service].reduce(
    (k, part) => hmac(k, part),
    hmac(`AWS4${secretAccessKey}`, dateStamp),
  ),
);
const signature = createHmac("sha256", signingKey)
  .update(stringToSign)
  .digest("hex");

const authorization =
  `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
  `SignedHeaders=${signedHeaders}, Signature=${signature}`;

const res = await fetch(`https://${host}${canonicalUri}?${query}`, {
  headers: {
    host,
    "x-amz-content-sha256": emptyHash,
    "x-amz-date": amzDate,
    authorization,
  },
});

if (res.ok) {
  const body = await res.text();
  const n = (body.match(/<Key>/g) ?? []).length;
  console.log(
    `OK: authenticated against ${bucket} (${n > 0 ? "bucket has objects" : "bucket is empty"})`,
  );
  process.exit(0);
}

const body = await res.text();
const code =
  (/<Code>([^<]+)<\/Code>/.exec(body) ?? [])[1] ?? `HTTP ${res.status}`;
const hints = {
  // R2 answers a bad Access Key ID with a bare "Unauthorized" rather than S3's InvalidAccessKeyId,
  // so both are mapped -- observed against the live endpoint.
  Unauthorized:
    "R2 rejected the credentials outright -- usually a wrong Access Key ID, or a token from a different Cloudflare account",
  InvalidAccessKeyId:
    "the Access Key ID is not recognised -- wrong value, or from a different Cloudflare account",
  SignatureDoesNotMatch:
    "the Secret Access Key does not match the Access Key ID -- one of the two is wrong or mis-pasted",
  AccessDenied:
    "the credentials are valid but not permitted on this bucket -- check the token is scoped to it, with Object Read & Write",
  NoSuchBucket: "the bucket does not exist in this account",
};
console.error(`FAILED: ${code}`);
if (hints[code]) console.error(`  ${hints[code]}`);
process.exit(1);
