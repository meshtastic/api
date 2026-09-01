#!/usr/bin/env node
/**
 * Byte-parity harness.
 *
 *   node tools/parity.mjs --baseline https://api.meshtastic.org --candidate https://apiv2.meshtastic.org
 *   node tools/parity.mjs --self-check --base https://apiv2.meshtastic.org
 *   node tools/parity.mjs --smoke --baseline <a> --candidate <b>
 *
 * Design notes worth knowing before you change it:
 *
 *  - Bodies are compared as EXACT BYTES by default. Only three routes get a normaliser, each
 *    justified below. Anything else silently normalised would be a migration bug we cannot see.
 *
 *  - cache-control and etag are EXEMPT, not ignored: the old server sent no cache-control at all
 *    and only a weak etag on some routes, so every value v2 sends is a deliberate new behaviour.
 *    They are printed for review rather than compared.
 *
 *  - The two GitHub routes compare BASELINE ⊇ CANDIDATE. The candidate is the stale side (it is
 *    refreshed on a schedule, the baseline calls GitHub live), so that is the direction that can
 *    actually pass. Reversed, the gate either blocks forever or gets ignored -- and an ignored
 *    gate is worse than no gate.
 */
import { Buffer } from "node:buffer";

/* ------------------------------------------------------------------ args */

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const flag = (name) => argv.includes(`--${name}`);

const SELF_CHECK = flag("self-check");
const SMOKE = flag("smoke");
const BASE = arg("base");
const BASELINE = arg("baseline", BASE);
const CANDIDATE = arg("candidate", BASE);

if (!BASELINE || !CANDIDATE) {
  console.error(
    "usage: parity.mjs --baseline <url> --candidate <url>\n" +
      "       parity.mjs --self-check --base <url>",
  );
  process.exit(2);
}

/* --------------------------------------------------------------- probes */

const ALLOWED_ORIGIN = "https://flash.meshtastic.org";
const UNKNOWN_ORIGIN = "https://example.com";

/** Body comparison strategies. */
const EXACT = "exact";
const DEVICE_LINKS = "deviceLinks";
const GITHUB_SUBSET = "githubSubset";

const JSON_ROUTES = [
  "/resource/deviceHardware",
  "/resource/deviceLinks",
  "/resource/eventFirmware",
  "/resource/bootloaderOtaQuirks",
  "/resource/maintenanceUf2",
  "/github/firmware/list",
  "/github/releases",
  "/updater/meshtastic-desktop-flasher/darwin/x86_64/0.3.4",
];

const base = [
  { path: "/", body: EXACT },
  { path: "/updater", body: EXACT },
  { path: "/resource/deviceHardware", body: EXACT },
  { path: "/resource/deviceLinks", body: DEVICE_LINKS },
  { path: "/resource/eventFirmware", body: EXACT },
  { path: "/resource/bootloaderOtaQuirks", body: EXACT },
  { path: "/resource/maintenanceUf2", body: EXACT },
  { path: "/resource/eventFirmware/hamvention.png", body: EXACT },
  { path: "/resource/eventFirmware/defcon34.png", body: EXACT },
  { path: "/resource/eventFirmware/burningman2026.png", body: EXACT },
  { path: "/resource/eventFirmware/dragoncon2026.png", body: EXACT },
  { path: "/resource/eventFirmware/fab26.png", body: EXACT },
  { path: "/resource/maintenanceUf2/asset/nrf_erase2.uf2", body: EXACT },
  { path: "/resource/maintenanceUf2/asset/nrf_erase_sd7_3.uf2", body: EXACT },
  { path: "/resource/maintenanceUf2/asset/pico_erase.uf2", body: EXACT },
  { path: "/favicon.ico", body: EXACT },
  { path: "/github/firmware/list", body: GITHUB_SUBSET },
  { path: "/github/releases", body: GITHUB_SUBSET },
  {
    path: "/updater/meshtastic-desktop-flasher/darwin/x86_64/0.3.4",
    body: EXACT,
  },
  // Frozen error stubs. These 404 for every input on the old server too -- firmware CI stopped
  // emitting the arch-aggregate artifacts the handler looks for (commit 21920875, 2026-07-31).
  { path: "/github/firmware/pr/11686", body: EXACT },
  { path: "/github/firmware/pr/0", body: EXACT },
  { path: "/github/firmware/artifact/123/download", body: EXACT },
  // Both 404 shapes. The router miss has NO content-type; a handler's sendStatus(404) does.
  { path: "/definitely-not-a-route", body: EXACT },
  { path: "/resource/eventFirmware/nope.png", body: EXACT },
  { path: "/updater/only/three/segments", body: EXACT },
];

