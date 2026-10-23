/**
 * Semantic and cross-dataset checks. These replace the old CI's "boot the server and curl /"
 * smoke test: there is no server to boot any more, so the gate has to be on the data itself.
 *
 * The bias is deliberate and asymmetric. Advisory data (deviceLinks, eventFirmware) may be thin;
 * data that gates a destructive flash must FAIL CLOSED -- an empty softDeviceVariants list or a
 * manifest naming a file we do not publish is a build failure, not a warning, because the client
 * consequence is a bricked radio recoverable only over SWD.
 */
import { existsSync, readFileSync } from "node:fs";
import { deviceHardwareList } from "../src/lib/resource.js";
import { sha256 } from "./canonical.js";
import { collectEraseImages } from "./eraseImages.js";

const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));

const problems: string[] = [];
const fail = (msg: string) => problems.push(msg);

/* ---------------------------------------------------------------- deviceHardware */

// Closed set, taken from the data itself. Note these are HYPHENATED ("esp32-s3") and include
// "portduino" -- a different vocabulary from the firmware CI's artifact names ("esp32s3"), which
// is exactly the kind of near-miss the repo's own comments warn about elsewhere. Keeping it closed
// is the point: it catches a typo'd architecture, which would silently drop a board out of every
// consumer's arch filter. Add a value here when a genuinely new architecture lands.
const ARCHITECTURES = new Set([
  "esp32",
  "esp32-c3",
  "esp32-c6",
  "esp32-s3",
  "nrf52840",
  "portduino",
  "rp2040",
  "rp2350",
  "stm32",
]);

if (deviceHardwareList.length < 100) {
  fail(
    `deviceHardwareList has only ${deviceHardwareList.length} entries (<100)`,
  );
}

// Several hwModels legitimately carry multiple entries -- one per board variant that shares the
// model id (RAK4631 has three, HELTEC_WIRELESS_TRACKER four). The real primary key is
// (hwModel, platformioTarget), which is unique across all 114 entries today. key/variant are
// optional display differentiators, used by exactly one family, and are NOT part of the key.
const seen = new Set<string>();
for (const d of deviceHardwareList) {
  const id = `${d.hwModel}|${d.platformioTarget}`;
  if (seen.has(id)) fail(`duplicate (hwModel,platformioTarget): ${id}`);
  seen.add(id);

  if (!ARCHITECTURES.has(d.architecture)) {
    fail(`${d.hwModelSlug}: unknown architecture "${d.architecture}"`);
  }
  if (d.supportLevel !== undefined && ![1, 2, 3].includes(d.supportLevel)) {
    fail(`${d.hwModelSlug}: supportLevel ${d.supportLevel} not in {1,2,3}`);
  }
  for (const img of d.images ?? []) {
    if (!/^[a-z0-9._-]+\.svg$/.test(img)) {
      fail(`${d.hwModelSlug}: image "${img}" is not a bare .svg filename`);
    }
  }
}

const slugs = new Set(deviceHardwareList.map((d) => d.hwModelSlug));
const targets = new Set(deviceHardwareList.map((d) => d.platformioTarget));

/* ---------------------------------------------------------------- deviceLinks */

const links = readJson("data/deviceLinks.json");
if (!Array.isArray(links.Routes) || links.Routes.length === 0) {
  fail("deviceLinks.json has no Routes");
}
for (const r of links.Routes ?? []) {
  if (!r.ShortCode) fail("deviceLinks: a Route has an empty ShortCode");
}

/* ------------------------------------------- bootloaderOtaQuirks (fails closed) */

