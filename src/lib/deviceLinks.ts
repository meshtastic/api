import { readFileSync } from "node:fs";
import { deviceHardwareList } from "./resource.js";

// Device-link catalog, synced from msh.to's public /api/urls INTO this repo by a scheduled
// GitHub Action (.github/workflows/sync-device-links.yml). We read the committed file — no
// runtime dependency on msh.to. The path resolves the same in dev (src/lib) and prod (dist/lib),
// both two levels below the repo root, so it is independent of the working directory.
const CATALOG_PATH = new URL("../../data/deviceLinks.json", import.meta.url);
const SOURCE = "https://msh.to/api/urls";

// Shape of the synced catalog (PascalCase, mirrors msh.to's urls.json / /api/urls).
interface Route {
  ShortCode: string;
  OriginalUrl: string;
  Description?: string;
  Type?: string;
  Targets?: string[];
}

interface Marketplace {
  Regions?: string[];
}

interface Catalog {
  Routes?: Route[];
  Marketplaces?: Record<string, Marketplace> | null;
}

export interface DeviceLink {
  shortCode: string;
  url: string;
  originalUrl: string;
  description?: string;
  type: "internal" | "vendor" | "marketplace";
  targets: string[] | null; // null = untriaged, [] = intentionally device-agnostic
  hwModels: number[] | null; // derived from targets via deviceHardwareList
  marketplace: string | null;
  regions: string[] | null; // null = worldwide (no region filter)
}

export interface DeviceLinksResponse {
  version: number;
  generatedAt: string;
  source: string;
  links: DeviceLink[];
}

const targetToHwModel = new Map(
  deviceHardwareList.map((d) => [d.platformioTarget, d.hwModel]),
);

const resolve = (): DeviceLinksResponse => {
  const data = JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as Catalog;
  const routes = data.Routes ?? [];
  const marketplaces = data.Marketplaces ?? {}; // tolerate null/absent
  const retailers = Object.keys(marketplaces);

  // Token detection only picks which region list applies — Type is authoritative for classification.
  const retailerOf = (code: string): string | null =>
    retailers.find(
      (m) =>
        code.startsWith(`${m}-`) ||
        code.startsWith(`${m}_`) ||
        code.endsWith(`-${m}`) ||
        code.endsWith(`_${m}`) ||
        code === m,
    ) ?? null;

  const links: DeviceLink[] = routes.map((r) => {
    const t = (r.Type ?? "").toLowerCase();
    const type: DeviceLink["type"] =
      t === "vendor"
        ? "vendor"
        : t === "marketplace"
          ? "marketplace"
          : "internal";
    const targets = r.Targets ?? null;
    const marketplace = type === "marketplace" ? retailerOf(r.ShortCode) : null;
    const regions = marketplace
      ? (marketplaces[marketplace]?.Regions ?? null)
      : null;
    return {
      shortCode: r.ShortCode,
      url: `https://msh.to/${r.ShortCode}`,
      originalUrl: r.OriginalUrl,
      description: r.Description,
      type,
      targets,
      hwModels:
        targets
          ?.map((x) => targetToHwModel.get(x))
          .filter((m): m is number => m != null) ?? null,
      marketplace,
      regions: regions?.length ? regions : null, // []/missing => null = worldwide
    };
  });

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: SOURCE,
    links,
  };
};

// Resolve once per process. The catalog only changes via a committed file + redeploy,
// so there is nothing to invalidate at runtime.
let cached: DeviceLinksResponse | null = null;

export const getDeviceLinks = (): DeviceLinksResponse => {
  if (!cached) cached = resolve();
  return cached;
};
