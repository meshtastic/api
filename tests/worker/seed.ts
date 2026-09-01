import { env } from "cloudflare:test";

/** Seeds R2 with the objects the publisher would upload, so route tests exercise real reads. */
export const seed = async (): Promise<void> => {
  await env.DATA.put(
    "v1/resource/eventFirmware/icons/hamvention.png",
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]),
  );
  await env.DATA.put(
    "v1/resource/maintenanceUf2/asset/nrf_erase2.uf2",
    new Uint8Array([0x55, 0x46, 0x32, 0x0a, 9, 9, 9, 9]),
  );
  await env.DATA.put("v1/favicon.ico", new Uint8Array([0, 0, 1, 0]));
  await env.DATA.put(
    "v1/github/firmware/list.json",
    JSON.stringify(
      { releases: { stable: [], alpha: [] }, pullRequests: [] },
      null,
      2,
    ),
  );
  await env.DATA.put(
    "v1/github/releases.json",
    JSON.stringify([{ id: "v2.8.0", title: "t", page_url: "u" }], null, 2),
  );
};
