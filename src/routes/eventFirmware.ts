import { app } from "../index.js";
import { getEventFirmware } from "../lib/eventFirmware.js";

export const EventFirmwareRoutes = () =>
  app.get("resource/eventFirmware", (_req, res) => {
    try {
      res.json(getEventFirmware());
    } catch (err) {
      console.error("eventFirmware", err);
      res.sendStatus(502);
    }
  });
