# Community Mesh Registry Design

## Goal

Publish a reviewed, versioned registry of community Meshtastic meshes at
`api.meshtastic.org`. Client applications download the same public registry,
match an on-device location against community coverage locally, show distinct
mesh profiles, and apply one selected profile after the user reviews the
changes.

The first deliverable is the registry API and GitHub-based approval workflow in
`meshtastic/api`. Apple, Android, Web, and CLI onboarding integrations are
follow-up projects that consume this stable contract.

## Scope and ownership

The registry is public configuration data, stored in the API repository. A
community administrator opens a pull request that changes one community JSON
file. Automated validation checks the submitted record. A Meshtastic
administrator reviews coverage, regulatory suitability, links, and any public
credentials, then merging the pull request approves and publishes the change.

Version 1 does not add a database, an authenticated write API, a custom admin
portal, or a license-validation service. GitHub history is the approval audit
trail. A future portal may create the same pull request rather than becoming a
second source of truth.

## Data source layout

```text
data/communityMeshes/
  _template.json
  <community-id>.json
schemas/
  community-mesh.schema.json
src/lib/
  communityMeshes.ts
src/routes/
  communityMeshes.ts
docs/
  community-mesh-registry.md
.github/
  pull_request_template.md
```

Each file contains exactly one `CommunityMesh` record. The stable community ID
is lower-case kebab case and is also the filename. A profile ID is unique within
its community. Keeping records separate minimizes conflicts between unrelated
community submissions.

## Community record

```json
{
  "schemaVersion": 1,
  "id": "portland-or",
  "name": "Portland Mesh",
  "description": "Community-operated Meshtastic coverage in Portland.",
  "coverage": {
    "type": "Polygon",
    "coordinates": [[[-122.90, 45.40], [-122.40, 45.40], [-122.40, 45.70], [-122.90, 45.70], [-122.90, 45.40]]]
  },
  "links": [
    { "kind": "website", "url": "https://example.org" },
    { "kind": "discord", "url": "https://discord.gg/example" }
  ],
  "meshProfiles": []
}
```

`coverage` is a GeoJSON `Polygon` or `MultiPolygon` in WGS84 longitude,
latitude order. It represents an administrator's claimed service area, not a
radio-propagation guarantee. Links use a known kind (`website`, `discord`,
`matrix`, `telegram`, `facebook`, `instagram`, `github`, or `other`) and an
HTTPS URL.

Every community defines one to three selectable `meshProfiles`. A profile is a
separate RF mesh, not a Meshtastic secondary channel. It has independent radio
configuration, a primary channel, optional extra channels, optional MQTT
configuration, and membership requirements.

## Mesh profile

```json
{
  "id": "portland-public",
  "name": "Portland Public",
  "description": "General-purpose community mesh.",
  "radio": {
    "region": "US",
    "modem": {
      "kind": "preset",
      "preset": "MEDIUM_FAST"
    },
    "frequencySlot": 12,
    "frequencyOffsetHz": 0,
    "maxHops": 3,
    "txPowerDbm": 0,
    "ignoreMqtt": false,
    "sx126xRxBoostedGain": false
  },
  "primaryChannel": {
    "name": "Portland",
    "pskBase64": "AQ==",
    "uplinkEnabled": false,
    "downlinkEnabled": false
  },
  "optionalChannels": [],
  "requirements": {
    "minimumFirmware": "2.7.0",
    "positionIntervalMaxSeconds": 900,
    "telemetryIntervalMaxSeconds": 1800
  }
}
```

The radio modem is a discriminated union:

```json
{
  "kind": "custom",
  "bandwidthKhz": 250,
  "spreadFactor": 11,
  "codingRate": 8
}
```

Preset mode specifies a Meshtastic modem preset. Custom mode must specify
bandwidth, spreading factor, and coding rate; it cannot also carry a preset.
`frequencySlot` is the configured LoRa channel number, where `0` retains
firmware's automatic primary-channel-name calculation. `frequencyOffsetHz`,
`maxHops`, `txPowerDbm`, `ignoreMqtt`, and `sx126xRxBoostedGain` map directly
to supported LoRa settings.

The registry intentionally excludes device-local or unsafe LoRa controls:
transmit disablement, ignored-node lists, PA fan behavior, and duty-cycle
override. It also contains no position-precision setting. Requirements express
the maximum allowed position and telemetry intervals only when a community
needs to state them.

An optional `overrideFrequencyMHz` is permitted only for a licensed profile.
This avoids distributing an out-of-band override as an ordinary public profile.

## Channels and licensing

