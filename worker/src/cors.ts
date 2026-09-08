/**
 * CORS for a public, read-only, unauthenticated JSON API.
 *
 * This used to reproduce the tinyhttp server's origin allowlist: echo the request's Origin when it
 * matched, send `Access-Control-Allow-Credentials: true`, and `Vary: Origin` because the response
 * body depended on... nothing, actually. That is the point. Every byte of every response here is
 * identical regardless of who asks, so there was never anything to vary on, and reflecting the
 * origin bought nothing while costing cacheability.
 *
 * A static `*` is the canonical maximally-cacheable CORS pattern, and it is a strict superset of
 * the allowlist for every unauthenticated GET -- which is all this API serves.
 *
 * `Allow-Credentials` is gone with it, and not merely as tidying: per the Fetch Standard, if a
 * request's credentials mode is "include" then `Access-Control-Allow-Origin` cannot be `*`. The
 * two are mutually exclusive, so keeping both would have been invalid rather than redundant.
 *
 * `Vary` is gone too. Cloudflare ignores Vary by default -- it does NOT make a response
 * uncacheable, contrary to a common belief; only `Vary: *` does that -- but a stray `Vary` becomes
 * a live bypass the moment Cache Rules Vary is configured with `default: bypass`, and Workers
 * Caching honours Vary fully with no allowlist. Sending a Vary we do not need is a trap armed for
 * later.
 */

// @tinyhttp/cors emitted these as four separate header lines. workerd folds repeated appends into
// one comma-joined value (only Set-Cookie is special-cased), so we send the joined form directly.
// Kept for preflight: a client that sends Content-Type on a GET would otherwise be refused.
const ALLOW_HEADERS =
  "Content-Type, Authorization, X-Custom-Header, Connect-Protocol-Version";
const ALLOW_METHODS = "GET, HEAD, PUT, PATCH, POST, DELETE";

export const applyCors = (headers: Headers): void => {
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-headers", ALLOW_HEADERS);
  headers.set("access-control-allow-methods", ALLOW_METHODS);
};
