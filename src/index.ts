import { App } from "@tinyhttp/app";
import { cors } from "@tinyhttp/cors";
import { config } from "@tinyhttp/dotenv";
import { logger } from "@tinyhttp/logger";

import {
  FirmwareRoutes,
  GithubRoutes,
  ResourceRoutes,
  UpdaterRoutes,
} from "./routes/index.js";

export const app = new App();
config();
app
  .use(logger())
  .use(
    cors({
      origin: [
        "https://meshtastic.org",
        "https://flash.meshtastic.org",
        "https://flasher.meshtastic.org",
      ],
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
GithubRoutes();
ResourceRoutes();
UpdaterRoutes();

app.listen(Number.parseInt(process.env.PORT ?? "4000"));
