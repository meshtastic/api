import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../../worker/src/index.js";
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
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://flash.meshtastic.org",
    );
    expect(res.headers.get("vary")).toBe("Origin");
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

  it("flash-critical routes are no-cache and never stale-while-revalidate", async () => {
    for (const p of [
      "/resource/bootloaderOtaQuirks",
      "/resource/maintenanceUf2",
      "/resource/maintenanceUf2/asset/nrf_erase2.uf2",
    ]) {
      const cc = (await call(p)).headers.get("cache-control");
      expect(cc).toBe("no-cache");
      expect(cc).not.toContain("stale-while-revalidate");
    }
  });

  it("?platform= is ignored and byte-identical, as it is today", async () => {
    const a = await (await call("/resource/deviceHardware")).text();
    const b = await (
      await call("/resource/deviceHardware?platform=esp32s3")
    ).text();
    expect(b).toBe(a);
  });
});

describe("CORS is a strict superset of today", () => {
  it("no Origin gets an empty ACAO plus credentials", async () => {
    const res = await call("/resource/deviceHardware");
    expect(res.headers.get("access-control-allow-origin")).toBe("");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it.each([
    "http://localhost:3000",
    "https://meshtastic.org",
    "https://flash.meshtastic.org",
    "https://flasher.meshtastic.org",
    "https://map.meshtastic.org",
    "https://web-flasher-git-facelift-meshtastic.vercel.app",
  ])("allowlisted %s is echoed with credentials", async (origin) => {
    const res = await call("/resource/deviceHardware", { headers: { origin } });
    expect(res.headers.get("access-control-allow-origin")).toBe(origin);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("an unknown origin gets * and no credentials, instead of today's 500", async () => {
    const res = await call("/resource/deviceHardware", {
      headers: { origin: "https://example.com" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("OPTIONS is answered before routing, so an unknown path is 204 not 404", async () => {
    const res = await call("/nope", {
      method: "OPTIONS",
      headers: { origin: "https://flash.meshtastic.org" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://flash.meshtastic.org",
    );
  });

  it("favicon carries no CORS headers, matching the old middleware order", async () => {
    const res = await call("/favicon.ico", {
      headers: { origin: "https://meshtastic.org" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
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

  // Verified against production: HEAD on an unmatched path returns 204, while HEAD on a route
  // whose own handler 404s stays 404. A tinyhttp quirk, but an observable one.
  it("HEAD on a router miss is 204, not 404", async () => {
    expect(
      (await call("/definitely-not-a-route", { method: "HEAD" })).status,
    ).toBe(204);
  });
  it("HEAD on a handler 404 stays 404", async () => {
    expect(
      (await call("/resource/eventFirmware/nope.png", { method: "HEAD" }))
        .status,
    ).toBe(404);
  });
});
