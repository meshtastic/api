import { app } from "../index.js";
import { getDeviceLinks } from "../lib/deviceLinks.js";

export const DeviceLinksRoutes = () =>
  app.get("resource/deviceLinks", (_req, res) => {
    try {
      res.json(getDeviceLinks());
    } catch (err) {
      console.error("deviceLinks", err);
      res.sendStatus(502);
    }
  });
