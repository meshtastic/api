import { Ajv2020 } from "ajv/dist/2020.js";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadCommunityMeshes } from "../src/lib/communityMeshes.js";

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`./fixtures/communityMeshes/${name}`, import.meta.url),
      "utf8",
    ),
  );

const schema = JSON.parse(
  readFileSync(
    new URL("../schemas/community-mesh.schema.json", import.meta.url),
    "utf8",
  ),
);
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

test("rejects a schema-valid record with an invalid PSK encoding", () => {
  assert.throws(
    () =>
      loadCommunityMeshes(
        new URL("./fixtures/communityMeshes/invalid-semantic/", import.meta.url),
      ),
    /invalid PSK/,
  );
});
