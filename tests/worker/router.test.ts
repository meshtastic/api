import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../../worker/src/index.js";
import { FLASH_TTL } from "../../worker/src/respond.js";
import { seed } from "./seed.js";

const BASE = "https://api.meshtastic.org";

const call = async (
  path: string,
  init: RequestInit & { method?: string } = {},
): Promise<Response> => {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(BASE + path, init), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
};

beforeAll(seed);

describe("path matching reproduces regexparam", () => {
  it.each([
    "/resource/deviceHardware",
    "/resource/devicehardware",
    "/RESOURCE/DEVICEHARDWARE",
    "/resource/deviceHardware/",
  ])("%s serves the same bytes", async (p) => {
    const res = await call(p);
    expect(res.status).toBe(200);
    expect((await res.text()).length).toBe(38536);
  });

  it.each(["//resource/deviceHardware", "/resource//deviceHardware"])(
    "%s is a router miss",
    async (p) => {
      const res = await call(p);
      expect(res.status).toBe(404);
      // The router-miss 404 has NO content-type -- distinct from a handler's sendStatus(404).
      expect(res.headers.get("content-type")).toBeNull();
      expect(await res.text()).toBe("Not Found");
    },
  );

  it("path params keep their case, so an upper-case icon 404s as it does today", async () => {
    expect((await call("/resource/eventFirmware/hamvention.png")).status).toBe(
      200,
    );
    expect((await call("/resource/eventFirmware/HAMVENTION.PNG")).status).toBe(
      404,
    );
  });

  it("a missing R2 object under a matched param route gets the handler 404 shape", async () => {
    const res = await call("/resource/eventFirmware/nope.png");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });

  // Route matching and filename validation are separate steps, as they were on tinyhttp: the
  // route matches case-insensitively and captures anything, then the handler's strict lowercase
  // regex rejects. Folding them into one regex would downgrade this to a router miss -- a
  // different 404, with a different content-type.
  it.each([
    "/resource/eventFirmware/HAMVENTION.PNG",
    "/resource/maintenanceUf2/asset/NRF_ERASE2.UF2",
    "/resource/eventFirmware/not a slug.png",
  ])("%s is a HANDLER 404, not a router miss", async (p) => {
    const res = await call(p);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });

  it("the router-miss 404 still carries CORS, because cors() ran before the router", async () => {
    const res = await call("/definitely-not-a-route", {
      headers: { origin: "https://flash.meshtastic.org" },
    });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBeNull();
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("vary")).toBeNull();
  });
});

