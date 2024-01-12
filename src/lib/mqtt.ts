import MQTT from "mqtt";
import { Protobuf } from "@meshtastic/js";
import { prisma } from "./index.js";

const mqtt = MQTT.connect(process.env.MQTT_URL as string, {
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
});

export const RegisterMqttClient = () => {
  const queue = new MqttQueue();
  // Subscribe to all topics
  mqtt.subscribe(process.env.MQTT_ROOT_TOPIC as string);

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
