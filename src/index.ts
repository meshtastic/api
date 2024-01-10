import { App } from "@tinyhttp/app";
import { cors } from "@tinyhttp/cors";
import { config } from "@tinyhttp/dotenv";
import { logger } from "@tinyhttp/logger";
import { favicon } from "@tinyhttp/favicon";

import {
  FirmwareRoutes,
  GithubRoutes,
  ResourceRoutes,
  UpdaterRoutes,
  MqttRoutes,
} from "./routes/index.js";
import { RegisterMqttClient } from "./lib/index.js";
import { expressConnectMiddleware } from "@connectrpc/connect-express";
import { GatewayService } from "@buf/meshtastic_api.connectrpc_es/protobufs/gateway/v1/gateway_service_connect.js";
import { Gateway } from "./services/index.js";

export const app = new App();
config();
RegisterMqttClient();
app
  .use(logger())
  .use(favicon("static/favicon.ico"))
  .use(
    cors({
      credentials: true,
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-Custom-Header",
        "Connect-Protocol-Version",
      ],
      origin(req) {
        // allow requests with no origin
        if (!req.headers.origin) {
          return "";
        }

        const whitelist = [
          "http://localhost:3000",
          "https://meshtastic.org",
          "https://flash.meshtastic.org",
          "https://flasher.meshtastic.org",
        ];

        // return origin if it is in the whitelist
        if (whitelist.indexOf(req.headers.origin) !== -1) {
          return req.headers.origin;
        }
        throw new Error("Origin not allowed by CORS");
      },
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
  })
  .use(async (req, res, next) => {
    return expressConnectMiddleware({
      routes: (router) => {
        router.service(GatewayService, new Gateway());
      },
      connect: true,
      // @ts-ignore
    })(req, res, next);
  });

/**
 * register Routes
 */
FirmwareRoutes();
GithubRoutes();
ResourceRoutes();
UpdaterRoutes();
MqttRoutes();

app.listen(Number.parseInt(process.env.PORT ?? "4000"));
