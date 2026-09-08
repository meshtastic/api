import { applyCors } from "./cors.js";
import {
  BOOTLOADER_OTA_QUIRKS,
  DEVICE_HARDWARE,
  DEVICE_LINKS,
  type Doc,
  EVENT_FIRMWARE,
  MAINTENANCE_UF2,
  UPDATER_MANIFEST,
} from "./generated/documents.js";
import {
  build,
  type Cls,
  jsonError,
  notFoundHandler,
  notFoundRouter,
  ok,
  SPECS,
  SUNSET,
} from "./respond.js";

export interface Env {
  DATA: R2Bucket;
}

/**
 * Nothing at module scope but frozen constants. No await, no I/O, no JSON.parse.
 * Global scope gets 1 second, and this repo has twice been taken down by work on a boot path
 * (a top-level `await redis.connect()`, and a Prisma migration gating startup). The rule is not
 * negotiable: if it can fail, it does not belong here.
 */

const BUNDLED: Readonly<Record<string, { doc: Doc; cls: Cls }>> = Object.freeze(
  {
    "/resource/devicehardware": { doc: DEVICE_HARDWARE, cls: "bundledJson" },
    "/resource/devicelinks": { doc: DEVICE_LINKS, cls: "bundledJson" },
    "/resource/eventfirmware": { doc: EVENT_FIRMWARE, cls: "bundledJson" },
    "/resource/bootloaderotaquirks": {
      doc: BOOTLOADER_OTA_QUIRKS,
      cls: "flashCriticalJson",
    },
    "/resource/maintenanceuf2": {
      doc: MAINTENANCE_UF2,
      cls: "flashCriticalJson",
    },
  },
);

const R2KEY: Readonly<Record<string, { key: string; cls: Cls }>> =
  Object.freeze({
    "/github/firmware/list": {
      key: "v1/github/firmware/list.json",
      cls: "githubJson",
    },
    "/github/releases": { key: "v1/github/releases.json", cls: "githubJson" },
    "/favicon.ico": { key: "v1/favicon.ico", cls: "favicon" },
    "/_meta": { key: "v1/_meta.json", cls: "metaJson" },
  });

// Applied to the ORIGINAL-case path so the lowercase character classes still reject
// /resource/eventFirmware/DEFCON34.PNG exactly as the old server's regexes did.
// Route matching and filename validation are SEPARATE, because that is how the old server was
// built and the difference is observable. regexparam matched the literal segments
// case-insensitively and let `:file` capture anything; the handler then applied its own strict
// lowercase regex and, on a miss, called res.sendStatus(404) -- which produces the text/plain 404,
// not the router's bare no-content-type one. Folding the two together would quietly downgrade
// /resource/eventFirmware/HAMVENTION.PNG from a handler 404 to a router miss.
const ICON_ROUTE_RE = /^\/resource\/eventFirmware\/([^/]+)$/i;
const ICON_FILE_RE = /^[a-z0-9-]+\.png$/;
const UF2_ROUTE_RE = /^\/resource\/maintenanceUf2\/asset\/([^/]+)$/i;
const UF2_FILE_RE = /^[a-z0-9_-]+\.uf2$/;
// EXACTLY four segments. A prefix match would make /updater/foo -- which 404s today -- start
// serving a minisign-signed update manifest, which is the opposite of freezing it.
const UPDATER_RE = /^\/updater\/[^/]+\/[^/]+\/[^/]+\/[^/]+$/;
const PR_RE = /^\/github\/firmware\/pr\/([^/]+)$/;
const ARTIFACT_RE = /^\/github\/firmware\/artifact\/([^/]+)\/download$/;

const WEBUI_TARBALL =
  "https://github.com/meshtastic/web/releases/download/latest/build.tar";

/** One trailing slash is tolerated, as it is today. Never strip the root's. */
const trimSlash = (p: string): string =>
  p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;

