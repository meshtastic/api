import type { App } from "@tinyhttp/app";
import {
  getCommunityMesh,
  getCommunityMeshSchema,
  registryEtag,
  registryJson,
} from "../lib/communityMeshes.js";

const ifNoneMatchMatches = (
  header: string | undefined,
  etag: string,
): boolean => {
  if (!header) return false;
  const validators = header.match(/(?:W\/)?"[^"]*"|\*/g) ?? [];
  return validators.some(
    (validator) => validator === "*" || validator.replace(/^W\//, "") === etag,
  );
};

export const CommunityMeshRoutes = (app: App): void => {
  app.get("/v1/community-meshes", (req, res) => {
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("ETag", registryEtag);
    if (ifNoneMatchMatches(req.headers["if-none-match"], registryEtag)) {
      return res.status(304).end();
    }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.send(registryJson);
  });

  app.get("/v1/community-meshes/schema", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.json(getCommunityMeshSchema());
  });

  app.get("/v1/community-meshes/:id", (req, res) => {
    const community = getCommunityMesh(req.params.id);
    if (!community) {
      return res.status(404).json({ error: "community_not_found" });
    }
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.json(community);
  });
};
