import { createPrivateKey, sign as createSignature } from "node:crypto";
import { readFileSync } from "node:fs";

const DATA_PATH = new URL("../../data/eventFirmwareOTA.json", import.meta.url);
const EDITION_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:\.[0-9A-Za-z_-]+)?$/;
const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const IMMUTABLE_RAW_GITHUB_RE =
  /^\/meshtastic\/meshtastic\.github\.io\/[0-9a-f]{40}\/.+/i;
const ESP32_ARCHITECTURES = new Set([
  "esp32",
  "esp32-c3",
  "esp32-c6",
  "esp32-s3",
]);

export interface EventFirmwareOTAEnvelope {
  keyId: string;
  payload: string;
  signature: string;
}

export interface EventFirmwareOTAArtifact {
  pioEnv: string;
  hwModel: number;
  architecture: string;
  version: string;
  format: "bin" | "otaZip";
  url: string;
  sha256: string;
  byteCount: number;
  minimumSourceVersion: string;
  partitionRole: string | null;
  partitionScheme: string | null;
  dfuProtocol: string | null;
  minimumBootloaderVersion: string | null;
}

export interface EventFirmwareOTAContract {
  schemaVersion: number;
  releaseId: string;
  edition: string;
  version: string;
  issuedAt: string;
  expiresAt: string;
  artifacts: EventFirmwareOTAArtifact[];
  standardArtifacts: EventFirmwareOTAArtifact[];
}

export interface EventFirmwareOTAData {
  version: number;
  contracts: EventFirmwareOTAContract[];
}

let cached: EventFirmwareOTAData | null = null;

const fail = (message: string): never => {
  throw new Error(`Invalid event firmware OTA contract: ${message}`);
};

const validateArtifact = (artifact: EventFirmwareOTAArtifact): void => {
  if (
    !artifact.pioEnv ||
    !Number.isSafeInteger(artifact.hwModel) ||
    artifact.hwModel < 0
  ) {
    fail("artifact target is incomplete");
  }
  if (
    !VERSION_RE.test(artifact.version) ||
    !VERSION_RE.test(artifact.minimumSourceVersion) ||
    !SHA256_RE.test(artifact.sha256) ||
    !Number.isSafeInteger(artifact.byteCount) ||
    artifact.byteCount <= 0
  ) {
    fail("artifact integrity metadata is invalid");
  }

  let url: URL;
  try {
    url = new URL(artifact.url);
  } catch {
    throw new Error(
      "Invalid event firmware OTA contract: artifact URL is invalid",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "raw.githubusercontent.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !IMMUTABLE_RAW_GITHUB_RE.test(url.pathname)
  ) {
    fail("artifact URL is not an approved immutable release URL");
  }

  if (ESP32_ARCHITECTURES.has(artifact.architecture)) {
    if (
      artifact.format !== "bin" ||
      artifact.partitionRole !== "app0" ||
      !artifact.partitionScheme ||
      artifact.dfuProtocol !== null ||
      artifact.minimumBootloaderVersion !== null ||
      artifact.byteCount > 16 * 1024 * 1024
    ) {
      fail("ESP32 artifact metadata is incompatible");
    }
    return;
  }

  if (artifact.architecture === "nrf52840") {
    if (
      artifact.format !== "otaZip" ||
      artifact.partitionRole !== null ||
      artifact.partitionScheme !== null ||
      artifact.dfuProtocol !== "nordic-legacy" ||
      !artifact.minimumBootloaderVersion ||
      artifact.byteCount > 4 * 1024 * 1024
    ) {
      fail("nRF artifact metadata is incompatible");
    }
    return;
  }

  fail("artifact architecture is not supported for in-app OTA");
};

const validateArtifactSet = (
  name: string,
  artifacts: EventFirmwareOTAArtifact[],
): void => {
  const targets = new Set<string>();
  for (const artifact of artifacts) {
    validateArtifact(artifact);
    const target = [
      artifact.pioEnv,
      artifact.hwModel,
      artifact.architecture,
    ].join(":");
    if (targets.has(target)) {
      fail(`${name} contains a duplicate exact target`);
    }
    targets.add(target);
  }
};

const isExactISO8601Timestamp = (value: string): boolean => {
  if (!ISO8601_RE.test(value)) return false;
  const date = new Date(value);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().replace(".000Z", "Z") === value
  );
};

