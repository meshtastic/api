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
  /** Seconds to hold in the edge Cache API. 0 = always revalidate against the origin store. */
  readonly edgeTtl: number;
  /** favicon() ran before cors() on the old server and short-circuited, so it never got CORS. */
  readonly cors: boolean;
}

export const SPECS: Readonly<Record<Cls, Spec>> = Object.freeze({
  // Content-Type carries NO charset -- tinyhttp's res.json() sets a bare "application/json",
  // and that is what every consumer has been parsing.
  bundledJson: {
    contentType: "application/json",
    cacheControl: "public, max-age=300, stale-if-error=86400",
    edgeTtl: 300,
    cors: true,
  },

  // bootloaderOtaQuirks, the maintenanceUf2 manifest, and the .uf2 binaries it names.
  //
  // These carry no Cache-Control today, so OkHttp does not cache them at all. Any positive
  // max-age would create client-side caching where none existed -- and worse, a manifest and its
  // binaries revalidating INDEPENDENTLY (which is exactly what stale-while-revalidate causes) can
  // leave a client holding fresh sha256 digests beside a stale binary. Android verifies the digest
  // before writing, so the flash is correctly refused, but the erase flow is then broken for the
  // length of the skew -- on a path a user only reaches because their device is already bricked.
  //
  // no-cache means always-revalidate, which with 304 support costs ~0 bytes.
  // DO NOT add stale-while-revalidate here, and do not give the binaries a longer TTL than the
  // manifest that names them.
  flashCriticalJson: {
    contentType: "application/json",
    cacheControl: "no-cache",
    edgeTtl: 0,
    cors: true,
  },
  flashCriticalBinary: {
    contentType: "application/octet-stream",
    cacheControl: "no-cache",
    edgeTtl: 0,
    cors: true,
  },

  eventIcon: {
    contentType: "image/png",
    cacheControl: "public, max-age=3600",
    edgeTtl: 3600,
    cors: true,
  },
  githubJson: {
    contentType: "application/json",
    cacheControl: "public, max-age=300, stale-if-error=86400",
    edgeTtl: 300,
    cors: true,
  },
  updaterJson: {
    contentType: "application/json",
    cacheControl: "public, max-age=3600",
    edgeTtl: 3600,
    cors: true,
  },
  favicon: {
    contentType: "image/x-icon",
    cacheControl: "public, max-age=31536000",
    edgeTtl: 86400,
    cors: false,
  },
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
  origin: string | null,
  etag: string | null,
  opts: BuildOpts = {},
): Response => {
  const spec = SPECS[cls];
  const headers = new Headers();
  headers.set("content-type", spec.contentType);
  headers.set("cache-control", spec.cacheControl);
  if (etag) headers.set("etag", etag);
  if (spec.cors) applyCors(headers, origin);
  for (const [k, v] of Object.entries(opts.extra ?? {})) headers.set(k, v);
  return new Response(body, { status: opts.status ?? 200, headers });
};

const NOT_FOUND_BYTES = new TextEncoder().encode("Not Found");

/**
 * The router-miss 404. tinyhttp's final handler sends the bare string "Not Found" with NO
 * content-type at all -- distinct from a handler's own res.sendStatus(404), which does set
 * text/plain. Both shapes are reproduced because the parity harness checks both.
 */
export const notFoundRouter = (origin: string | null): Response => {
  // The body MUST be bytes, not a string: workerd stamps `content-type: text/plain;charset=UTF-8`
  // onto a string body, and production sends this 404 with no content-type at all. Verified live.
  //
  // It DOES carry CORS headers, though: cors() was registered before the router on the old server,
  // so even an unmatched path came back with the full CORS set and `Vary: Origin`. Verified live.
  const headers = new Headers();
  applyCors(headers, origin);
  return new Response(NOT_FOUND_BYTES, { status: 404, headers });
};

/**
 * HEAD on an unmatched path returns 204, not 404 -- a tinyhttp quirk, verified live:
 *   GET  /definitely-not-a-route -> 404
 *   HEAD /definitely-not-a-route -> 204
 * A HEAD onto a matched route's own sendStatus(404) still returns 404, so this applies only to
 * the router miss.
 */
export const noContentRouter = (origin: string | null): Response => {
  const headers = new Headers();
  applyCors(headers, origin);
  return new Response(null, { status: 204, headers });
};

/** A handler's res.sendStatus(404). */
export const notFoundHandler = (origin: string | null): Response => {
  const headers = new Headers({ "content-type": "text/plain; charset=utf-8" });
  applyCors(headers, origin);
  return new Response("Not Found", { status: 404, headers });
};

/** A handler's res.status(n).send({error}) -- used by the frozen firmware stubs. */
export const jsonError = (
  status: number,
  error: string,
  origin: string | null,
): Response => {
  const headers = new Headers({
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  applyCors(headers, origin);
  return new Response(JSON.stringify({ error }, null, 2), { status, headers });
};

/** Health stubs. `/` is text/plain and `/updater` is text/html -- verified live, and different. */
export const ok = (contentType: string, origin: string | null): Response => {
  const headers = new Headers({
    "content-type": contentType,
    "cache-control": "no-store",
  });
  applyCors(headers, origin);
  return new Response("OK", { status: 200, headers });
};
