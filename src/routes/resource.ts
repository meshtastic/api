import { app } from "../index.js";
import { deviceHardwareList } from "../utils/resource.js";

export const resourceRoutes = () => {
	return app.get("resource/deviceHardware", async (_, res) => {
		res.json(deviceHardwareList);
	});
};
