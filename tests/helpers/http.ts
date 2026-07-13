import type { AddressInfo } from "node:net";
import type { App } from "@tinyhttp/app";

export const withServer = async (
  app: App,
  callback: (origin: string) => Promise<void>,
): Promise<void> => {
  let server: ReturnType<App["listen"]> | undefined;
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve, "127.0.0.1");
  });
  if (!server) throw new Error("test server did not start");
  const startedServer = server;
  const { port } = startedServer.address() as AddressInfo;

  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      startedServer.close((error) => (error ? reject(error) : resolve())),
    );
  }
};
