/**
 * CORS, reproducing src/index.ts:29-58 of the tinyhttp server.
 *
 * The allowlist is copied verbatim. The one behavioural change is the failure branch: the old
 * `origin()` callback THREW on an unrecognised origin, which tinyhttp turned into a 500 -- so a
 * third-party page asking for public JSON got an opaque server error, and at least two forks
 * responded by building proxies that spoof an allowlisted Origin. Unknown origins now get a plain
 * `*` instead. That makes v2 a strict superset: every request that works today is byte-identical,
 * and the ones that 500 start working.
 *
 * `*` and `Allow-Credentials` are mutually exclusive per the Fetch spec, which is why the
 * fallback branch omits credentials rather than sending both.
 */
const ALLOWLIST: ReadonlySet<string> = new Set([
  "http://localhost:3000",
  "https://meshtastic.org",
  "https://flash.meshtastic.org",
  "https://flasher.meshtastic.org",
  "https://map.meshtastic.org",
  "https://web-flasher-git-facelift-meshtastic.vercel.app",
]);

// @tinyhttp/cors emits these as four separate header lines. workerd folds repeated appends into
// one comma-joined value (only Set-Cookie is special-cased), so we send the joined form directly.
// Semantically identical for every CORS implementation -- see the note in the parity harness.
const ALLOW_HEADERS =
  "Content-Type, Authorization, X-Custom-Header, Connect-Protocol-Version";
const ALLOW_METHODS = "GET, HEAD, PUT, PATCH, POST, DELETE";

export const applyCors = (headers: Headers, origin: string | null): void => {
  headers.set("access-control-allow-headers", ALLOW_HEADERS);
  headers.set("access-control-allow-methods", ALLOW_METHODS);
  // Vary on Origin because the value below depends on it. The edge cache key deliberately
  // excludes Origin (see index.ts) and stores no CORS headers, so this never fragments anything.
  headers.set("vary", "Origin");

  if (origin === null) {
    // No Origin header: the old server's `origin()` returned "" and cors still set credentials.
    // Native apps, curl and every CI consumer land here.
    headers.set("access-control-allow-origin", "");
    headers.set("access-control-allow-credentials", "true");
    return;
  }
  if (ALLOWLIST.has(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-credentials", "true");
    return;
  }
  headers.set("access-control-allow-origin", "*");
};
