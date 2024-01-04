import { App } from "@tinyhttp/app";
import { cors } from "@tinyhttp/cors";
import { config } from "@tinyhttp/dotenv";
import { logger } from "@tinyhttp/logger";

import { FirmwareRoutes } from "./routes/firmware.js";
import { resourceRoutes } from "./routes/resource.js";
import { UpdaterRoutes } from "./routes/updater.js";

export const app = new App();
config();
app
	.use(logger())
	.use(
		cors({
			origin: ["https://meshtastic.org", "https://flash.meshtastic.org", "https://flasher.meshtastic.org"],
		}),
	)
	.get("/", (_, res) => {
		res.sendStatus(200);
	})
	.get("/mirror/webui", async (_, res) => {
		await fetch(
			"https://github.com/meshtastic/meshtastic-web/releases/download/latest/build.tar",
		).then((data) => {
			res.setHeader("content-disposition", "attachment; filename=build.tar");
			res.setHeader("content-type", "application/octet-stream");
			res.send(data.body);
		});
	});

/**
 * register Routes
 */
FirmwareRoutes();
resourceRoutes();
UpdaterRoutes();

app.listen(parseInt(process.env.PORT ?? "4000"));
