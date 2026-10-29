# `data/`

The documents this API serves. Everything here is committed, reviewed as a diff, and published by
CI — there is no runtime dependency on any upstream, and no database.

The **wire format** is `JSON.stringify(value, null, 2)`, UTF-8, no trailing newline, served as
`application/json` with no charset. The files on disk are *not* the wire bytes: the publisher
re-serializes (`tools/canonical.ts`). Never `cp` a file into the published output, and note that
`jq .` is not a substitute — it appends a newline.

| File | Route | Written by |
|---|---|---|
| `deviceLinks.json` | `/resource/deviceLinks` | `sync-device-links.yml`, hourly from msh.to |
| `eventFirmware.json` | `/resource/eventFirmware` | by hand |
| `bootloaderOtaQuirks.json` | `/resource/bootloaderOtaQuirks` | by hand |
| `maintenanceUf2.json` | `/resource/maintenanceUf2` | `sync-maintenance-uf2.yml`, by dispatch, via PR |
| `mqttRoots.json` | `/resource/mqttRoots` | by hand |
| `mqtt.snapshot.json` | *(none — frozen capture)* | captured once, 2026-09-01 |
| `updater.manifest.json` | `/updater/:app/:target/:arch/:ver` | captured once, 2026-09-01 |

The device hardware list is **not** here: it lives in `src/lib/resource.ts` as TypeScript on
purpose. Adding a board is this repo's most common PR, and keeping it as code means `tsc` and
`tools/validate.ts` are real gates on the most-consumed dataset in the API. A `.json` file would
delete that gate and replace it with nothing.

## `bootloaderOtaQuirks.json`

nRF52 bootloader/OTA quirk catalog. Source of truth was Meshtastic-Android's bundled
`androidApp/src/main/assets/device_bootloader_ota_quirks.json` (moved here 2026-08-20, per
thebentern) so other clients can read it without bundling their own stale copy.

Two fields with opposite failure semantics, and the difference matters:

- **`devices`** is *advisory* — devices that usually ship with a bootloader lacking OTA support and
  need a one-time USB upgrade before BLE DFU works. **Safe to fail open**: a client that cannot
  reach this endpoint should still let the update attempt proceed.
- **`softDeviceVariants`** gates a *destructive* flash — the wrong SoftDevice leaves a corrupted
  radio recoverable only over SWD/serial DFU. **Must fail closed**: an unresolved or absent entry
  is a deliberate refusal, not a gap to paper over with a best guess. `tools/validate.ts` fails the
  build if this list is ever empty.

## `maintenanceUf2.json`

Pinned nRF52/RP2040 maintenance UF2 manifest — factory-erase images and nRF52 bootloader
self-update images, keyed by hardware. Source of truth was Meshtastic-Android's
`feature/firmware/.../MaintenanceUf2.kt` (moved here 2026-08-20).

Two couplings ended when it moved here:

- The **erase images** used to be fetched from a commit-pinned `raw.githubusercontent.com` URL into
  meshtastic/web-flasher's `public/uf2/` (built from `meshtastic/nrf52_factory_erase`, GPL-3.0,
  which cuts no releases). They are now vendored into `static/maintenanceUf2/` and served by this
  API. See `static/maintenanceUf2/ATTRIBUTION.md`.
- The **OTAFIX board map** had been hand-copied into Apple's OTAFIX branch. The OTAFIX images stay
  hosted on `meshtastic/nRF52_Bootloader`'s GitHub releases (`otafixBase` +
  `otafixReleaseTag`), resolved by URL template rather than re-hosted — that repo does cut
  releases, and mirroring release binaries here would be a second copy to keep in sync.

`otafixBoardSlug` is deliberately **not** named the same as `platformioTarget`. They are different
vocabularies (`wiscore_rak4631_board` vs `rak4631`), and a shared name would invite exactly the
confusion this paragraph exists to prevent. The same trap exists for `architecture`: this data uses
hyphenated values (`esp32-s3`) while the firmware CI's artifact names do not (`esp32s3`).

A row's `targetOverrides` maps a `platformioTarget` to a different image for boards that ship a
bootloader reporting that row's Board-ID but have their own bootloader build (a stock Wio Tracker
L1 Pro 1W reports `TRACKER L1`). It is nested under the Board-ID so a target alone never selects an
image; the override's slug must be an asset some other row already maps, with the same digest.

Each image's `sha256` is checked against the downloaded bytes before any write. That guards against
a corrupted download — a different concern from trusting this endpoint's content in the first
place.

`sync-maintenance-uf2.yml` is `workflow_dispatch`-only and opens a PR rather than pushing, unlike
the device-links sync. That is deliberate: this data gates an irreversible bootloader write, so a
new board's Board-ID needs a human who has confirmed it on real hardware.

## `mqttRoots.json`

The geography an MQTT root topic finder cannot learn from a one-minute broker sample, shared so
Android and Apple suggest the same roots for the same place (meshtastic/design#167):

- **`entries`** are community roots whose name says nothing about where they are. Each gives the
  area it serves as ISO 3166-2 `subdivisions`, a `center` (`[lat, lon]`) and `radiusKm`, or both.
  Entries come from the public broker, not from claims: sample it for at least an hour, since map
  reports arrive at most hourly, and keep a root below the country or state level with at least
  three distinct map-reporting nodes. The center is their median position and the radius their
  90th-percentile distance from it, rounded up to 5 km with a 25 km floor. A root spread wider
  than 250 km is a republisher or a statewide root and stays out. Prune by hand after; an area
  is where a root's nodes are, never where a group says it serves.
- **`neighbors`** maps a subdivision to the ones it borders, both directions present, so a root in
  a bordering state ranks above unrelated ones.
- **`subdivisionSegments`** maps a geocoder's lowercased subdivision name to the topic segment
  (`washington` → `WA`), since platform geocoders disagree on which they return.

Radio settings do not belong here: Mesh Beacons carry those over RF.

## `mqtt.snapshot.json`

A one-time capture of `/mqtt` taken 2026-09-01: 2,692 gateways, 4,307 channels, every coordinate
null, timestamps from January 2024. The MQTT ingest died on 2024-07-15 (the topic parser never
matched region-prefixed topics) and the route is **removed in v2**.

It is committed anyway because the Postgres it came from is unreachable — nobody on this project
has Railway access — and `src/routes/mqtt.ts` catches a query failure and returns `[]`, so if that
database is ever reaped the payload is gone for good. Keeping it costs 1.6 MB in git and makes the
removal reversible if a consumer ever surfaces.

## `updater.manifest.json`

A one-time capture of what `/updater/:app/:target/:arch/:ver` returned: a Tauri updater manifest,
version 0.3.5, `pub_date` 2023-11-16. The old handler ignored all four path parameters (the per-app
gist lookup has been commented out for years) and proxied a hardcoded third-party gist on every
request. v2 serves these captured bytes instead, so the endpoint no longer depends on a gist
nobody here controls.