const quirks = readJson("data/bootloaderOtaQuirks.json");
if (
  !Array.isArray(quirks.softDeviceVariants) ||
  quirks.softDeviceVariants.length === 0
) {
  fail(
    "bootloaderOtaQuirks.softDeviceVariants is empty -- this gates a destructive flash and must fail closed",
  );
}
for (const v of quirks.softDeviceVariants ?? []) {
  if (v.hwModelSlug && !slugs.has(v.hwModelSlug)) {
    fail(
      `bootloaderOtaQuirks: softDeviceVariant slug "${v.hwModelSlug}" is not a known device`,
    );
  }
  for (const t of v.platformioTargets ?? []) {
    if (!targets.has(t)) {
      fail(
        `bootloaderOtaQuirks: platformioTarget "${t}" is not a known device`,
      );
    }
  }
}
// The reverse direction: an nRF52840 build missing from its model's row resolves to no SoftDevice,
// so clients refuse factory erase for it and nothing else notices.
const variantTargets = new Map<number, Set<string>>();
for (const v of quirks.softDeviceVariants ?? []) {
  const set = variantTargets.get(v.hwModel) ?? new Set<string>();
  for (const t of v.platformioTargets ?? []) set.add(t);
  variantTargets.set(v.hwModel, set);
}
for (const d of deviceHardwareList) {
  if (d.architecture !== "nrf52840") continue;
  if (!variantTargets.get(d.hwModel)?.has(d.platformioTarget)) {
    fail(
      `bootloaderOtaQuirks: nrf52840 target "${d.platformioTarget}" (${d.hwModelSlug}) is in no softDeviceVariants ` +
        "row -- add it, with the SoftDevice from meshtastic/firmware boards/<board>.json build.arduino.ldscript " +
        "(nrf52840_s140_v6.ld = 6.1.1, _v7.ld = 7.3.0), or a row with no softDevice to refuse it deliberately",
    );
  }
}
for (const d of quirks.devices ?? []) {
  if (d.hwModelSlug && !slugs.has(d.hwModelSlug)) {
    fail(
      `bootloaderOtaQuirks: device slug "${d.hwModelSlug}" is not a known device`,
    );
  }
}

/* ---------------------------------------------- maintenanceUf2 (fails closed) */

const uf2 = readJson("data/maintenanceUf2.json");
// Every entry under `erase`, whatever its key. This named `nrf52` and `rp2040` literally, which
// meant the additive `nrf52Bootloader` key was skipped by the one check that is supposed to prove
// every manifest entry points at a file we actually publish. Shared with build-static.ts so the
// list that is checked and the list that is uploaded cannot drift apart again.
const eraseEntries = collectEraseImages(uf2.erase);

if (eraseEntries.length === 0) fail("maintenanceUf2 has no erase images");

for (const e of eraseEntries) {
  const path = `static/maintenanceUf2/${e.fileName}`;
  if (!existsSync(path)) {
    fail(
      `maintenanceUf2 names ${e.fileName}, which is not in static/maintenanceUf2/`,
    );
    continue;
  }
  const actual = sha256(readFileSync(path));
  if (actual !== e.sha256) {
    fail(
      `maintenanceUf2: ${e.fileName} sha256 mismatch\n  manifest ${e.sha256}\n  on disk  ${actual}`,
    );
  }
}
for (const t of uf2.otafixSupportedTargets ?? []) {
  if (!targets.has(t)) {
    fail(`maintenanceUf2: otafixSupportedTarget "${t}" is not a known device`);
  }
}

/* ---------------------------------------------------------------- eventFirmware */

const ICON_PREFIX = "https://api.meshtastic.org/resource/eventFirmware/";
const events = readJson("data/eventFirmware.json");
for (const ed of events.editions ?? []) {
  if (!ed.iconUrl) continue;
  if (!ed.iconUrl.startsWith(ICON_PREFIX)) {
    // The old server rewrote self-hosted icon origins per request. That rewrite is a proven no-op
    // in production and has been dropped, so the data file must now carry the production origin
    // directly -- and CI is what enforces it.
    fail(
      `eventFirmware ${ed.edition}: iconUrl must start with ${ICON_PREFIX} (got ${ed.iconUrl})`,
    );
    continue;
  }
  const file = ed.iconUrl.slice(ICON_PREFIX.length);
  if (!/^[a-z0-9-]+\.png$/.test(file)) {
    fail(
      `eventFirmware ${ed.edition}: "${file}" would not match the icon route's regex`,
    );
  }
  if (!existsSync(`static/eventFirmware/${file}`)) {
    fail(
      `eventFirmware ${ed.edition}: icon ${file} is not in static/eventFirmware/`,
    );
  }
}

/* ---------------------------------------------------------------- mqttRoots */

