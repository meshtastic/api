/**
 * Proves a Cloudflare API token is valid and carries the permissions the deploy needs, before
 * anything stores it. Reads CLOUDFLARE_API_TOKEN from the environment so the value never appears
 * in a process listing, and never prints it.
 *
 * Exists because an invalid token is not visibly different from a valid one until a deploy fails
 * with "Invalid access token [code: 9109]", several steps into a job, long after the paste.
 */
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) {
  console.error("missing CLOUDFLARE_API_TOKEN");
  process.exit(2);
}

const api = "https://api.cloudflare.com/client/v4";
const auth = { authorization: `Bearer ${token}` };

const verify = await (
  await fetch(`${api}/user/tokens/verify`, { headers: auth })
).json();
if (!verify.success) {
  const err = verify.errors?.[0];
  console.error(
    `FAILED: ${err?.message ?? "token rejected"} (code ${err?.code ?? "?"})`,
  );
  if (err?.code === 1000) {
    console.error(
      "  The token does not exist. It was mistyped, revoked, or is a different kind",
    );
    console.error(
      "  of credential -- an R2 Access Key ID/Secret is NOT a Cloudflare API token.",
    );
  }
  process.exit(1);
}
console.log(`OK: token is ${verify.result.status}`);

// A valid token with the wrong permissions fails later and just as opaquely, so check the two
// things the deploy actually does: list accounts, and reach the bucket's account.
const accounts = await (
  await fetch(`${api}/accounts`, { headers: auth })
).json();
if (!accounts.success) {
  console.error(
    "FAILED: the token cannot list accounts -- it needs Account Settings: Read",
  );
  process.exit(1);
}
const names = (accounts.result ?? []).map(
  (a) => `${a.name} (${a.id.slice(0, 8)}...)`,
);
console.log(`OK: sees ${names.length} account(s): ${names.join(", ")}`);

const wanted = process.env.CLOUDFLARE_ACCOUNT_ID;
if (wanted && !(accounts.result ?? []).some((a) => a.id === wanted)) {
  console.error(
    `FAILED: the token cannot see account ${wanted.slice(0, 8)}... -- it was probably`,
  );
  console.error(
    "  created in a different Cloudflare account than the one holding the bucket.",
  );
  process.exit(1);
}
if (wanted) console.log("OK: token can see the account that holds the bucket");
