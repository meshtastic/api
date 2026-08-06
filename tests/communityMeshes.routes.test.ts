import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
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

test("registry uses ETags for cache revalidation", async () => {
  const app = new App();
  CommunityMeshRoutes(app);

  await withServer(app, async (origin) => {
    const first = await fetch(`${origin}/v1/community-meshes`);
    const etag = first.headers.get("etag");
    assert.ok(etag);
    const body = await first.text();
    const expectedEtag = `"${createHash("sha256")
      .update(body)
      .digest("base64url")}"`;
    assert.equal(etag, expectedEtag);

    const second = await fetch(`${origin}/v1/community-meshes`, {
      headers: { "If-None-Match": etag },
    });
    assert.equal(second.status, 304);
    assert.equal(second.headers.get("etag"), etag);
  });
});

test("registry accepts standard If-None-Match validator forms", async () => {
  const app = new App();
  CommunityMeshRoutes(app);

  await withServer(app, async (origin) => {
    const first = await fetch(`${origin}/v1/community-meshes`);
    const etag = first.headers.get("etag");
    assert.ok(etag);

    const validators = [`W/${etag}`, `"unrelated", W/${etag}`, "*"];
    for (const validator of validators) {
      const response = await fetch(`${origin}/v1/community-meshes`, {
        headers: { "If-None-Match": validator },
      });
      assert.equal(response.status, 304, validator);
    }
  });
});

test("serves the schema and returns 404 for an unknown community", async () => {
  const app = new App();
  CommunityMeshRoutes(app);

  await withServer(app, async (origin) => {
    const schema = await fetch(`${origin}/v1/community-meshes/schema`);
    assert.equal(schema.status, 200);
    assert.equal(
      ((await schema.json()) as { $id: string }).$id,
      "https://api.meshtastic.org/v1/community-meshes/schema",
    );

    const missing = await fetch(`${origin}/v1/community-meshes/not-found`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "community_not_found" });
  });
});
