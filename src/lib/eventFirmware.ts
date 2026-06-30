import { readFileSync } from "node:fs";

// Event-firmware metadata. The envelope originates from the contract in
// meshtastic/Meshtastic-Android#5920 (schemas/event_firmware.schema.json); version 2 adds the
// tag/domain/theme/firmware fields the web-flasher needs (Android's parser ignores unknown fields).
// The committed file is already in the response envelope shape, so unlike deviceLinks there is
// nothing to transform — we parse and serve it verbatim. This repo is the source of truth the
// Android app and web-flasher sync from.
// The path resolves the same in dev (src/lib) and prod (dist/lib), both two levels below the root.
const DATA_PATH = new URL("../../data/eventFirmware.json", import.meta.url);

export interface EventFirmwareLink {
  label: string;
  url: string;
}

// Brand/theme metadata for ambient event styling (web-flasher tints its whole
// UI from this; Android may adopt it later). accentColor stays the single
// primary swatch for clients that only want one color; theme.colors.primary
// mirrors it. All optional — only DEFCON ships a full published style guide.
export interface EventFirmwareTheme {
  name?: string | null; // theme title, e.g. "Agency"
  tagline?: string | null; // one-line theme statement
  colors?: {
    primary?: string | null;
    secondary?: string | null;
    accent?: string | null;
  } | null;
  palette?: string[] | null; // full brand swatch list (#RRGGBB)
  fonts?: { heading?: string | null; body?: string | null } | null;
}

// Pointer to the event's firmware build. The binary lives at
// meshtastic.github.io/event/{slug}/firmware-{version}.zip — slug is owned here,
// version/id/zipUrl are null until that build ships.
export interface EventFirmwareBuild {
  slug: string; // event path segment, e.g. "defcon2026"
  version?: string | null; // e.g. "2.7.23.07741e6"
  id?: string | null; // e.g. "v2.7.23.07741e6"
  title?: string | null; // e.g. "Meshtastic Firmware 2.7.23.07741e6"
  zipUrl?: string | null; // full event firmware zip URL
  releaseNotes?: string | null; // markdown
}

export interface EventFirmwareEdition {
  edition: string; // FirmwareEdition proto enum name, e.g. "HAMVENTION"
  displayName: string;
  welcomeMessage: string;
  tag?: string | null; // short label (web-flasher eventTag), e.g. "DEFCON"
  eventStart?: string | null;
  eventEnd?: string | null;
  timeZone?: string | null;
  location?: string | null;
  iconUrl?: string | null;
  accentColor?: string | null;
  domain?: string | null; // host the web-flasher matches, e.g. "defcon.meshtastic.org"
  links?: EventFirmwareLink[];
  theme?: EventFirmwareTheme | null;
  firmware?: EventFirmwareBuild | null;
}

export interface EventFirmwareResponse {
  version: number;
  generatedAt?: string;
  source?: string;
  editions: EventFirmwareEdition[];
}

// Parse once per process — the file only changes via a committed edit + redeploy.
let cached: EventFirmwareResponse | null = null;

export const getEventFirmware = (): EventFirmwareResponse => {
  if (!cached) {
    cached = JSON.parse(
      readFileSync(DATA_PATH, "utf8"),
    ) as EventFirmwareResponse;
  }
  return cached;
};
