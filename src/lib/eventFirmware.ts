import { readFileSync } from "node:fs";

// Event-firmware display metadata. Authored to the contract in
// meshtastic/Meshtastic-Android#5920 (schemas/event_firmware.schema.json). The committed file is
// already in the response envelope shape, so unlike deviceLinks there is nothing to transform —
// we parse and serve it verbatim. This repo is the source of truth the app syncs from.
// The path resolves the same in dev (src/lib) and prod (dist/lib), both two levels below the root.
const DATA_PATH = new URL("../../data/eventFirmware.json", import.meta.url);

export interface EventFirmwareLink {
  label: string;
  url: string;
}

export interface EventFirmwareEdition {
  edition: string; // FirmwareEdition proto enum name, e.g. "HAMVENTION"
  displayName: string;
  welcomeMessage: string;
  eventStart?: string | null;
  eventEnd?: string | null;
  timeZone?: string | null;
  location?: string | null;
  iconUrl?: string | null;
  accentColor?: string | null;
  links?: EventFirmwareLink[];
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
