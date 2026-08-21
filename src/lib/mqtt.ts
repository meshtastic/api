import { Protobuf } from "@meshtastic/js";
import MQTT from "mqtt";
import { prisma, redis } from "./index.js";

// The client is built inside RegisterMqttClient rather than at module scope, and every failure it
// can raise is handled here. Both of those matter: index.ts reaches this module through the lib
// barrel, so anything that throws during import -- or any unhandled "error" event on the client --
// ends the process before app.listen() is reached. That is the fourth way this service had to fail
// to boot, alongside the three closed in "Take Postgres and Redis out of the boot path" and "Stop
// the gateway reads from crashing the process", and the only one those two left open.
//
// MQTT.connect with MQTT_URL unset falls back to localhost:1883; the resulting ECONNREFUSED
// arrives as an "error" event, and with no listener registered EventEmitter rethrows it and Node
// exits. Since the client is a module-scope singleton today, that is a crash loop on every boot --
// the process is up, nothing is listening, and the platform serves every route from no healthy
// upstream.
//
// Ingest has been dead since 2024-07-15 regardless: the topic parser never matched
// region-prefixed topics (#115). So an absent or unreachable broker is logged and skipped, not
// treated as a reason to hold the API down.
export const RegisterMqttClient = () => {
  const url = process.env.MQTT_URL;
  if (!url) {
    console.warn("MQTT_URL unset, starting without MQTT ingest");
    return;
  }

  try {
    const mqtt = MQTT.connect(url, {
      username: process.env.MQTT_USERNAME,
      password: process.env.MQTT_PASSWORD,
    });

    // Without this listener the first connection failure is an unhandled "error" event, and an
    // unhandled "error" event ends the process.
    mqtt.on("error", (error) => {
      console.error("MQTT client error", error);
    });

    const queue = new MqttQueue();
    // Subscribe to all topics
    mqtt.subscribe(process.env.MQTT_ROOT_TOPIC as string, (error) => {
      if (error) {
        console.error("MQTT subscribe failed", error);
      }
    });

    mqtt.on("message", (topic, payload) => {
      // Split topic into parts
      const topicParts = topic.substring(8).split("/");

      if (topicParts.length === 2) {
        // Standard channel message
        try {
          const decoded = Protobuf.Mqtt.ServiceEnvelope.fromBinary(payload);
          queue.push(decoded);
        } catch (error) {
          console.error(error, topic, payload);
        }
      } else {
        // Likely stat message
        console.log("Unknown topic", topic);
      }
    });
  } catch (error) {
    console.error("MQTT setup failed, starting without ingest", error);
  }
};

interface QueueItem {
  id: string;
  latitude?: number;
  longitude?: number;
  channels: {
    name: string;
    encrypted: boolean;
    messages: number;
  }[];
}

class MqttQueue {
  private queue: QueueItem[];
  private isWorking: boolean;
  private lastWorked: Date;

  constructor() {
    this.queue = [];
    this.isWorking = false;
    this.lastWorked = new Date();
  }

  private textDecoder = new TextDecoder();

  public push(packet: Protobuf.Mqtt.ServiceEnvelope) {
    if (packet.packet?.payloadVariant.case === "decoded") {
      const data = packet.packet?.payloadVariant.value;
      if (data.portnum === Protobuf.Portnums.PortNum.POSITION_APP) {
        const position = Protobuf.Mesh.Position.fromBinary(data.payload);
        if (position.latitudeI !== 0 && position.longitudeI !== 0) {
          this.queue.push({
            id: packet.gatewayId,
            latitude: position.latitudeI,
            longitude: position.longitudeI,
            channels: [],
          });
        }
      } else if (data.portnum === Protobuf.Portnums.PortNum.TEXT_MESSAGE_APP) {
        //cache in redis
        redis.set(
          `mqttMessage-${packet.gatewayId}-${
            packet.channelId
          }-${new Date().getTime()}`,
          JSON.stringify({
            from: packet.packet.from,
            to: packet.packet.to,
            message: this.textDecoder.decode(data.payload),
          }),
          {
            EX: 60 * 60 * 12, // 12 hours
          },
        );
      } else {
        //update counter
      }
    }

    // Push to queue, batch updates
    const gatewayExists = this.queue.find(
      (item: QueueItem) => item.id === packet.gatewayId,
    );

    if (gatewayExists) {
      const channelExists = gatewayExists.channels.find(
        (channel) => channel.name === packet.channelId,
      );

      if (channelExists) {
        channelExists.messages += 1;
      } else {
        gatewayExists.channels.push({
          name: packet.channelId,
          encrypted: packet.packet?.payloadVariant.case === "encrypted",
          messages: 1,
        });
      }
    } else {
      this.queue.push({
        id: packet.gatewayId,
        channels: [
          {
            name: packet.channelId,
            encrypted: packet.packet?.payloadVariant.case === "encrypted",
            messages: 1,
          },
        ],
      });
    }

    // Check if we should process (every 10 seconds)
    if (!this.isWorking && this.lastWorked.getTime() + 10000 < Date.now()) {
      this.process();
    }
  }

  public async process() {
    this.isWorking = true;
    this.lastWorked = new Date(Date.now());
    //iterate over current queue size, shift off items and process

    const toProcess = this.queue.splice(0, Math.min(this.queue.length, 10));

    for (const gateway of toProcess) {
      for (const channel of gateway.channels) {
        console.log(
          "Queue:",
          this.queue.length,
          "Processing",
          gateway.id,
          channel.name,
        );

        await prisma.channel.upsert({
          create: {
            name: channel.name,
            encrypted: channel.encrypted,
            messages: channel.messages,
            gateway: {
              connectOrCreate: {
                create: {
                  id: gateway.id,
                },
                where: {
                  id: gateway.id,
                },
              },
            },
          },
          update: {
            messages: {
              increment: channel.messages,
            },
          },
          where: {
            channelIdentifier: {
              gatewayId: gateway.id,
              name: channel.name,
            },
          },
        });
      }

      // Update gateway position
      if (gateway.latitude && gateway.longitude) {
        await prisma.gateway.update({
          where: {
            id: gateway.id,
          },
          data: {
            latitude: gateway.latitude,
            longitude: gateway.longitude,
          },
        });
      }
    }
    this.isWorking = false;
  }
}