// Clients save a root straight into the radio, so an entry must pass the firmware's own root rules:
// 31 bytes, printable ASCII, no wildcards, no empty segment, not ending in the /2 version level.
const ISO_SUBDIVISION = /^[A-Z]{2}-[A-Z0-9]{1,3}$/;
const roots = readJson("data/mqttRoots.json");
const seenRoots = new Set<string>();
for (const e of roots.entries ?? []) {
  const where = `mqttRoots "${e.root}"`;
  if (typeof e.root !== "string" || !e.root.startsWith("msh/")) {
    fail(`${where}: root must start with msh/`);
    continue;
  }
  if (Buffer.byteLength(e.root) > 31) fail(`${where}: longer than 31 bytes`);
  if (!/^[\x21-\x7e]+$/.test(e.root)) fail(`${where}: not printable ASCII`);
  if (/[+#]/.test(e.root)) fail(`${where}: contains a wildcard`);
  if (e.root.endsWith("/") || e.root.includes("//"))
    fail(`${where}: empty segment`);
  if (e.root.split("/").at(-1) === "2") fail(`${where}: ends with /2`);
  const key = e.root.toLowerCase();
  if (seenRoots.has(key)) fail(`${where}: duplicate root`);
  seenRoots.add(key);
  if (typeof e.name !== "string" || e.name.trim() === "")
    fail(`${where}: missing name`);
  for (const s of e.subdivisions ?? []) {
    if (!ISO_SUBDIVISION.test(s))
      fail(`${where}: "${s}" is not an ISO 3166-2 code`);
  }
  const hasCenter = e.center !== undefined || e.radiusKm !== undefined;
  if (hasCenter) {
    const [lat, lon] = Array.isArray(e.center) ? e.center : [];
    if (
      typeof lat !== "number" ||
      lat < -90 ||
      lat > 90 ||
      typeof lon !== "number" ||
      lon < -180 ||
      lon > 180
    ) {
      fail(`${where}: center must be [lat, lon]`);
    }
    if (typeof e.radiusKm !== "number" || e.radiusKm <= 0)
      fail(`${where}: radiusKm must be positive`);
  }
  if (!hasCenter && (e.subdivisions ?? []).length === 0) {
    fail(
      `${where}: needs subdivisions or a center and radius, or no client can place it`,
    );
  }
}
for (const [code, list] of Object.entries<string[]>(roots.neighbors ?? {})) {
  if (!ISO_SUBDIVISION.test(code))
    fail(`mqttRoots neighbors: "${code}" is not an ISO 3166-2 code`);
  for (const other of list) {
    if (!(roots.neighbors[other] ?? []).includes(code)) {
      fail(
        `mqttRoots neighbors: ${code} lists ${other} but ${other} does not list ${code}`,
      );
    }
  }
}
for (const [country, names] of Object.entries<Record<string, string>>(
  roots.subdivisionSegments ?? {},
)) {
  for (const [name, segment] of Object.entries(names)) {
    if (name !== name.toLowerCase())
      fail(
        `mqttRoots subdivisionSegments ${country}: "${name}" must be lowercase`,
      );
    if (!/^[A-Za-z0-9_-]+$/.test(segment))
      fail(
        `mqttRoots subdivisionSegments ${country}: bad segment "${segment}"`,
      );
  }
}

/* --------------------------------------------------- binary immutability */

// Clients pin these by sha256 and cache them by filename. Changing the bytes under an unchanged
// name is the one edit that a 1-hour icon TTL cannot survive, so it has to be a build failure:
// ship new bytes under a new filename instead.
const PINS = "tests/golden/binaries.sha256";
if (existsSync(PINS)) {
  for (const line of readFileSync(PINS, "utf8").split("\n")) {
    const m = /^([0-9a-f]{64})\s+(.+)$/.exec(line.trim());
    if (!m) continue;
    const [, want, path] = m as unknown as [string, string, string];
    if (!existsSync(path)) {
      fail(
        `binary immutability: ${path} is pinned but missing (remove the pin to retire it)`,
      );
      continue;
    }
    const got = sha256(readFileSync(path));
    if (got !== want) {
      fail(
        `binary immutability: ${path} changed bytes under an unchanged filename.\n` +
          "  Publish new bytes under a NEW filename instead -- clients cache these by name.",
      );
    }
  }
} else {
  console.warn(`(no ${PINS} yet -- run tools/pin-binaries.sh to create it)`);
}

/* ---------------------------------------------------------------- report */

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(
  `validate: OK (${deviceHardwareList.length} devices, ${links.Routes.length} links, ` +
    `${quirks.softDeviceVariants.length} softDevice variants, ${eraseEntries.length} erase images)`,
);
