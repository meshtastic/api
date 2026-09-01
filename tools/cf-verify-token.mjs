/**
 * Proves a Cloudflare API token works for what the deploy actually needs, before anything stores
 * it. Reads CLOUDFLARE_API_TOKEN (and optionally CLOUDFLARE_ACCOUNT_ID) from the environment so
 * the value never appears in a process listing, and never prints it.
 *
 * Cloudflare issues TWO kinds of token and they verify at different endpoints:
 *
 *   user-owned    (cfut_)  My Profile   -> API Tokens   ->  /user/tokens/verify
 *   account-owned (cfat_)  Manage Account -> API Tokens ->  /accounts/{id}/tokens/verify
 *
 * An account-owned token returns "Invalid API Token" from the USER endpoint -- it is not invalid,
 * it is simply not a user token. Checking only the user endpoint therefore reports a perfectly
 * good token as dead, which is exactly the false alarm this file was written to prevent and then
 * caused. Both are tried before concluding anything.
 *
 * For the same reason there is no "can it list accounts?" check: /accounts is a user-scoped call
 * that an account-owned token cannot make by design, so failing it proves nothing.
 */
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token) {
  console.error("missing CLOUDFLARE_API_TOKEN");
  process.exit(2);
}

const api = "https://api.cloudflare.com/client/v4";
const auth = { authorization: `Bearer ${token}` };
const get = async (path) => {
  const res = await fetch(`${api}${path}`, { headers: auth });
  return res.json();
};

let kind = null;
let verified = await get("/user/tokens/verify");
if (verified.success) {
  kind = "user-owned";
} else if (account) {
  verified = await get(`/accounts/${account}/tokens/verify`);
  if (verified.success) kind = "account-owned";
}

if (!kind) {
  const err = verified.errors?.[0];
  console.error(`FAILED: ${err?.message ?? "token rejected"} (code ${err?.code ?? "?"})`);
  console.error("  Tried both the user and account token endpoints.");
  if (!account) {
    console.error("  CLOUDFLARE_ACCOUNT_ID was not set, so the account endpoint was skipped --");
    console.error("  an account-owned (cfat_) token can only be verified with it.");
  }
  process.exit(1);
}
console.log(`OK: ${kind} token, status ${verified.result?.status ?? "active"}`);

// The only check that really matters: can it do the deploy's job? A token can be live and still
// lack Workers Scripts: Edit, which otherwise surfaces as an opaque 10000 mid-deploy.
if (account) {
  const workers = await get(`/accounts/${account}/workers/services`);
  if (!workers.success) {
    const err = workers.errors?.[0];
    console.error(`FAILED: cannot reach Workers on this account -- ${err?.message} (code ${err?.code})`);
    console.error("  The token is valid but lacks Workers Scripts: Edit, or belongs to another account.");
    process.exit(1);
  }
  console.log(`OK: can reach Workers on ${account.slice(0, 8)}... (${workers.result?.length ?? 0} services)`);
}
