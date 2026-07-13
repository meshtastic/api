import { Ajv2020 } from "ajv/dist/2020.js";
import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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

test("the contributor template remains schema-valid", () => {
  const template = JSON.parse(
    readFileSync(
      new URL("../data/communityMeshes/_template.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(validate(template), true, JSON.stringify(validate.errors));
});

const withRecords = (
  records: unknown[],
  callback: (directory: URL) => void,
): void => {
  const directory = mkdtempSync(join(tmpdir(), "community-mesh-test-"));
  try {
    records.forEach((record, index) =>
      writeFileSync(join(directory, `${index}.json`), JSON.stringify(record)),
    );
    callback(pathToFileURL(`${directory}/`));
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
};

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
        new URL(
          "./fixtures/communityMeshes/invalid-semantic/",
          import.meta.url,
        ),
      ),
    /invalid PSK/,
  );
});

test("rejects duplicate community ids", () => {
  const record = fixture("valid-public-custom.json");
  withRecords([record, record], (directory) => {
    assert.throws(
      () => loadCommunityMeshes(directory),
      /duplicate community id/,
    );
  });
});

test("rejects an open GeoJSON polygon ring", () => {
  const record = structuredClone(fixture("valid-public-custom.json")) as {
    coverage: { coordinates: number[][][] };
  };
  record.coverage.coordinates[0][3] = [2, 2];
  withRecords([record], (directory) => {
    assert.throws(
      () => loadCommunityMeshes(directory),
      /polygon ring is not closed/,
    );
  });
});
