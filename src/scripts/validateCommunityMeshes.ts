import { getCommunityMeshes } from "../lib/communityMeshes.js";

const registry = getCommunityMeshes();
console.log(`Validated ${registry.communities.length} community mesh records.`);
