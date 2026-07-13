import type { App } from "@tinyhttp/app";
import type { AddressInfo } from "node:net";

export const withServer = async (
  app: App,
  callback: (origin: string) => Promise<void>,
): Promise<void> => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;

  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
};
