# Community Mesh Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reviewed, static community-mesh registry API to `meshtastic/api` that exposes public provisioning profiles without receiving any user location.

**Architecture:** Community records live as one JSON file per mesh and are checked against a committed JSON Schema plus semantic rules at CI and process startup. A new route registers against a supplied TinyHTTP app, so focused Node tests can start only the registry routes; clients fetch one cacheable registry document and perform all GeoJSON location matching locally.

**Tech Stack:** TypeScript (ESM), Node built-in test runner through `tsx`, TinyHTTP, Ajv JSON Schema validation, committed JSON data, Biome, pnpm 9.

## Global Constraints

- Define no location, postal-code, device-identifier, or other user-specific discovery query.
- `GET /v1/community-meshes` returns the complete active registry; no nearby-search endpoint exists.
- GeoJSON coverage is public Polygon or MultiPolygon data in longitude/latitude order.
- A community has 1-3 profiles; a profile is a separate radio configuration, not a secondary channel.
- A profile has either a named modem preset or custom bandwidth/spreading-factor/coding-rate, never both.
- Position precision is not represented anywhere in this schema or API.
- MQTT is omitted by default. When present, its URL, username, password, and all fields are intentionally public join configuration.
- A licensed profile requires all channel PSKs to be `null`; client applications prompt for a callsign and set Ham mode, but the API does not receive or validate callsigns.
- Preserve existing API routes and their behavior.

---

### Task 1: Establish a focused Node test harness

**Files:**
- Modify: `package.json`
- Create: `tests/helpers/http.ts`
- Create: `tests/communityMeshes.routes.test.ts`

**Interfaces:**
- Consumes: `CommunityMeshRoutes(app: App): void` from Task 4.
- Produces: `withServer(app, callback): Promise<void>` for HTTP route tests.

- [ ] **Step 1: Add the test script and Ajv dependency**

```json
{
  "scripts": {
    "dev": "tsx src/index.ts",
    "start": "prisma migrate deploy && node dist/index.js",
    "build": "prisma generate && tsc",
    "test": "tsx --test tests/*.test.ts",
    "validate:community-meshes": "tsx src/scripts/validateCommunityMeshes.ts"
  },
  "dependencies": {
    "ajv": "^8.17.1"
  }
}
```

- [ ] **Step 2: Add an HTTP server helper**

```ts
import type { App } from "@tinyhttp/app";
import type { AddressInfo } from "node:net";

export const withServer = async (
  app: App,
  callback: (origin: string) => Promise<void>,
): Promise<void> => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;

  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
};
```

- [ ] **Step 3: Write the first failing route test**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { App } from "@tinyhttp/app";
import { CommunityMeshRoutes } from "../src/routes/communityMeshes.js";
import { withServer } from "./helpers/http.js";

