import { app } from "../index.js";
import { getBootloaderOtaQuirks } from "../lib/bootloaderOtaQuirks.js";

export const BootloaderOtaQuirksRoutes = () =>
  app.get("resource/bootloaderOtaQuirks", (_req, res) => {
    try {
      res.json(getBootloaderOtaQuirks());
    } catch (err) {
      console.error("bootloaderOtaQuirks", err);
      res.sendStatus(502);
    }
  });