`primaryChannel` is required. `optionalChannels` is an ordered list the client
offers to the user; it writes accepted channels consecutively after the primary
channel. Each channel has a name, a nullable `pskBase64`, and uplink/downlink
flags. A normal profile may publish a publicly joinable PSK because that is the
community's intended membership configuration. The value must decode to a
Meshtastic-supported PSK length.

```json
{
  "licensed": {
    "required": true
  }
}
```

A licensed profile contains this object, requires every channel PSK to be
`null`, and may use `overrideFrequencyMHz`. Registry data never contains a
callsign. A client applying such a profile uses fixed product copy, requires
the user to enter a callsign and acknowledge eligibility, sets the callsign as
the device long name, enables `isLicensed`, and removes encryption from every
installed channel. The client does not claim to validate a radio license.

## MQTT

MQTT is absent by default. A community includes `mqtt` only when that mesh
requires custom MQTT configuration. It may specify all supported public
connection fields, including the broker address and intentionally public
username/password:

```json
{
  "mqtt": {
    "serverAddress": "mqtt.example.org",
    "username": "community-user",
    "password": "community-password",
    "tlsEnabled": true,
    "encryptionEnabled": true,
    "jsonEnabled": false,
    "rootTopic": "msh/US/Portland",
    "proxyToClientEnabled": true,
    "mapReportingEnabled": false,
    "mapReportingIntervalSeconds": 3600
  }
}
```

All MQTT values in this public registry, including a password, are deliberately
public join configuration. Maintainers reject accidental secrets. The
per-channel `uplinkEnabled` and `downlinkEnabled` fields define whether the
profile permits gateway traffic; the MQTT module configuration alone does not
enable channel traffic.

## API

The route is versioned independently of existing API routes:

| Endpoint | Response |
| --- | --- |
| `GET /v1/community-meshes` | The complete active registry, including coverage and public provisioning values. |
| `GET /v1/community-meshes/{id}` | One full community record for direct links or manual browsing. |
| `GET /v1/community-meshes/schema` | The current JSON Schema. |

Every response includes `apiVersion`, `schemaVersion`, `generatedAt`, and the
source revision. Responses use `ETag`, compression, and public cache headers.
A missing ID returns `404`. The registry never accepts a latitude, longitude,
postal code, device identifier, or other user-specific lookup parameter.

The complete registry is deliberately small enough to cache locally. Each
client makes the same periodic request regardless of its location, then uses a
bounding-box prefilter followed by an exact local point-in-polygon check against
the GeoJSON coverage. The location never leaves the device and is not persisted
for discovery. A user who declines location permission can pan a local map or
select a community manually. If registry growth makes the full download too
large, clients may retain the full index and offer opt-in country/region packs;
the default privacy-preserving request remains location-independent.

## Client contract

Client integrations refresh the common cached registry, find nearby profiles
locally, and show a configuration diff before writing any radio setting. They
must:

1. Check minimum firmware, region/modem compatibility, and managed-mode status.
2. Let the user accept or decline every optional channel.
3. Prompt for a callsign before applying a licensed profile.
4. Save a local rollback snapshot.
5. Apply user, radio, primary/optional channels, interval requirements, and
   optional MQTT configuration.
6. Reconnect after a radio reboot, read every setting back, and report a clear
   failure if verification differs from the profile.
7. Restore the snapshot if the application transaction fails before completion.

Client implementations are separate repository projects because their platform
transport, UI, and rollback facilities differ. They consume this API contract
without defining their own incompatible community data format.

## Validation, test, and review policy

The registry validator and tests must enforce:

- JSON Schema validation for every source record and template.
- Valid Polygon and MultiPolygon rings, coordinate bounds, and non-empty
  coverage.
- Unique community and profile IDs, one to three profiles per community, and
  valid HTTPS links.
- Exactly one radio modem mode; supported custom modem ranges; valid region,
  frequency slot, hops, and transmit-power values.
- Licensed profile encryption rules and the restriction on override frequency.
- Primary-channel name length, optional-channel ordering, valid Base64 PSKs,
  and valid MQTT field combinations.
- Semantic minimum firmware versions and positive maximum-interval
  requirements.
- On-device point-in-polygon lookup for ordinary polygons, holes,
  multipolygons, and boundary cases, with bounding-box prefiltering.
- No location-bearing API route or request parameter.
- `404`, cache, schema, complete-registry, and full-record route behavior.

The pull-request template requires the submitter to identify the community,
confirm authority to publish the coverage and credentials, describe radio and
licensed-operation legality, and state how maintainers can verify links. CI
runs registry validation, type checking, and formatting. A Meshtastic
administrator is the final approval authority.

## Out of scope

- A hosted submission form or self-service account system.
- Secret or per-user credential delivery.
- Radio-license verification.
- RF coverage measurement, propagation prediction, or uptime guarantees.
- Applying profiles directly from this API repository to a radio.