export const validateEventFirmwareOTAContract = (
  contract: EventFirmwareOTAContract,
): void => {
  if (
    contract.schemaVersion !== 1 ||
    !IDENTIFIER_RE.test(contract.releaseId) ||
    !EDITION_RE.test(contract.edition) ||
    !VERSION_RE.test(contract.version)
  ) {
    fail("release identity is invalid");
  }

  if (
    !isExactISO8601Timestamp(contract.issuedAt) ||
    !isExactISO8601Timestamp(contract.expiresAt)
  ) {
    fail("validity timestamps must use UTC ISO-8601 seconds");
  }
  const issuedAt = Date.parse(contract.issuedAt);
  const expiresAt = Date.parse(contract.expiresAt);
  if (
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= issuedAt
  ) {
    fail("validity window is invalid");
  }
  if (
    !Array.isArray(contract.artifacts) ||
    !Array.isArray(contract.standardArtifacts) ||
    contract.artifacts.length === 0 ||
    contract.standardArtifacts.length === 0
  ) {
    fail("event and standard artifact sets are required");
  }

  validateArtifactSet("artifacts", contract.artifacts);
  validateArtifactSet("standardArtifacts", contract.standardArtifacts);
  if (
    contract.artifacts.some((artifact) => artifact.version !== contract.version)
  ) {
    fail("event artifact version does not match the release");
  }
};

export const validateEventFirmwareOTAData = (
  data: EventFirmwareOTAData,
): void => {
  if (data.version !== 1 || !Array.isArray(data.contracts)) {
    fail("data envelope is invalid");
  }
  const editions = new Set<string>();
  const releaseIds = new Set<string>();
  for (const contract of data.contracts) {
    validateEventFirmwareOTAContract(contract);
    if (editions.has(contract.edition) || releaseIds.has(contract.releaseId)) {
      fail("data contains a duplicate edition or release identifier");
    }
    editions.add(contract.edition);
    releaseIds.add(contract.releaseId);
  }
};

const getEventFirmwareOTAData = (): EventFirmwareOTAData => {
  if (!cached) {
    cached = JSON.parse(
      readFileSync(DATA_PATH, "utf8"),
    ) as EventFirmwareOTAData;
    validateEventFirmwareOTAData(cached);
  }
  return cached;
};

export const findEventFirmwareOTAContract = (
  contracts: EventFirmwareOTAContract[],
  edition: string,
): EventFirmwareOTAContract | null => {
  const normalized = edition.toUpperCase();
  if (!EDITION_RE.test(normalized)) return null;
  return contracts.find((contract) => contract.edition === normalized) ?? null;
};

export const getEventFirmwareOTAContract = (
  edition: string,
): EventFirmwareOTAContract | null =>
  findEventFirmwareOTAContract(getEventFirmwareOTAData().contracts, edition);

export const signEventFirmwareOTAContract = (
  contract: EventFirmwareOTAContract,
  keyId: string,
  privateKeyPem: string,
): EventFirmwareOTAEnvelope => {
  validateEventFirmwareOTAContract(contract);
  if (!IDENTIFIER_RE.test(keyId)) {
    fail("signing key identifier is invalid");
  }

  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519") {
    fail("signing key must be Ed25519");
  }
  const payload = Buffer.from(JSON.stringify(contract));
  return {
    keyId,
    payload: payload.toString("base64"),
    signature: createSignature(null, payload, privateKey).toString("base64"),
  };
};