describe("health stubs differ, exactly as they do today", () => {
  it("/ is text/plain", async () => {
    const res = await call("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });
  it("/updater is text/html", async () => {
    const res = await call("/updater");
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toBe("OK");
  });
});

describe("/updater/* takes exactly four segments", () => {
  it("four segments serves the frozen manifest", async () => {
    const res = await call(
      "/updater/meshtastic-desktop-flasher/darwin/x86_64/0.3.4",
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(await res.text()).version).toBe("0.3.5");
    expect(res.headers.get("sunset")).toBeTruthy();
  });
  it.each([
    "/updater/foo",
    "/updater/a/b",
    "/updater/a/b/c",
    "/updater/a/b/c/d/e",
  ])("%s 404s, as it does today", async (p) => {
    expect((await call(p)).status).toBe(404);
  });
});

describe("content negotiation and caching", () => {
  it("JSON is 2-space pretty-printed with no charset and no trailing newline", async () => {
    const res = await call("/resource/maintenanceUf2");
    const body = await res.text();
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(body).toBe(JSON.stringify(JSON.parse(body), null, 2));
    expect(body.endsWith("\n")).toBe(false);
  });

  it("If-None-Match returns 304 with no body", async () => {
    const first = await call("/resource/deviceHardware");
    const etag = first.headers.get("etag");
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/);
    const second = await call("/resource/deviceHardware", {
      headers: { "if-none-match": etag as string },
    });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
    expect(second.headers.get("etag")).toBe(etag);
  });

  it("Range is ignored: 200 with the full body, no accept-ranges", async () => {
    const res = await call("/resource/maintenanceUf2/asset/nrf_erase2.uf2", {
      headers: { range: "bytes=0-1" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("accept-ranges")).toBeNull();
    expect((await res.arrayBuffer()).byteLength).toBe(8);
  });

  it("?platform= is ignored and byte-identical, as it is today", async () => {
    const a = await (await call("/resource/deviceHardware")).text();
    const b = await (
      await call("/resource/deviceHardware?platform=esp32s3")
    ).text();
    expect(b).toBe(a);
  });
});

describe("CORS is a static wildcard", () => {
  // The response body is byte-identical for every caller, so there is nothing to vary on. A
  // static `*` is the maximally-cacheable CORS pattern and a strict superset of the old allowlist
  // for every unauthenticated GET -- which is all this API serves.
  it.each([
    ["no Origin", undefined],
    ["allowlisted origin", "https://flash.meshtastic.org"],
    ["former allowlist entry", "https://meshtastic.org"],
    ["unknown origin", "https://example.com"],
    ["null origin", "null"],
  ])("%s gets a bare wildcard", async (_label, origin) => {
    const res = await call(
      "/resource/deviceHardware",
      origin ? { headers: { origin } } : {},
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    // `*` and Allow-Credentials are mutually exclusive per the Fetch spec, so sending both would
    // be invalid rather than merely redundant.
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  // Vary is what made every response a distinct cache variant for no benefit. Cloudflare ignores
  // Vary by default, but Workers Caching honours it fully, so a stray one would fragment the
  // cache -- and under a Cache Rules Vary policy of `default: bypass` it would disable caching
  // outright.
  it.each([
    "/resource/deviceHardware",
    "/github/releases",
    "/resource/eventFirmware/hamvention.png",
    "/definitely-not-a-route",
  ])("%s sends no Vary at all", async (p) => {
    expect((await call(p)).headers.get("vary")).toBeNull();
  });

  it("OPTIONS is answered before routing, so an unknown path is 204 not 404", async () => {
    const res = await call("/nope", {
      method: "OPTIONS",
      headers: { origin: "https://flash.meshtastic.org" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
  });

  it("favicon carries no CORS headers, matching the old middleware order", async () => {
    const res = await call("/favicon.ico", {
      headers: { origin: "https://meshtastic.org" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("edge cache policy", () => {
  const cc = async (p: string) => (await call(p)).headers.get("cache-control");

  it.each([
    ["/resource/deviceHardware", "s-maxage=86400"],
    ["/resource/deviceLinks", "s-maxage=86400"],
    ["/resource/eventFirmware", "s-maxage=86400"],
    ["/github/firmware/list", "s-maxage=900"],
    ["/github/releases", "s-maxage=900"],
    ["/resource/eventFirmware/hamvention.png", "s-maxage=86400"],
    ["/updater/a/b/c/d", "s-maxage=86400"],
  ])("%s carries %s", async (p, directive) => {
    expect(await cc(p)).toContain(directive);
  });

  // The whole point of the shared constant: if these two could expire independently, a client
  // could hold a freshly-revalidated manifest beside a stale binary, on the one flow that ends in
  // an irreversible bootloader write.
  it("the flash manifest and its assets share one TTL", async () => {
    const manifest = await cc("/resource/maintenanceUf2");
    const asset = await cc("/resource/maintenanceUf2/asset/nrf_erase2.uf2");
    const quirks = await cc("/resource/bootloaderOtaQuirks");
    expect(manifest).toContain(`s-maxage=${FLASH_TTL}`);
    expect(asset).toContain(`s-maxage=${FLASH_TTL}`);
    expect(quirks).toContain(`s-maxage=${FLASH_TTL}`);
    expect(asset).toBe(manifest);
  });

  it("no flash-critical route serves stale without revalidating", async () => {
    for (const p of [
      "/resource/maintenanceUf2",
      "/resource/maintenanceUf2/asset/nrf_erase2.uf2",
      "/resource/bootloaderOtaQuirks",
    ]) {
      expect(await cc(p)).not.toContain("stale-while-revalidate");
      expect(await cc(p)).not.toContain("stale-if-error");
    }
  });

  // /_meta is the watchdog's only evidence that the sync pipeline is alive. A cached copy would
  // keep reporting a fresh deployedAt while every sync was silently dead.
  it("/_meta is never cacheable", async () => {
    expect(await cc("/_meta")).toBe("no-store");
  });

  it.each(["/", "/updater", "/github/firmware/pr/1", "/mirror/webui"])(
    "%s is no-store",
    async (p) => {
      expect(await cc(p)).toBe("no-store");
    },
  );

  // Negative answers must not be cached. Without this, Cloudflare's status-code default caches a
  // 404 for three minutes -- and a cached GET 404 then gets served for a HEAD request, skipping
  // the HEAD-on-router-miss-is-204 branch. Caught by the live parity run, not by unit tests.
  it.each([
    ["/definitely-not-a-route", "router miss"],
    ["/resource/eventFirmware/nope.png", "handler 404"],
    ["/updater/only/three/segments", "wrong segment count"],
  ])("%s (%s) is no-store", async (p) => {
    expect(await cc(p)).toBe("no-store");
  });

  it("HEAD on a router miss is uncacheable", async () => {
    const res = await call("/definitely-not-a-route", { method: "HEAD" });
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  // Every cache-control we emit must parse as integers: "Floating-point values are not valid and
  // will be ignored, potentially causing cache bypass."
  it("all TTLs are integers", async () => {
    for (const p of ["/resource/deviceHardware", "/github/releases"]) {
      for (const [, n] of (await cc(p))!.matchAll(
        /(?:max-age|s-maxage)=(\S+?)(?:,|$)/g,
      )) {
        expect(n).toMatch(/^\d+$/);
      }
    }
  });
});

describe("frozen and removed routes", () => {
  it("PR builds reproduce today's error bodies", async () => {
    const bad = await call("/github/firmware/pr/0");
    expect(bad.status).toBe(400);
    expect(JSON.parse(await bad.text())).toEqual({
      error: "invalid_pr_number",
    });

    const real = await call("/github/firmware/pr/11686");
    expect(real.status).toBe(404);
    expect(JSON.parse(await real.text())).toEqual({ error: "no_artifacts" });
  });

  it("artifact download is a frozen 404", async () => {
    const res = await call("/github/firmware/artifact/123/download");
    expect(res.status).toBe(404);
    expect(JSON.parse(await res.text())).toEqual({
      error: "artifact_not_found",
    });
  });

  it("/mirror/webui redirects to the renamed repo instead of serving {}", async () => {
    const res = await call("/mirror/webui");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "https://github.com/meshtastic/web/releases/download/latest/build.tar",
    );
  });

  it.each(["/mqtt", "/meshtastic.api.gateway.v1.GatewayService/GatewayStream"])(
    "%s is gone",
    async (p) => {
      expect((await call(p)).status).toBe(404);
    },
  );
});

describe("methods", () => {
  it("HEAD returns headers with no body", async () => {
    const res = await call("/resource/deviceHardware", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.text()).toBe("");
  });
  it("POST to a GET route is a router miss", async () => {
    expect(
      (await call("/resource/deviceHardware", { method: "POST" })).status,
    ).toBe(404);
  });

  // The old server returned 204 for HEAD on an unmatched path. v2 returns 404 -- the same status
  // GET returns, and the more correct one. The quirk was reproduced until Workers Caching made it
  // non-deterministic; see the note in index.ts.
  it("HEAD on a router miss is 404, matching GET", async () => {
    expect(
      (await call("/definitely-not-a-route", { method: "HEAD" })).status,
    ).toBe(404);
  });
  it("HEAD on a handler 404 stays 404", async () => {
    expect(
      (await call("/resource/eventFirmware/nope.png", { method: "HEAD" }))
        .status,
    ).toBe(404);
  });
});