// Case-insensitivity and trailing-slash tolerance are regexparam behaviours the Worker has to
// reproduce; a doubled slash is a miss on both.
const variants = [
  { path: "/resource/devicehardware", body: EXACT },
  { path: "/RESOURCE/DEVICEHARDWARE", body: EXACT },
  { path: "/resource/deviceHardware/", body: EXACT },
  { path: "/GITHUB/releases", body: GITHUB_SUBSET },
  { path: "//resource/deviceHardware", body: EXACT },
  { path: "/resource//deviceHardware", body: EXACT },
  // Path params keep their case, so this must stay a 404.
  { path: "/resource/eventFirmware/HAMVENTION.PNG", body: EXACT },
  // The query string is ignored and must not change a single byte.
  { path: "/resource/deviceHardware?platform=esp32s3", body: EXACT },
  { path: "/github/firmware/list?platform=esp32s3", body: GITHUB_SUBSET },
];

/**
 * Routes where v2 is KNOWN to differ. Declared here so they are reported as expected changes
 * rather than quietly skipped -- an undeclared difference is a failure.
 */
const EXPECTED_DIFFERENCES = [
  {
    path: "/mqtt",
    why: "removed in v2 (frozen Jan-2024 rows, ingest dead since 2024-07-15); snapshot kept in data/mqtt.snapshot.json",
  },
  {
    path: "/mirror/webui",
    why: "was 2 bytes of {} (res.send of a ReadableStream) against a repo that had been renamed; now a 302 to meshtastic/web",
  },
  {
    path: "/meshtastic.api.gateway.v1.GatewayService/GatewayStream",
    why: "removed in v2; returned an empty stream (02 00000002 7b7d) because the coordinate purge left nothing matching latitude != null",
  },
];

const probes = SMOKE ? base.slice(0, 12) : [...base, ...variants];

/* --------------------------------------------------------------- compare */

const COMPARED_HEADERS = [
  "content-type",
  "content-disposition",
  "location",
  "vary",
  "accept-ranges",
  "content-encoding",
  "access-control-allow-origin",
  "access-control-allow-credentials",
  "access-control-allow-methods",
  "access-control-allow-headers",
];

// Deliberately new in v2, printed rather than compared. See the header note at the top.
const EXEMPT_HEADERS = ["cache-control", "etag"];

const get = async (root, path, init = {}) => {
  const res = await fetch(root + path, { redirect: "manual", ...init });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, body: buf };
};

const canon = (v) => JSON.stringify(v, null, 2);

/** baseline ⊇ candidate on canonical JSON, for the two live-GitHub routes. */
const githubSubsetOk = (a, b) => {
  try {
    const A = JSON.parse(a.toString("utf8"));
    const B = JSON.parse(b.toString("utf8"));
    if (Array.isArray(A) && Array.isArray(B)) {
      const seen = new Set(A.map((x) => canon(x)));
      return B.every((x) => seen.has(canon(x)));
    }
    const seen = new Set(
      [...(A.releases?.stable ?? []), ...(A.releases?.alpha ?? [])].map(canon),
    );
    const cand = [...(B.releases?.stable ?? []), ...(B.releases?.alpha ?? [])];
    if (!cand.every((x) => seen.has(canon(x)))) return false;
    // pullRequests turns over fast; compare its shape, not its contents.
    return (
      Array.isArray(B.pullRequests) &&
      B.pullRequests.every((p) => p.id && p.page_url && p.title)
    );
  } catch {
    return false;
  }
};

