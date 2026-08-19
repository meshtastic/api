# Community Mesh Registry

The registry gives Meshtastic clients a reviewed, machine-readable list of
community radio configurations. Each community is one JSON file in
`data/communityMeshes/`, approved through the normal GitHub pull request review
process and published with this API.

## Privacy model

The API deliberately has no latitude/longitude lookup endpoint. Every client
downloads the same cacheable `GET /v1/community-meshes` response, uses each
record's GeoJSON bounding box as a fast first pass, and then performs the exact
point-in-polygon check on the device. A user's rough or precise location never
needs to leave the client.

## Submit a community

1. Copy `data/communityMeshes/_template.json` to a lowercase, hyphenated name
   such as `data/communityMeshes/example-city.json`.
2. Give the record a stable, unique `id`, public name, description, and at least
   one website or social link.
3. Draw the covered area as a GeoJSON `Polygon` or `MultiPolygon`. Coordinates
   use `[longitude, latitude]`, and every polygon ring must end with the same
   coordinate with which it starts.
4. Define one to three distinct `meshProfiles`. A profile is a separate radio
   mesh, normally with its own primary channel and frequency settings. Put the
   main choice first. Add secondary or tertiary profiles only when they exist.
5. Run `pnpm validate:community-meshes`, `pnpm test`, and `pnpm build`.
6. Open a pull request. A Meshtastic maintainer reviews the coverage, public
   contact information, radio settings, and security implications before merge.

## Radio and channel settings

Use a standard modem preset whenever possible. For a custom modem, define all
required LoRa parameters in the schema, including bandwidth, spreading factor,
and coding rate. Radio fields can also describe frequency slot and offset, hop
limit, transmit power, MQTT behavior, and supported hardware-specific options.
An explicit frequency override is restricted to licensed profiles.

Every unlicensed channel must have a valid Base64 PSK. A PSK in this public
repository is a shared channel key, not a secret and not an access-control
mechanism. Channel names may be no more than 12 UTF-8 bytes. The primary channel
is required; optional channels can be offered by clients as opt-in choices.

For a licensed profile, include the `licensed` configuration and set every
channel's `pskBase64` to `null`. Clients are responsible for asking for the
operator's callsign and applying Meshtastic's licensed-mode setting before
switching to that profile. The registry does not store user callsigns.

Profiles may set a minimum firmware version and maximum position or telemetry
intervals. The registry does not define position precision.

## MQTT

Omit `mqtt` when the community has no custom broker. When present, it can define
the public broker address or URL, port, TLS, username, password, root topic,
proxy-to-client behavior, JSON output, MQTT encryption, and map reporting
interval. Channel `uplinkEnabled` and `downlinkEnabled` flags control which
channels use it.

All registry data is public. Never submit a private broker credential. Use a
dedicated, least-privilege account intended for public distribution, and rotate
it by updating the community record if necessary.

The authoritative field definitions and limits are in
`schemas/community-mesh.schema.json`; the served copy is available at
`GET /v1/community-meshes/schema`.
