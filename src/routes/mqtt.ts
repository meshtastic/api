import { app } from "../index.js";
import { cacheGet, cacheSet, prisma } from "../lib/index.js";

export const MqttRoutes = () => {
  return app.get("/mqtt", async (_req, res) => {
    const mqttCache = await cacheGet("mqttCache");

    if (mqttCache) {
      return res.send(JSON.parse(mqttCache));
    }

    // #115 shipped a migration that drops Gateway and Channel, and it may have
    // applied before the deploy that followed it failed. This handler had no
    // catch: a query against a dropped table rejects, the rejection is
    // unhandled, and the process exits -- taking every unrelated route with it.
    // The ingest has been dead since 2024-07-15, so an empty list is an honest
    // answer either way.
    let data: unknown[];
    try {
      data = await prisma.gateway.findMany({
        include: {
          channels: true,
        },
      });
    } catch (error) {
      console.error("[mqtt] gateway query failed", error);
      return res.send([]);
    }

    cacheSet("mqttCache", JSON.stringify(data), 1);
    return res.send(data);
  });
};
