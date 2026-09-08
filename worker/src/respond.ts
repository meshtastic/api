import { applyCors } from "./cors.js";

/**
 * Every response header this API emits, in one frozen table.
 *
 * Headers come from code, never from R2 object metadata: a wrong content-type on an uploaded
 * object then cannot change the contract, and the publisher's `--content-type` flags become a
 * belt-and-braces detail rather than load-bearing state.
 */
export type Cls =
  | "bundledJson"
  | "flashCriticalJson"
  | "flashCriticalBinary"
  | "eventIcon"
  | "githubJson"
  | "updaterJson"
  | "favicon"
  | "metaJson";

interface Spec {
  readonly contentType: string;
  readonly cacheControl: string;
  /**
   * Seconds to hold in the Workers Cache API (`caches.default`). Kept equal to the response's
   * s-maxage so the two cache layers cannot disagree about how stale a thing may get.
   * 0 = do not store; always read through to R2.
   */
  readonly edgeTtl: number;
  /** favicon() ran before cors() on the old server and short-circuited, so it never got CORS. */
  readonly cors: boolean;
}

/**
 * Edge TTLs are chosen from HOW EACH THING CHANGES, not from a single flat number.
 *
 * The Workers Cache key includes the Worker version, so **every deploy cold-starts the cache**.
 * That splits the content in two:
 *
 *   - Bundled documents change only via a deploy, which invalidates them automatically. They can
 *     safely sit at the edge for a day.
 *   - The GitHub JSON is written straight to R2 by a sync job with no deploy, so nothing
 *     invalidates it. Its edge TTL must not exceed its sync cadence, or the edge serves data older
 *     than the pipeline that produces it.
 *
 * The trap this avoids: a long edge TTL does NOT let clients "pick up changes quickly" just
 * because their own max-age is short. A client revalidating every 5 minutes is answered by the
 * edge's copy, so a 24h s-maxage means 24h-stale data no matter what max-age says.
 */
const DAY = 86400;
/** The GitHub sync runs every 15 minutes; the edge must never hold these longer than that. */
const SYNC_TTL = 900;

/**
 * ONE constant, shared by the maintenanceUf2 manifest and the .uf2 assets it names by sha256.
 *
 * They must expire together. If the manifest could revalidate independently of its binaries, a
 * client could hold fresh digests beside a stale file -- on the one flow that ends in an
 * irreversible bootloader write.
 *
 * Caching them at all is safe only because tools/validate.ts enforces binary immutability: no
 * .uf2 or .png may change bytes without changing filename. A stale binary is therefore
 * byte-identical to a fresh one, and new bytes mean a new filename, which is a new cache key and a
 * guaranteed miss. Kept short regardless -- the traffic is negligible and the failure is a brick.
 */
export const FLASH_TTL = 900;

const cc = (browser: number, edge: number, staleIfError = false): string =>
  `public, max-age=${browser}, s-maxage=${edge}` +
  (staleIfError ? `, stale-if-error=${DAY}` : "");

export const SPECS: Readonly<Record<Cls, Spec>> = Object.freeze({
  // Content-Type carries NO charset -- tinyhttp's res.json() sets a bare "application/json",
  // and that is what every consumer has been parsing.
  bundledJson: {
    contentType: "application/json",
    cacheControl: cc(300, DAY, true),
    edgeTtl: DAY,
    cors: true,
  },

  // bootloaderOtaQuirks, the maintenanceUf2 manifest, and the .uf2 binaries it names.
  // Both classes take FLASH_TTL, and a test asserts they are equal. Do NOT add
  // stale-while-revalidate here: independent revalidation is exactly the skew FLASH_TTL exists to
  // prevent, and s-maxage already suppresses stale serving at shared caches per RFC 9111.
  flashCriticalJson: {
    contentType: "application/json",
    cacheControl: cc(300, FLASH_TTL),
    edgeTtl: FLASH_TTL,
    cors: true,
  },
  flashCriticalBinary: {
    contentType: "application/octet-stream",
    cacheControl: cc(300, FLASH_TTL),
    edgeTtl: FLASH_TTL,
    cors: true,
  },

  // Immutable by filename, enforced by tools/validate.ts.
  eventIcon: {
    contentType: "image/png",
    cacheControl: cc(3600, DAY),
    edgeTtl: DAY,
    cors: true,
  },

  // Written to R2 by sync-firmware-list.yml WITHOUT a deploy, so no version bump invalidates it.
  githubJson: {
    contentType: "application/json",
    cacheControl: cc(300, SYNC_TTL, true),
    edgeTtl: SYNC_TTL,
    cors: true,
  },

  // A frozen 2023 capture. It will not change again.
  updaterJson: {
    contentType: "application/json",
    cacheControl: cc(3600, DAY),
    edgeTtl: DAY,
    cors: true,
  },

  favicon: {
    contentType: "image/x-icon",
    cacheControl: "public, max-age=31536000",
    edgeTtl: DAY,
    cors: false,
  },

  // MUST never be cached. /_meta is the watchdog's only signal that the pipeline is still running;
  // a cached copy would keep reporting a fresh deployedAt while every sync was silently dead.
  metaJson: {
    contentType: "application/json",
    cacheControl: "no-store",
    edgeTtl: 0,
    cors: true,
  },
});

