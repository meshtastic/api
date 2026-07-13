import { App } from "@tinyhttp/app";
import { strict as assert } from "node:assert";
import test from "node:test";
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
