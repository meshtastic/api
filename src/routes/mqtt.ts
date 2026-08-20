import { app } from "../index.js";
import { prisma, redis } from "../lib/index.js";

export const MqttRoutes = () => {
  return app.get("/mqtt", async (_req, res) => {
    const mqttCache = await redis.get("mqttCache");

    if (mqttCache) {
      res.send(JSON.parse(mqttCache));
    } else {
      const data = await prisma.gateway.findMany({
        include: {
          channels: true,
        },
      });

      redis.set("mqttCache", JSON.stringify(data), {
        EX: 1,
      });
      res.send(data);
    }
  });
};