/** Deprecation trio for the routes that are frozen and will eventually go away. */
export const SUNSET: Readonly<Record<string, string>> = Object.freeze({
  deprecation: "true",
  sunset: "Wed, 01 Sep 2027 00:00:00 GMT",
});

export interface BuildOpts {
  readonly status?: number;
  readonly extra?: Readonly<Record<string, string>>;
}

export const build = (
  body: BodyInit | null,
  cls: Cls,
  etag: string | null,
  opts: BuildOpts = {},
): Response => {
  const spec = SPECS[cls];
  const headers = new Headers();
  headers.set("content-type", spec.contentType);
  headers.set("cache-control", spec.cacheControl);
  if (etag) headers.set("etag", etag);
  if (spec.cors) applyCors(headers);
  for (const [k, v] of Object.entries(opts.extra ?? {})) headers.set(k, v);
  return new Response(body, { status: opts.status ?? 200, headers });
};

const NOT_FOUND_BYTES = new TextEncoder().encode("Not Found");

/**
 * Every 404/204 below carries `cache-control: no-store`.
 *
 * They used to carry no cache-control at all, which was harmless while nothing cached Worker
 * responses. With Workers Caching enabled it stops being harmless: Cloudflare's status-code
 * defaults cache a 404 for three minutes, so a cached GET 404 was being served for a HEAD request
 * and skipping the HEAD-on-router-miss-is-204 branch entirely. Caching a negative answer for a
 * router that could gain the route on the next deploy is not worth the bytes it saves.
 */

/**
 * The router-miss 404. tinyhttp's final handler sends the bare string "Not Found" with NO
 * content-type at all -- distinct from a handler's own res.sendStatus(404), which does set
 * text/plain. Both shapes are reproduced because the parity harness checks both.
 */
export const notFoundRouter = (): Response => {
  // The body MUST be bytes, not a string: workerd stamps `content-type: text/plain;charset=UTF-8`
  // onto a string body, and production sends this 404 with no content-type at all. Verified live.
  //
  // It DOES carry CORS headers, though: cors() was registered before the router on the old server,
  // so even an unmatched path came back with the full CORS set and `Vary: Origin`. Verified live.
  const headers = new Headers({ "cache-control": "no-store" });
  applyCors(headers);
  return new Response(NOT_FOUND_BYTES, { status: 404, headers });
};

/** A handler's res.sendStatus(404). */
export const notFoundHandler = (): Response => {
  const headers = new Headers({
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  applyCors(headers);
  return new Response("Not Found", { status: 404, headers });
};

/** A handler's res.status(n).send({error}) -- used by the frozen firmware stubs. */
export const jsonError = (status: number, error: string): Response => {
  const headers = new Headers({
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  applyCors(headers);
  return new Response(JSON.stringify({ error }, null, 2), { status, headers });
};

/** Health stubs. `/` is text/plain and `/updater` is text/html -- verified live, and different. */
export const ok = (contentType: string): Response => {
  const headers = new Headers({
    "content-type": contentType,
    "cache-control": "no-store",
  });
  applyCors(headers);
  return new Response("OK", { status: 200, headers });
};
