import type { ServiceImpl } from "@connectrpc/connect";
import {} from "@buf/meshtastic_api.bufbuild_es/protobufs/gateway/v1/gateway_pb.js";
import { GatewayStreamResponse } from "@buf/meshtastic_api.bufbuild_es/protobufs/gateway/v1/gateway_service_pb.js";
import type { GatewayService } from "@buf/meshtastic_api.connectrpc_es/protobufs/gateway/v1/gateway_service_connect.js";
import { prisma } from "../lib/index.js";
import { Timestamp } from "@bufbuild/protobuf";

export class Gateway implements ServiceImpl<typeof GatewayService> {
  public async *gatewayStream(): AsyncGenerator<GatewayStreamResponse> {
    const gateways = await prisma.gateway.findMany({
      include: {
        channels: true,
      },
      where: {
        latitude: {
          not: {
            equals: null,
          },
        },
      },
    });

    for (const gateway of gateways) {
      console.log("sending gateway", gateway.id);
      //delay for 1 second
      await new Promise((resolve) => setTimeout(resolve, 1000));
      yield new GatewayStreamResponse({
        gateway: {
          id: gateway.id,
          latitude: gateway.latitude ?? undefined,
          longitude: gateway.longitude ?? undefined,
          createdAt: Timestamp.fromDate(gateway.createdAt),
          updatedAt: Timestamp.fromDate(gateway.updatedAt),
          channels: gateway.channels.map((channel) => {
            return {
              id: channel.id,
              name: channel.name,
              encrypted: channel.encrypted,
              messagesCount: channel.messages,
              createdAt: Timestamp.fromDate(channel.createdAt),
              updatedAt: Timestamp.fromDate(channel.updatedAt),
            };
          }),
        },
      });
    }

    // while (true) {
    //   yield* yieldFromEvent(this.events.gateway, (data) => {
    //     return new GatewayStreamResponse({
    //       gateway: data,
    //     });
    //   });
    // }
  }
}
