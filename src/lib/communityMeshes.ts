import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv/dist/types/index.js";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

const DATA_DIRECTORY = new URL("../../data/communityMeshes/", import.meta.url);
const SCHEMA_PATH = new URL(
  "../../schemas/community-mesh.schema.json",
  import.meta.url,
);

export interface CommunityMesh {
  id: string;
  schemaVersion: 1;
  [key: string]: unknown;
}

export interface CommunityMeshesResponse {
  apiVersion: "v1";
  schemaVersion: 1;
  generatedAt: string;
  sourceRevision: string;
  communities: CommunityMesh[];
}

const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as AnySchema;
const validate = new Ajv2020({ allErrors: true }).compile(schema);

const validPsk = (psk: unknown): boolean => {
  if (psk === null) return true;
  if (typeof psk !== "string") return false;
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      psk,
    )
  ) {
    return false;
  }
  return [0, 1, 16, 32].includes(Buffer.from(psk, "base64").length);
};

const validateSemantics = (record: CommunityMesh, filename: string): void => {
  const coverage = record.coverage as {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  };
  const polygons =
    coverage.type === "Polygon"
      ? [coverage.coordinates as number[][][]]
      : (coverage.coordinates as number[][][][]);
  for (const polygon of polygons) {
    for (const ring of polygon) {
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        throw new Error(`polygon ring is not closed in ${filename}`);
      }
    }
  }

  const profileIds = new Set<string>();
  const profiles = record.meshProfiles as Array<Record<string, unknown>>;
  for (const profile of profiles) {
    const id = profile.id as string;
    if (profileIds.has(id))
      throw new Error(`duplicate profile id in ${filename}: ${id}`);
    profileIds.add(id);

    const licensed = profile.licensed !== undefined;
    const radio = profile.radio as Record<string, unknown>;
    if (radio.overrideFrequencyMHz !== undefined && !licensed) {
      throw new Error(
        `override frequency requires a licensed profile in ${filename}`,
      );
    }

    const channels = [
      profile.primaryChannel,
      ...((profile.optionalChannels as unknown[] | undefined) ?? []),
    ] as Array<Record<string, unknown>>;
    for (const channel of channels) {
      if (Buffer.byteLength(channel.name as string, "utf8") > 12) {
        throw new Error(`channel name exceeds 12 bytes in ${filename}`);
      }
      if (!validPsk(channel.pskBase64))
        throw new Error(`invalid PSK in ${filename}`);
      if (licensed && channel.pskBase64 !== null) {
        throw new Error(
          `licensed profile contains an encrypted channel in ${filename}`,
        );
      }
    }
  }
};

export const loadCommunityMeshes = (
  directory = DATA_DIRECTORY,
): CommunityMesh[] => {
  const communities = readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".json") &&
        !entry.name.startsWith("_"),
    )
    .map((entry) => {
      const record: unknown = JSON.parse(
        readFileSync(new URL(entry.name, directory), "utf8"),
      );
      if (!validate(record)) {
        throw new Error(
          `community mesh validation failed for ${entry.name}: ${JSON.stringify(validate.errors)}`,
        );
      }
      const community = record as CommunityMesh;
      validateSemantics(community, entry.name);
      return community;
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  for (let index = 1; index < communities.length; index += 1) {
    if (communities[index - 1].id === communities[index].id) {
      throw new Error(`duplicate community id: ${communities[index].id}`);
    }
  }
  return communities;
};

const communities = loadCommunityMeshes();
const response: CommunityMeshesResponse = Object.freeze({
  apiVersion: "v1",
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceRevision: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
  communities,
});

export const registryEtag = `"${createHash("sha256")
  .update(JSON.stringify(communities))
  .digest("base64url")}"`;

export const getCommunityMeshes = (): CommunityMeshesResponse => response;

export const getCommunityMesh = (id: string): CommunityMesh | undefined =>
  communities.find((community) => community.id === id);

export const getCommunityMeshSchema = (): unknown => schema;
