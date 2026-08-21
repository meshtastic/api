import { readFileSync } from "node:fs";

// Pinned nRF52/RP2040 maintenance UF2 manifest — factory-erase images and OTAFIX bootloader
// self-update images, keyed by hardware. Source of truth was Meshtastic-Android's
// feature/firmware/.../MaintenanceUf2.kt (moved here 2026-08-20): the erase-image URLs used to
// point at a commit-pinned raw.githubusercontent.com URL into meshtastic/web-flasher's own
// public/uf2/ (built from meshtastic/nrf52_factory_erase, GPL-3.0, which cuts no releases), and
// the OTAFIX board map was independently hand-copied into apple's (unmerged) OTAFIX branch. Both
// couplings end here: the erase images are vendored into this repo's own static/maintenanceUf2/
// and served below; the OTAFIX images stay hosted on Adafruit_nRF52_Bootloader_OTAFIX's GitHub
// releases (otafixBase + otafixReleaseTag), resolved by URL template rather than re-hosted, since
// that repo does cut releases and mirroring release binaries here would be a second copy to keep
// in sync.
//
// Served like bootloaderOtaQuirks.ts — parsed once, trusted as-is. Each image's own sha256 (below)
// is still checked against the downloaded bytes before any write, same as before this moved here;
// that guards against a corrupted download, which is a different concern from trusting this
// endpoint's content in the first place.
//
// The path resolves the same in dev (src/lib) and prod (dist/lib), both two levels below the root.
const DATA_PATH = new URL("../../data/maintenanceUf2.json", import.meta.url);

export interface EraseImageEntry {
  fileName: string;
  sha256: string;
  expectedFirstTargetAddress?: number;
}

export interface OtafixAssetEntry {
  // OTAFIX's own release-asset board slug (e.g. "wiscore_rak4631_board") — deliberately NOT
  // named the same as Meshtastic's platformioTarget (e.g. "rak4631", in otafixSupportedTargets
  // below): the two vocabularies differ per board, and a shared name here would invite exactly
  // the confusion the doc comment above already has to spell out in prose.
  otafixBoardSlug: string;
  sha256: string;
}

export interface MaintenanceUf2Manifest {
  manifestVersion: number;
  otafixReleaseTag: string;
  otafixBase: string;
  erase: {
    // Nested by architecture, then by SoftDevice wire value — RP2040 has no SoftDevice concept at
    // all, so it correctly has no sub-key, unlike the old flat {s140_6_1_1, s140_7_3_0, rp2040}
    // shape that mixed a SoftDevice-variant axis with an architecture axis in one object.
    nrf52: Record<string, EraseImageEntry>; // keyed by SoftDeviceVariant.fromWire's input, e.g. "6.1.1"
    rp2040: EraseImageEntry;
  };
  otafixByBoardId: Record<string, OtafixAssetEntry>;
  otafixSupportedTargets: string[];
}

// Parse once per process — the file only changes via a committed edit + redeploy, same as
// bootloaderOtaQuirks and eventFirmware.
let cachedManifest: MaintenanceUf2Manifest | null = null;

export const getMaintenanceUf2Manifest = (): MaintenanceUf2Manifest => {
  if (!cachedManifest) {
    cachedManifest = JSON.parse(
      readFileSync(DATA_PATH, "utf8"),
    ) as MaintenanceUf2Manifest;
  }
  return cachedManifest;
};

// Same naming convention as android's otafixAsset()/otafixUf2ForBoardId() — the release asset
// filename is derived, not stored, so the JSON doesn't repeat otafixReleaseTag per row.
export const otafixAssetFileName = (
  otafixBoardSlug: string,
  releaseTag: string,
): string => `update-${otafixBoardSlug}_bootloader-${releaseTag}_nosd.uf2`;

export const otafixAssetUrl = (otafixBoardSlug: string): string | null => {
  const manifest = getMaintenanceUf2Manifest();
  const fileName = otafixAssetFileName(
    otafixBoardSlug,
    manifest.otafixReleaseTag,
  );
  return `${manifest.otafixBase}/${fileName}`;
};