test("community registry returns a location-independent response", async () => {
  const app = new App();
  CommunityMeshRoutes(app);

  await withServer(app, async (origin) => {
    const response = await fetch(`${origin}/v1/community-meshes`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "public, max-age=3600");
    assert.deepEqual(Object.keys(await response.json()), [
      "apiVersion",
      "schemaVersion",
      "generatedAt",
      "sourceRevision",
      "communities",
    ]);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm test -- communityMeshes.routes.test.ts`

Expected: FAIL because `src/routes/communityMeshes.ts` does not exist.

- [ ] **Step 5: Install and lock the dependency**

Run: `pnpm add ajv@^8.17.1`

Expected: `package.json` and `pnpm-lock.yaml` include Ajv; no unrelated dependency versions change.

- [ ] **Step 6: Commit the test harness**

```bash
git add package.json pnpm-lock.yaml tests/helpers/http.ts tests/communityMeshes.routes.test.ts
git commit -m "test: add community registry harness"
```

### Task 2: Define committed registry data and the complete JSON Schema

**Files:**
- Create: `schemas/community-mesh.schema.json`
- Create: `data/communityMeshes/_template.json`
- Create: `tests/communityMeshes.schema.test.ts`
- Create: `tests/fixtures/communityMeshes/valid-public-custom.json`
- Create: `tests/fixtures/communityMeshes/invalid-licensed-psk.json`
- Create: `tests/fixtures/communityMeshes/invalid-modem-union.json`

**Interfaces:**
- Produces: `CommunityMesh` documents validated by `community-mesh.schema.json`.
- Consumed by: `loadCommunityMeshes()` in Task 3 and contributor documentation in Task 5.

- [ ] **Step 1: Write failing schema tests**

```ts
import Ajv2020 from "ajv/dist/2020.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/communityMeshes/${name}`, import.meta.url), "utf8"));
const schema = JSON.parse(readFileSync(new URL("../schemas/community-mesh.schema.json", import.meta.url), "utf8"));
const validate = new Ajv2020({ allErrors: true }).compile(schema);

test("accepts a public custom-modem profile with public MQTT", () => {
  assert.equal(validate(fixture("valid-public-custom.json")), true);
});

test("rejects a licensed profile with an encrypted channel", () => {
  assert.equal(validate(fixture("invalid-licensed-psk.json")), false);
});

test("rejects a profile that defines both a preset and custom modem fields", () => {
  assert.equal(validate(fixture("invalid-modem-union.json")), false);
});
```

- [ ] **Step 2: Add the schema with these required definitions**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://api.meshtastic.org/v1/community-meshes/schema",
  "type": "object",
  "required": ["schemaVersion", "id", "name", "description", "coverage", "links", "meshProfiles"],
  "properties": {
    "schemaVersion": { "const": 1 },
    "id": { "type": "string", "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
    "meshProfiles": { "type": "array", "minItems": 1, "maxItems": 3, "items": { "$ref": "#/$defs/profile" } }
  },
  "$defs": {
    "profile": {
      "type": "object",
      "required": ["id", "name", "description", "radio", "primaryChannel"],
      "properties": {
        "radio": { "$ref": "#/$defs/radio" },
        "primaryChannel": { "$ref": "#/$defs/channel" },
        "optionalChannels": { "type": "array", "items": { "$ref": "#/$defs/channel" } },
        "mqtt": { "$ref": "#/$defs/mqtt" },
        "licensed": { "type": "object", "required": ["required"], "properties": { "required": { "const": true } }, "additionalProperties": false }
      },
      "additionalProperties": false
    },
    "radio": {
      "type": "object",
      "required": ["region", "modem", "frequencySlot", "maxHops", "txPowerDbm", "ignoreMqtt", "sx126xRxBoostedGain"],
      "properties": { "modem": { "oneOf": [{ "$ref": "#/$defs/presetModem" }, { "$ref": "#/$defs/customModem" }] } },
      "additionalProperties": false
    },
    "presetModem": { "type": "object", "required": ["kind", "preset"], "properties": { "kind": { "const": "preset" }, "preset": { "enum": ["SHORT_TURBO", "SHORT_FAST", "SHORT_SLOW", "MEDIUM_FAST", "MEDIUM_SLOW", "LONG_FAST", "LONG_MODERATE", "LONG_SLOW", "VERY_LONG_SLOW"] } }, "additionalProperties": false },
    "customModem": { "type": "object", "required": ["kind", "bandwidthKhz", "spreadFactor", "codingRate"], "properties": { "kind": { "const": "custom" }, "bandwidthKhz": { "enum": [31, 62, 125, 200, 250, 400, 500, 800, 1600] }, "spreadFactor": { "minimum": 5, "maximum": 12 }, "codingRate": { "minimum": 5, "maximum": 8 } }, "additionalProperties": false },
    "channel": { "type": "object", "required": ["name", "pskBase64", "uplinkEnabled", "downlinkEnabled"], "properties": { "name": { "type": "string", "maxLength": 12 }, "pskBase64": { "type": ["string", "null"] }, "uplinkEnabled": { "type": "boolean" }, "downlinkEnabled": { "type": "boolean" } }, "additionalProperties": false },
    "mqtt": { "type": "object", "required": ["serverAddress", "tlsEnabled", "encryptionEnabled", "jsonEnabled", "proxyToClientEnabled", "mapReportingEnabled"], "properties": { "serverAddress": { "type": "string", "minLength": 1 }, "username": { "type": "string" }, "password": { "type": "string" }, "tlsEnabled": { "type": "boolean" }, "encryptionEnabled": { "type": "boolean" }, "jsonEnabled": { "type": "boolean" }, "rootTopic": { "type": "string" }, "proxyToClientEnabled": { "type": "boolean" }, "mapReportingEnabled": { "type": "boolean" }, "mapReportingIntervalSeconds": { "type": "integer", "minimum": 3600 } }, "additionalProperties": false }
  }
}
```

Merge these exact properties and definitions into the same schema object above.
Do not add a position-precision property.

```json
{
  "properties": {
    "coverage": {
      "oneOf": [
        { "type": "object", "required": ["type", "coordinates"], "properties": { "type": { "const": "Polygon" }, "coordinates": { "$ref": "#/$defs/polygonCoordinates" } }, "additionalProperties": false },
        { "type": "object", "required": ["type", "coordinates"], "properties": { "type": { "const": "MultiPolygon" }, "coordinates": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/polygonCoordinates" } } }, "additionalProperties": false }
      ]
    },
    "links": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/link" } }
  },
  "$defs": {
    "position": { "type": "array", "minItems": 2, "maxItems": 2, "prefixItems": [{ "type": "number", "minimum": -180, "maximum": 180 }, { "type": "number", "minimum": -90, "maximum": 90 }], "items": false },
    "ring": { "type": "array", "minItems": 4, "items": { "$ref": "#/$defs/position" } },
    "polygonCoordinates": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/ring" } },
    "link": { "type": "object", "required": ["kind", "url"], "properties": { "kind": { "enum": ["website", "discord", "matrix", "telegram", "facebook", "instagram", "github", "other"] }, "url": { "type": "string", "pattern": "^https://" } }, "additionalProperties": false }
  }
}
```

The `radio.region` enum is exactly `UNSET`, `US`, `EU_433`, `EU_868`, `CN`, `JP`,
`ANZ`, `ANZ_433`, `KR`, `TW`, `RU`, `IN`, `NZ_865`, `TH`, `LORA_24`, `UA_433`,
`UA_868`, `MY_433`, `MY_919`, `SG_923`, `KZ_433`, `KZ_863`, `BR_902`, `PH_433`,
`PH_868`, `PH_915`, and `NP_865`. `radio.frequencySlot` is an integer at least
zero; `frequencyOffsetHz` is an integer from zero through one million;
`maxHops` is an integer from one through seven; `txPowerDbm` is an integer from
zero through 30; `ignoreMqtt` and `sx126xRxBoostedGain` are booleans; and
`overrideFrequencyMHz` is an optional positive number. `requirements` permits
only `minimumFirmware` matching `^\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?$`,
`positionIntervalMaxSeconds` as a positive integer, and
`telemetryIntervalMaxSeconds` as a positive integer. Semantic validation,
not JSON Schema, enforces ring closure, profile IDs, channel byte length, PSK
decode length, and licensed-profile cross-field rules.

- [ ] **Step 3: Add the contributor template**

```json
{
  "schemaVersion": 1,
  "id": "replace-with-community-id",
  "name": "Replace with community name",
  "description": "Replace with a clear public description.",
  "coverage": { "type": "Polygon", "coordinates": [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
  "links": [{ "kind": "website", "url": "https://example.org" }],
  "meshProfiles": [{ "id": "public", "name": "Public", "description": "Replace with profile description.", "radio": { "region": "US", "modem": { "kind": "preset", "preset": "LONG_FAST" }, "frequencySlot": 0, "frequencyOffsetHz": 0, "maxHops": 3, "txPowerDbm": 0, "ignoreMqtt": false, "sx126xRxBoostedGain": false }, "primaryChannel": { "name": "Public", "pskBase64": "AQ==", "uplinkEnabled": false, "downlinkEnabled": false }}]
}
```

- [ ] **Step 4: Run schema tests**

Run: `pnpm test -- communityMeshes.schema.test.ts`

Expected: PASS for valid fixture and FAIL assertions for each invalid fixture.

- [ ] **Step 5: Commit schema and data template**

```bash
git add schemas/community-mesh.schema.json data/communityMeshes/_template.json tests/communityMeshes.schema.test.ts tests/fixtures/communityMeshes
git commit -m "feat: define community mesh registry schema"
```

### Task 3: Load, validate, and expose typed registry data

**Files:**
- Create: `src/lib/communityMeshes.ts`
- Create: `src/scripts/validateCommunityMeshes.ts`
- Create: `tests/communityMeshes.lib.test.ts`

**Interfaces:**
- Produces: `CommunityMeshesResponse`, `getCommunityMeshes()`, `getCommunityMesh(id)`, `getCommunityMeshSchema()`, and `registryEtag`.
- Consumed by: `CommunityMeshRoutes()` in Task 4 and `validate:community-meshes` in CI.

- [ ] **Step 1: Write failing library tests**

```ts
test("skips the template and returns records ordered by id", () => {
  assert.deepEqual(getCommunityMeshes().communities.map(({ id }) => id), ["alpha", "beta"]);
});

test("fails startup validation for duplicate profile ids and invalid Base64 PSKs", () => {
  assert.throws(() => loadCommunityMeshes(fixtureDirectory("invalid")), /community mesh validation failed/);
});
```

- [ ] **Step 2: Implement the loader and semantic checks**

```ts
const DATA_DIRECTORY = new URL("../../data/communityMeshes/", import.meta.url);
const SCHEMA_PATH = new URL("../../schemas/community-mesh.schema.json", import.meta.url);

export const loadCommunityMeshes = (directory = DATA_DIRECTORY): CommunityMeshesResponse => {
  const communities = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith("_"))
    .map((entry) => JSON.parse(readFileSync(new URL(entry.name, directory), "utf8")) as unknown)
    .map(validateCommunityMesh)
    .sort((left, right) => left.id.localeCompare(right.id));

  validateUniqueIds(communities);
  return Object.freeze({ apiVersion: "v1", schemaVersion: 1, generatedAt: new Date().toISOString(), sourceRevision: process.env.VERCEL_GIT_COMMIT_SHA ?? "local", communities });
};
```

Define `fixtureDirectory = (name: string) => new URL(`../../tests/fixtures/communityMeshes/${name}/`, import.meta.url);` beside the test imports. Implement `validateCommunityMesh()` with Ajv against the committed schema, then semantic checks for: geometry ring closure and coordinate bounds; profile IDs; optional channel count/order; byte-length channel names; Base64 PSK byte lengths of 0, 1, 16, or 32; licensed profiles with only `null` PSKs; and `overrideFrequencyMHz` only on licensed profiles. Throw one error containing the filename and every validation error.

- [ ] **Step 3: Add a CLI validator**

```ts
import { getCommunityMeshes } from "../lib/communityMeshes.js";

const registry = getCommunityMeshes();
console.log(`Validated ${registry.communities.length} community mesh records.`);
```

- [ ] **Step 4: Run the focused tests and validator**

Run: `pnpm test -- communityMeshes.lib.test.ts && pnpm validate:community-meshes`

Expected: PASS; the command prints `Validated 0 community mesh records.` until a real community record is approved.

- [ ] **Step 5: Commit the registry library**

```bash
git add src/lib/communityMeshes.ts src/scripts/validateCommunityMeshes.ts tests/communityMeshes.lib.test.ts
git commit -m "feat: load validated community mesh records"
```

### Task 4: Serve cacheable, location-independent registry routes

**Files:**
- Create: `src/routes/communityMeshes.ts`
- Modify: `src/routes/index.ts`
- Modify: `src/index.ts`
- Modify: `tests/communityMeshes.routes.test.ts`

**Interfaces:**
- Consumes: `getCommunityMeshes()`, `getCommunityMesh(id)`, and `registryEtag` from Task 3.
- Produces: `CommunityMeshRoutes(app: App): void`.

- [ ] **Step 1: Extend failing route tests**

```ts
test("returns 304 when the registry ETag matches", async () => {
  const first = await fetch(`${origin}/v1/community-meshes`);
  const second = await fetch(`${origin}/v1/community-meshes`, { headers: { "If-None-Match": first.headers.get("etag") ?? "" } });
  assert.equal(second.status, 304);
});

test("serves the schema and returns 404 for an unknown community", async () => {
  assert.equal((await fetch(`${origin}/v1/community-meshes/schema`)).status, 200);
  assert.equal((await fetch(`${origin}/v1/community-meshes/not-found`)).status, 404);
});
```

- [ ] **Step 2: Implement the injected route registrar**

```ts
export const CommunityMeshRoutes = (app: App): void => {
  app.get("/v1/community-meshes", (req, res) => {
    const registry = getCommunityMeshes();
    if (req.headers["if-none-match"] === registryEtag) return res.status(304).end();
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("ETag", registryEtag);
    return res.json(registry);
  });
  app.get("/v1/community-meshes/schema", (_req, res) => res.json(getCommunityMeshSchema()));
  app.get("/v1/community-meshes/:id", (req, res) => {
    const community = getCommunityMesh(req.params.id ?? "");
    return community ? res.json(community) : res.status(404).json({ error: "community_not_found" });
  });
};
```

- [ ] **Step 3: Register the route without changing legacy route imports**

```ts
// src/routes/index.ts
export { CommunityMeshRoutes } from "./communityMeshes.js";

// src/index.ts
import { CommunityMeshRoutes, /* existing exports */ } from "./routes/index.js";
CommunityMeshRoutes(app);
```

Add `https://client.meshtastic.org` to the existing CORS allowlist so the official web client can fetch the public registry. Do not broaden CORS for unrelated endpoints.

- [ ] **Step 4: Run focused route tests**

Run: `pnpm test -- communityMeshes.routes.test.ts`

Expected: PASS for registry body, ETag 304, schema, and 404 behavior.

- [ ] **Step 5: Commit routes**

```bash
git add src/routes/communityMeshes.ts src/routes/index.ts src/index.ts tests/communityMeshes.routes.test.ts
git commit -m "feat: serve community mesh registry"
```

### Task 5: Document contribution and automate validation

**Files:**
- Create: `docs/community-mesh-registry.md`
- Create: `.github/pull_request_template.md`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: schema, template, and `pnpm validate:community-meshes` from Tasks 2-3.
- Produces: a documented GitHub PR submission and Meshtastic-admin approval process.

- [ ] **Step 1: Write the failing workflow expectation**

Add this command locally before changing CI:

Run: `pnpm validate:community-meshes`

Expected before Task 3: FAIL because the command does not exist; after Task 3: PASS.

- [ ] **Step 2: Add contributor instructions**

```markdown
## Submit a community mesh

1. Copy `data/communityMeshes/_template.json` to `data/communityMeshes/<community-id>.json`.
2. Draw a closed GeoJSON Polygon or MultiPolygon in longitude/latitude order.
3. Define one to three distinct RF profiles. Use either a Meshtastic modem preset or all three custom modem values.
4. Omit `mqtt` unless the community needs custom MQTT. Every MQTT value, including `password`, is public when committed.
5. Use `licensed.required: true` only for a no-encryption profile. Clients will collect a callsign locally; never add it to this file.
6. Run `pnpm validate:community-meshes`, `pnpm test`, `pnpm build`, and `pnpm biome ci`.
7. Open a PR and complete the review checklist.
```

- [ ] **Step 3: Add reviewer checklist and CI command**

```yaml
- name: Validate community mesh registry
  run: pnpm validate:community-meshes

- name: Test
  run: pnpm test
```

The PR template must require confirmation that the submitter is authorized to publish coverage and all public MQTT credentials, that radio settings comply with the stated region/licensed operation, and that links are community-owned.

- [ ] **Step 4: Run documentation checks**

Run: `pnpm validate:community-meshes && pnpm test && pnpm build && pnpm biome ci`

Expected: validator, tests, and build pass. Record pre-existing Biome warnings separately if they remain outside changed files; do not fix unrelated code.

- [ ] **Step 5: Commit contributor workflow**

```bash
git add docs/community-mesh-registry.md .github/pull_request_template.md .github/workflows/ci.yml README.md
git commit -m "docs: add community mesh submission workflow"
```

### Task 6: Verify the released contract end to end

**Files:**
- Modify: `README.md`
- Test: `tests/communityMeshes.routes.test.ts`

**Interfaces:**
- Consumes: every prior task.
- Produces: verified API examples for client teams.

- [ ] **Step 1: Add a full-contract test fixture and expected response**

```ts
const payload = await response.json() as {
  apiVersion: string;
  schemaVersion: number;
  generatedAt: string;
  sourceRevision: string;
  communities: unknown[];
};
assert.equal(payload.apiVersion, "v1");
assert.equal(payload.schemaVersion, 1);
assert.match(payload.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
assert.match(payload.sourceRevision, /^(local|[0-9a-f]{7,64})$/);
assert.deepEqual(payload.communities, []);
```

- [ ] **Step 2: Run the full verification suite**

Run: `pnpm validate:community-meshes && pnpm test && pnpm build && pnpm biome ci`

Expected: all new validator, unit, and HTTP tests pass; TypeScript build passes; no new Biome diagnostics appear in changed files.

- [ ] **Step 3: Manually verify no location leaves the client contract**

Run: `rg -n "lat|lon|location|nearby" src/routes/communityMeshes.ts docs/community-mesh-registry.md README.md`

Expected: `src/routes/communityMeshes.ts` contains no location-related route parameter or query handling. Documentation may only describe on-device matching.

- [ ] **Step 4: Commit the final contract verification**

```bash
git add README.md tests/communityMeshes.routes.test.ts
git commit -m "test: verify community mesh API contract"
```
