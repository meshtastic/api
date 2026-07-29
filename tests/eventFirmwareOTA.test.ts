import { strict as assert } from "node:assert";
import { generateKeyPairSync, verify as verifySignature } from "node:crypto";
import { describe, it } from "node:test";
import {
  type EventFirmwareOTAContract,
  findEventFirmwareOTAContract,
  signEventFirmwareOTAContract,
  validateEventFirmwareOTAContract,
} from "../src/lib/eventFirmwareOTA.js";

const artifact = {
  pioEnv: "tbeam-s3-core",
  hwModel: 12,
  architecture: "esp32-s3",
  version: "2.8.0.b00d76f",
  format: "bin" as const,
  url: "https://raw.githubusercontent.com/meshtastic/meshtastic.github.io/f6688533ba0c57f33d42d99958656d3e8a2057e6/event/defcon34/firmware.bin",
  sha256: "a".repeat(64),
  byteCount: 2_383_792,
  minimumSourceVersion: "2.7.26",
  partitionRole: "app0",
  partitionScheme: "8MB",
  dfuProtocol: null,
  minimumBootloaderVersion: null,
};

const contract: EventFirmwareOTAContract = {
  schemaVersion: 1,
  releaseId: "defcon34-2.8.0.b00d76f",
  edition: "DEFCON",
  version: "2.8.0.b00d76f",
  issuedAt: "2026-07-29T00:00:00Z",
  expiresAt: "2026-10-01T00:00:00Z",
  artifacts: [artifact],
  standardArtifacts: [
    {
      ...artifact,
      version: "2.7.26.54e0d8d",
      url: "https://raw.githubusercontent.com/meshtastic/meshtastic.github.io/869f193161a1d03460d901ad827483871d74f692/firmware-2.7.26/firmware.bin",
      sha256: "b".repeat(64),
      byteCount: 2_213_168,
    },
  ],
};

describe("event firmware OTA contract", () => {
  it("signs the exact payload bytes with Ed25519", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const envelope = signEventFirmwareOTAContract(
      contract,
      "event-release-2026",
      privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    );

    const payload = Buffer.from(envelope.payload, "base64");
    assert.deepEqual(JSON.parse(payload.toString()), contract);
    assert.equal(
      verifySignature(
        null,
        payload,
        publicKey,
        Buffer.from(envelope.signature, "base64"),
      ),
      true,
    );
  });

  it("selects contracts by normalized edition name", () => {
    assert.equal(findEventFirmwareOTAContract([contract], "defcon"), contract);
    assert.equal(findEventFirmwareOTAContract([contract], "../DEFCON"), null);
  });

  it("rejects mutable artifact URLs", () => {
    const mutable = {
      ...contract,
      artifacts: [
        {
          ...artifact,
          url: "https://raw.githubusercontent.com/meshtastic/meshtastic.github.io/master/event/defcon34/firmware.bin",
        },
      ],
    };
    assert.throws(() => validateEventFirmwareOTAContract(mutable));
  });

  it("rejects duplicate exact targets", () => {
    const duplicate = {
      ...contract,
      artifacts: [artifact, artifact],
    };
    assert.throws(() => validateEventFirmwareOTAContract(duplicate));
  });

  it("rejects timestamps that the Apple decoder cannot consume", () => {
    const fractionalTimestamp = {
      ...contract,
      issuedAt: "2026-07-29T00:00:00.000Z",
    };
    assert.throws(() => validateEventFirmwareOTAContract(fractionalTimestamp));
  });

  it("rejects malformed signing key identifiers", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    assert.throws(() =>
      signEventFirmwareOTAContract(
        contract,
        "../release-key",
        privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      ),
    );
  });

  it("rejects incompatible architecture metadata", () => {
    const incompatible = {
      ...contract,
      artifacts: [
        {
          ...artifact,
          format: "otaZip" as const,
          partitionRole: null,
          partitionScheme: null,
          dfuProtocol: "nordic-legacy",
          minimumBootloaderVersion: "0.6.1",
        },
      ],
    };
    assert.throws(() => validateEventFirmwareOTAContract(incompatible));
  });
});
