import { readFileSync } from "node:fs";
import { app } from "../index.js";

// Hamvention is the only event edition with bundled art today (the others' iconUrl is null).
// Served under resource/ alongside the metadata, mirroring how data/ files map to resource/* routes.
// ponytail: one fixed route for the one icon we host; generalize to a :slug param when more editions ship art.
const ICON_PATH = new URL(
  "../../static/eventFirmware/hamvention.png",
  import.meta.url,
);

let icon: Buffer | null = null;

export const EventFirmwareIconRoutes = () =>
  app.get("resource/eventFirmware/hamvention.png", (_req, res) => {
    try {
      if (!icon) icon = readFileSync(ICON_PATH);
      res.setHeader("Content-Type", "image/png");
      res.send(icon);
    } catch (err) {
      console.error("eventFirmwareIcon", err);
      res.sendStatus(404);
    }
  });