const isFresh = (request: Request, etag: string): boolean => {
  const inm = request.headers.get("if-none-match");
  if (!inm) return false;
  return inm.split(",").some((t) => t.trim().replace(/^W\//, "") === etag);
};

/** 304 carries no body and no content-type, but must still carry ETag and CORS. */
const notModified = (etag: string, cls: Cls): Response => {
  const headers = new Headers({
    etag,
    "cache-control": SPECS[cls].cacheControl,
  });
  if (SPECS[cls].cors) applyCors(headers);
  return new Response(null, { status: 304, headers });
};

const stripBody = (res: Response): Response =>
  new Response(null, { status: res.status, headers: res.headers });

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Railway remains the fallback origin until the record is retired, and a Worker route
    // covering /* would otherwise swallow its ACME challenge and let the cert quietly expire --
    // on a host nobody can log into. Pass these straight through.
    if (url.pathname.startsWith("/.well-known/")) return fetch(request);

    // cors() ran BEFORE the router on the old server, so OPTIONS on an unknown path with an
    // allowlisted Origin returns 204, not 404. Reproduce that ordering.
    if (request.method === "OPTIONS") {
      const headers = new Headers();
      applyCors(headers);
      return new Response(null, { status: 204, headers });
    }

    // regexparam normalises a doubled slash into a miss; so do we, before any lookup.
    if (url.pathname.includes("//")) return notFoundRouter();

    const path = trimSlash(url.pathname);
    const lower = path.toLowerCase();

    if (request.method !== "GET" && request.method !== "HEAD") {
      return notFoundRouter();
    }

    const res = await route(request, env, ctx, path, lower);
    // The old server had a quirk here: HEAD on an UNMATCHED path returned 204 rather than 404
    // (HEAD on a matched route's own sendStatus(404) stayed 404). v2 reproduced it until Workers
    // Caching made it non-deterministic -- the cache layer answers a HEAD from the GET-shaped
    // response, so the status flipped between 204 and 404 request to request. Dropped
    // deliberately: 404 is the more correct answer for a path that does not exist, it is what GET
    // already returned, and no client can reasonably depend on a HEAD to a nonexistent route
    // reporting success. Declared in tools/parity.mjs.
    return request.method === "HEAD" ? stripBody(res) : res;
  },
} satisfies ExportedHandler<Env>;

async function route(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  path: string,
  lower: string,
): Promise<Response> {
  // Health stubs. Verified live: both are 2 bytes "OK", but / is text/plain and /updater is
  // text/html. Different, and both are polled, so both are reproduced exactly.
  if (lower === "/") return ok("text/plain; charset=utf-8");
  if (lower === "/updater") return ok("text/html; charset=utf-8");

  const bundled = BUNDLED[lower];
  if (bundled) return serveDoc(request, bundled.doc, bundled.cls);

  if (UPDATER_RE.test(path)) {
    // All four path params were already ignored by the old handler -- the per-app gist lookup has
    // been commented out for years and every app/target/arch got the same document. We serve the
    // captured bytes instead of proxying a third party's gist on every request.
    return serveDoc(request, UPDATER_MANIFEST, "updaterJson", SUNSET);
  }

  const iconMatch = ICON_ROUTE_RE.exec(path);
  if (iconMatch) {
    const file = iconMatch[1] ?? "";
    if (!ICON_FILE_RE.test(file)) return notFoundHandler();
    return serveR2(
      request,
      env,
      ctx,
      `v1/resource/eventFirmware/icons/${file}`,
      "eventIcon",
      lower,
      true,
    );
  }

  const uf2Match = UF2_ROUTE_RE.exec(path);
  if (uf2Match) {
    const file = uf2Match[1] ?? "";
    if (!UF2_FILE_RE.test(file)) return notFoundHandler();
    return serveR2(
      request,
      env,
      ctx,
      `v1/resource/maintenanceUf2/asset/${file}`,
      "flashCriticalBinary",
      lower,
      true,
    );
  }

  const r2 = R2KEY[lower];
  if (r2) {
    return serveR2(request, env, ctx, r2.key, r2.cls, lower, false);
  }

  // Frozen stubs. These are byte-identical to production for every reachable input: the firmware
  // repo stopped publishing the arch-aggregate artifacts this route looks for (commit 21920875,
  // 2026-07-31), so it has returned 404 for every PR since. A constant keeps GitHub credentials
  // out of Cloudflare entirely. The real fix is for meshtastic/firmware to publish PR builds to
  // meshtastic.github.io, which already serves Access-Control-Allow-Origin: *.
  const prMatch = PR_RE.exec(path);
  if (prMatch) {
    const n = Number.parseInt(prMatch[1] ?? "", 10);
    return !Number.isSafeInteger(n) || n <= 0
      ? jsonError(400, "invalid_pr_number")
      : jsonError(404, "no_artifacts");
  }
  const artifactMatch = ARTIFACT_RE.exec(path);
  if (artifactMatch) {
    const n = Number.parseInt(artifactMatch[1] ?? "", 10);
    return !Number.isSafeInteger(n) || n <= 0
      ? jsonError(400, "invalid_artifact_id")
      : jsonError(404, "artifact_not_found");
  }

  if (lower === "/mirror/webui") {
    // Today this returns 2 bytes of "{}" -- res.send() JSON-stringifies the ReadableStream it is
    // handed -- and the hardcoded repo was renamed out from under it besides. A redirect actually
    // works, and GitHub sets content-disposition on the signed URL itself, so the download intent
    // survives.
    const headers = new Headers({
      location: WEBUI_TARBALL,
      "cache-control": "no-store",
    });
    applyCors(headers);
    return new Response(null, { status: 302, headers });
  }

  return notFoundRouter();
}

