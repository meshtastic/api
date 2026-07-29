import { app } from "../index.js";
import {
  type EventFirmwareOTAContract,
  getEventFirmwareOTAContract,
  signEventFirmwareOTAContract,
} from "../lib/eventFirmwareOTA.js";

export const EventFirmwareOTARoutes = () =>
  app.get("resource/eventFirmware/:edition/ota", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    let contract: EventFirmwareOTAContract | null;
    try {
      contract = getEventFirmwareOTAContract(req.params.edition ?? "");
    } catch (error) {
      console.error("eventFirmwareOTA data", error);
      return res.sendStatus(502);
    }
    if (!contract) return res.sendStatus(404);

    const keyId = process.env.EVENT_FIRMWARE_SIGNING_KEY_ID;
    const privateKey = process.env.EVENT_FIRMWARE_SIGNING_PRIVATE_KEY_PEM;
    if (!keyId || !privateKey) {
      console.error("Event firmware OTA signing key is not configured");
      return res.sendStatus(503);
    }
    try {
      return res.json(
        signEventFirmwareOTAContract(contract, keyId, privateKey),
      );
    } catch (error) {
      console.error("eventFirmwareOTA signing", error);
      return res.sendStatus(503);
    }
  });