const bodiesMatch = (mode, a, b) => {
  if (a.equals(b)) return { ok: true };
  if (mode === DEVICE_LINKS) {
    try {
      const A = JSON.parse(a.toString("utf8"));
      const B = JSON.parse(b.toString("utf8"));
      const ga = A.generatedAt;
      const gb = B.generatedAt;
      // Still assert the SHAPE of the value we are about to discard, so a format change is caught.
      const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
      if (!ISO.test(ga) || !ISO.test(gb)) {
        return {
          ok: false,
          note: `generatedAt is not ISO-with-ms: "${ga}" / "${gb}"`,
        };
      }
      A.generatedAt = B.generatedAt = "<normalized>";
      return canon(A) === canon(B)
        ? { ok: true, note: `generatedAt only (${ga} -> ${gb})` }
        : { ok: false };
    } catch {
      return { ok: false };
    }
  }
  if (mode === GITHUB_SUBSET) {
    return githubSubsetOk(a, b)
      ? {
          ok: true,
          note: "candidate is a subset of baseline (expected: it is the stale side)",
        }
      : { ok: false, note: "candidate is NOT a subset of baseline" };
  }
  return { ok: false };
};

/* ----------------------------------------------------------------- runs */

let failures = 0;
let checks = 0;
const note = (s) => console.log(`      ${s}`);

const compare = async (probe, init, label) => {
  checks++;
  const [a, b] = await Promise.all([
    get(BASELINE, probe.path, init),
    get(CANDIDATE, probe.path, init),
  ]);

  const problems = [];
  if (a.status !== b.status) {
    problems.push(`status ${a.status} -> ${b.status}`);
  }
  for (const h of COMPARED_HEADERS) {
    const va = a.headers.get(h);
    const vb = b.headers.get(h);
    // Header folding: workerd joins repeated values with ", ". Compare set-wise so the folded
    // access-control-allow-headers line is not reported as a difference.
    const norm = (v) =>
      v === null
        ? null
        : v
            .split(",")
            .map((x) => x.trim())
            .sort()
            .join(",");
    if (norm(va) !== norm(vb)) problems.push(`${h}: ${va} -> ${vb}`);
  }
  const bodyResult = bodiesMatch(probe.body, a.body, b.body);
  if (!bodyResult.ok) {
    problems.push(
      `body differs (${a.body.length} -> ${b.body.length} bytes)` +
        (bodyResult.note ? `: ${bodyResult.note}` : ""),
    );
  }

  if (problems.length > 0) {
    failures++;
    console.log(`FAIL  ${label}`);
    for (const p of problems) note(p);
    return;
  }
  const extras = EXEMPT_HEADERS.map(
    (h) => `${h}: ${a.headers.get(h) ?? "-"} -> ${b.headers.get(h) ?? "-"}`,
  ).join("  |  ");
  console.log(`ok    ${label}`);
  if (bodyResult.note) note(bodyResult.note);
  if (!SMOKE) note(extras);
};

