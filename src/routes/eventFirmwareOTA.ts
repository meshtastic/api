import { app } from "../index.js";
import {
  getEventFirmwareOTAContract,
  signEventFirmwareOTAContract,
} from "../lib/eventFirmwareOTA.js";

export const EventFirmwareOTARoutes = () =>
  app.get("resource/eventFirmware/:edition/ota", (req, res) => {
    const contract = getEventFirmwareOTAContract(req.params.edition ?? "");
    if (!contract) return res.sendStatus(404);

    const keyId = process.env.EVENT_FIRMWARE_SIGNING_KEY_ID;
    const privateKey = process.env.EVENT_FIRMWARE_SIGNING_PRIVATE_KEY_PEM;
    if (!keyId || !privateKey) {
      console.error("Event firmware OTA signing key is not configured");
      return res.sendStatus(503);
    }

    try {
      res.setHeader("Cache-Control", "no-store");
      return res.json(
        signEventFirmwareOTAContract(contract, keyId, privateKey),
      );
    } catch (error) {
      console.error("eventFirmwareOTA", error);
      return res.sendStatus(502);
    }
  });
