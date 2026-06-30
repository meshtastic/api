import type { Request } from "@tinyhttp/app";
import { app } from "../index.js";
import { getEventFirmware } from "../lib/eventFirmware.js";

const firstHeader = (value?: string | string[]): string | undefined =>
  (Array.isArray(value) ? value[0] : value)?.split(",")[0]?.trim();

// Origin that served this request, honoring the reverse proxy in front of
// api.meshtastic.org (X-Forwarded-*), so the response self-references the
// current deployment rather than the production host baked into the data file.
const requestOrigin = (req: Request): string => {
  const proto =
    firstHeader(req.headers["x-forwarded-proto"]) ??
    ((req.socket as { encrypted?: boolean }).encrypted ? "https" : "http");
  const host = firstHeader(req.headers["x-forwarded-host"]) ?? req.headers.host;
  return `${proto}://${host}`;
};

export const EventFirmwareRoutes = () =>
  app.get("resource/eventFirmware", (req, res) => {
    try {
      const data = getEventFirmware();
      const origin = requestOrigin(req);
      // Hosted icons live on this same server; rewrite their origin to the one
      // that served the manifest so staging/local/forked deployments point at
      // their own icon route instead of api.meshtastic.org. External or null
      // iconUrls are left untouched. The cached payload is never mutated.
      const editions = data.editions.map((edition) => {
        if (!edition.iconUrl) return edition;
        try {
          return {
            ...edition,
            iconUrl: origin + new URL(edition.iconUrl).pathname,
          };
        } catch {
          return edition;
        }
      });
      res.json({ ...data, editions });
    } catch (err) {
      console.error("eventFirmware", err);
      res.sendStatus(502);
    }
  });
