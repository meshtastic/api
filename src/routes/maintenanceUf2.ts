import { readFileSync } from "node:fs";
import { app } from "../index.js";
import { getMaintenanceUf2Manifest } from "../lib/maintenanceUf2.js";

// Vendored erase-image binaries — see maintenanceUf2.ts for why these are hosted here rather
// than at web-flasher's public/uf2/. :file is constrained to a bare "<name>.uf2" so it can never
// escape this directory; the manifest's own fileName values are the only ones that ever resolve.
const ASSET_DIR = new URL("../../static/maintenanceUf2/", import.meta.url);
const FILE_RE = /^([a-z0-9_-]+\.uf2)$/;

// Cache each asset buffer by filename on first request — files only change on redeploy.
const assetCache = new Map<string, Buffer>();

export const MaintenanceUf2Routes = () => {
  app.get("resource/maintenanceUf2", (_req, res) => {
    try {
      res.json(getMaintenanceUf2Manifest());
    } catch (err) {
      console.error("maintenanceUf2", err);
      res.sendStatus(502);
    }
  });

  app.get("resource/maintenanceUf2/asset/:file", (req, res) => {
    const match = FILE_RE.exec(req.params.file ?? "");
    if (!match) return res.sendStatus(404);
    const fileName = match[1];

    try {
      let asset = assetCache.get(fileName);
      if (!asset) {
        asset = readFileSync(new URL(fileName, ASSET_DIR));
        assetCache.set(fileName, asset);
      }
      res.setHeader("Content-Type", "application/octet-stream");
      return res.send(asset);
    } catch (err) {
      // A missing asset is a genuine 404; permission/I/O errors mean it should exist and storage
      // is unhealthy — surface those as 502, don't hide them behind a cacheable 404.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return res.sendStatus(404);
      }
      console.error("maintenanceUf2/asset", err);
      return res.sendStatus(502);
    }
  });
};
