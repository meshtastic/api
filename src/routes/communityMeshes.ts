import type { App } from "@tinyhttp/app";
import {
  getCommunityMesh,
  getCommunityMeshes,
  getCommunityMeshSchema,
  registryEtag,
} from "../lib/communityMeshes.js";

export const CommunityMeshRoutes = (app: App): void => {
  app.get("/v1/community-meshes", (req, res) => {
    if (req.headers["if-none-match"] === registryEtag) {
      return res.status(304).end();
    }
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("ETag", registryEtag);
    return res.json(getCommunityMeshes());
  });
  app.get("/v1/community-meshes/schema", (_req, res) =>
    res.json(getCommunityMeshSchema()),
  );
  app.get("/v1/community-meshes/:id", (req, res) => {
    const community = getCommunityMesh(req.params.id ?? "");
    return community
      ? res.json(community)
      : res.status(404).json({ error: "community_not_found" });
  });
};