const selfCheck = async () => {
  console.log(`self-check against ${BASE}\n`);
  for (const route of JSON_ROUTES) {
    checks++;
    const r = await get(BASE, route);
    const text = r.body.toString("utf8");
    const problems = [];
    if (r.status !== 200) problems.push(`status ${r.status}`);
    if (r.headers.get("content-type") !== "application/json") {
      problems.push(
        `content-type ${r.headers.get("content-type")} (must have no charset)`,
      );
    }
    try {
      if (text !== canon(JSON.parse(text))) {
        problems.push("not canonical JSON.stringify(v, null, 2)");
      }
    } catch {
      problems.push("not parseable JSON");
    }
    if (text.endsWith("\n")) problems.push("has a trailing newline");

    // Conditional requests must still work: the largest payloads rely on 304s, and Apple sets
    // reloadRevalidatingCacheData explicitly to get them.
    const etag = r.headers.get("etag");
    if (etag) {
      const c = await get(BASE, route, { headers: { "if-none-match": etag } });
      if (c.status !== 304)
        problems.push(`If-None-Match returned ${c.status}, expected 304`);
      if (c.body.length !== 0)
        problems.push(`304 carried ${c.body.length} bytes`);
    } else {
      problems.push("no etag");
    }

    if (problems.length) {
      failures++;
      console.log(`FAIL  ${route}`);
      for (const p of problems) note(p);
    } else {
      console.log(`ok    ${route}`);
    }
  }

  // Range must be ignored, not honoured: a 206 would change the bytes a sha256-verifying flasher
  // receives before an irreversible bootloader write.
  for (const bin of [
    "/resource/eventFirmware/hamvention.png",
    "/resource/maintenanceUf2/asset/nrf_erase2.uf2",
  ]) {
    checks++;
    const r = await get(BASE, bin, { headers: { range: "bytes=0-99" } });
    if (r.status !== 200 || r.headers.get("accept-ranges")) {
      failures++;
      console.log(`FAIL  ${bin} honoured Range (status ${r.status})`);
    } else {
      console.log(`ok    ${bin} ignores Range (200, full body)`);
    }
  }

  // CORS: allowlisted echoes with credentials; unknown gets * and must never 500.
  checks++;
  const allowed = await get(BASE, "/resource/deviceHardware", {
    headers: { origin: ALLOWED_ORIGIN },
  });
  const unknown = await get(BASE, "/resource/deviceHardware", {
    headers: { origin: UNKNOWN_ORIGIN },
  });
  const corsProblems = [];
  if (allowed.headers.get("access-control-allow-origin") !== ALLOWED_ORIGIN) {
    corsProblems.push("allowlisted origin not echoed");
  }
  if (allowed.headers.get("access-control-allow-credentials") !== "true") {
    corsProblems.push("allowlisted origin lost credentials");
  }
  if (unknown.status !== 200)
    corsProblems.push(`unknown origin got ${unknown.status}`);
  if (unknown.headers.get("access-control-allow-origin") !== "*") {
    corsProblems.push("unknown origin did not get *");
  }
  if (corsProblems.length) {
    failures++;
    console.log("FAIL  CORS");
    for (const p of corsProblems) note(p);
  } else {
    console.log("ok    CORS (allowlist echo + credentials; unknown -> *)");
  }
};

/* ------------------------------------------------------------------ main */

if (SELF_CHECK) {
  await selfCheck();
} else {
  console.log(`baseline  ${BASELINE}\ncandidate ${CANDIDATE}\n`);
  for (const probe of probes) {
    await compare(probe, {}, probe.path);
  }
  console.log("\n-- CORS matrix --");
  for (const [label, headers] of [
    ["no Origin", {}],
    [`Origin: ${ALLOWED_ORIGIN}`, { origin: ALLOWED_ORIGIN }],
    [`Origin: ${UNKNOWN_ORIGIN}`, { origin: UNKNOWN_ORIGIN }],
  ]) {
    await compare(
      { path: "/resource/deviceHardware", body: EXACT },
      { headers },
      `/resource/deviceHardware  [${label}]`,
    );
  }

  console.log("\n-- expected differences (declared, not compared) --");
  for (const e of EXPECTED_DIFFERENCES) {
    const [a, b] = await Promise.all([
      get(BASELINE, e.path).catch(() => null),
      get(CANDIDATE, e.path).catch(() => null),
    ]);
    console.log(
      `note  ${e.path}  ${a?.status ?? "?"} -> ${b?.status ?? "?"}\n      ${e.why}`,
    );
  }
}

console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"}  ${checks - failures}/${checks} checks`,
);
process.exit(failures === 0 ? 0 : 1);
