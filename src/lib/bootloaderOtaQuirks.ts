import { readFileSync } from "node:fs";

// nRF52 bootloader/OTA quirk catalog. Source of truth was Meshtastic-Android's bundled
// androidApp/src/main/assets/device_bootloader_ota_quirks.json (moved here 2026-08-20, per
// thebentern) so other clients can read it without bundling their own stale copy. Android is
// the only real consumer today; apple's OTAFIX bootloader-upgrade flow (PRs #2338/#2339) mirrors
// its own board map by hand and could take `devices` as the "upgrade your bootloader first"
// advisory, and web-flasher's drag-and-drop UF2 flow has no such nudge at all. The path resolves
// the same in dev (src/lib) and prod (dist/lib), both two levels below the repo root.
const DATA_PATH = new URL("../../data/bootloaderOtaQuirks.json", import.meta.url);

/**
 * Advisory only: devices that usually ship with a bootloader lacking OTA support and need a
 * one-time upgrade (typically over USB) before BLE DFU works. Safe to fail open — a client that
 * cannot reach this endpoint should still let the update attempt proceed.
 */
export interface BootloaderOtaQuirk {
  hwModel: number;
  hwModelSlug?: string;
  requiresBootloaderUpgradeForOta: boolean;
  infoUrl?: string;
}

/**
 * The Nordic SoftDevice a given hwModel/target combination is linked against. Gates a
 * destructive flash (wrong SoftDevice = a corrupted radio recoverable only via SWD/serial DFU),
 * so unlike [BootloaderOtaQuirk] this must fail closed: an unresolved or absent entry is a
 * deliberate refusal, not a gap to paper over with a best guess.
 */
export interface SoftDeviceVariantEntry {
  hwModel: number;
  hwModelSlug?: string;
  platformioTargets: string[];
  softDevice?: string;
}

export interface BootloaderOtaQuirksResponse {
  devices: BootloaderOtaQuirk[];
  softDeviceVariants: SoftDeviceVariantEntry[];
}

// Parse once per process — the file only changes via a committed edit + redeploy, same as
// eventFirmware and deviceLinks.
let cached: BootloaderOtaQuirksResponse | null = null;

export const getBootloaderOtaQuirks = (): BootloaderOtaQuirksResponse => {
  if (!cached) {
    cached = JSON.parse(
      readFileSync(DATA_PATH, "utf8"),
    ) as BootloaderOtaQuirksResponse;
  }
  return cached;
};