function serveDoc(
  request: Request,
  doc: Doc,
  cls: Cls,
  extra?: Readonly<Record<string, string>>,
): Response {
  if (isFresh(request, doc.etag)) return notModified(doc.etag, cls);
  return build(doc.body, cls, doc.etag, { extra });
}

async function serveR2(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  key: string,
  cls: Cls,
  cacheKeyPath: string,
  handlerNotFound: boolean,
): Promise<Response> {
  const spec = SPECS[cls];

  // Cache key is the LOWERCASED PATH ONLY: no query string (?platform= returns byte-identical
  // output today), and no Origin. The stored entity carries body + content-type + etag and
  // nothing else, so CORS is re-applied per request on the way out and no viewer's Origin can
  // ever leak to another.
  const cacheKey = new Request(`https://api.meshtastic.org${cacheKeyPath}`, {
    method: "GET",
  });
  const cache = caches.default;

  let etag: string | null = null;

  if (spec.edgeTtl > 0) {
    const hit = await cache.match(cacheKey);
    if (hit) {
      etag = hit.headers.get("etag");
      if (etag && isFresh(request, etag)) return notModified(etag, cls);
      return build(hit.body, cls, etag);
    }
  }

  const object = await env.DATA.get(key);
  if (!object) {
    // A missing key is a genuine 404. Which SHAPE depends on the route: the old server's
    // parameterised handlers used res.sendStatus(404) (text/plain), while an unmatched path fell
    // through to the router's bare "Not Found" with no content-type.
    return handlerNotFound ? notFoundHandler() : notFoundRouter();
  }

  // R2 returns a strong, already-quoted ETag (the object's MD5, or "<hash>-<n>" for a
  // multipart upload). Use it verbatim rather than rehashing bytes on every miss.
  etag = object.httpEtag;
  const bytes = await object.arrayBuffer();

  if (spec.edgeTtl > 0) {
    const storable = new Response(bytes, {
      headers: {
        "content-type": spec.contentType,
        etag,
        "cache-control": `public, max-age=${spec.edgeTtl}`,
      },
    });
    ctx.waitUntil(cache.put(cacheKey, storable.clone()));
  }

  if (isFresh(request, etag)) return notModified(etag, cls);

  // Range is deliberately never honoured: the old server ignored it and returned 200 with the
  // full body. R2 would happily return 206, which would change the bytes a sha256-verifying
  // flasher receives on an irreversible bootloader write.
  return build(bytes, cls, etag);
}
