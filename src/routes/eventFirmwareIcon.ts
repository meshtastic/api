import { readFileSync } from "node:fs";
import { app } from "../index.js";

// Event edition icons, served under resource/ alongside the metadata (mirroring
// how data/ files map to resource/* routes). The manifest's iconUrl points here
// per edition; only editions with bundled art resolve (hamvention.png today),
// the rest 404 until original art ships. The :slug is constrained to
// [a-z0-9-] so it can never escape the static/eventFirmware/ directory.
const ICON_DIR = new URL("../../static/eventFirmware/", import.meta.url);
const SLUG_RE = /^([a-z0-9-]+)\.png$/;

// Cache each icon buffer by slug on first request — files only change on redeploy.
const cache = new Map<string, Buffer>();

export const EventFirmwareIconRoutes = () =>
  app.get("resource/eventFirmware/:file", (req, res) => {
    const match = SLUG_RE.exec(req.params.file ?? "");
    if (!match) return res.sendStatus(404);
    const slug = match[1];

    try {
      let icon = cache.get(slug);
      if (!icon) {
        icon = readFileSync(new URL(`${slug}.png`, ICON_DIR));
        cache.set(slug, icon);
      }
      res.setHeader("Content-Type", "image/png");
      return res.send(icon);
    } catch (err) {
      // A missing icon is a genuine 404; permission/I/O errors mean the icon
      // should exist and storage is unhealthy — surface those as 502, don't
      // hide them behind a cacheable 404.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return res.sendStatus(404);
      }
      console.error("eventFirmwareIcon", err);
      return res.sendStatus(502);
    }
  });
