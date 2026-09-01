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
for (const d of quirks.devices ?? []) {
  if (d.hwModelSlug && !slugs.has(d.hwModelSlug)) {
    fail(
      `bootloaderOtaQuirks: device slug "${d.hwModelSlug}" is not a known device`,
    );
  }
}

/* ---------------------------------------------- maintenanceUf2 (fails closed) */

const uf2 = readJson("data/maintenanceUf2.json");
const eraseEntries = [
  ...Object.values(uf2.erase?.nrf52 ?? {}),
  uf2.erase?.rp2040,
].filter(Boolean) as { fileName: string; sha256: string }[];

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
