import { app } from "../index.js";
import { Hardware } from "../lib/index.js";

export const ResourceRoutes = () => {
  return app.get("resource/deviceHardware", (_, res) => {
    res.json(Hardware.deviceHardwareList);
  });
};
