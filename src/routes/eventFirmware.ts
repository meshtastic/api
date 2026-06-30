import type { Request } from "@tinyhttp/app";
import { app } from "../index.js";
import { getEventFirmware } from "../lib/eventFirmware.js";

// Icons hosted by this API's own icon route — the only iconUrls we re-origin.
const HOSTED_ICON_ORIGIN = "https://api.meshtastic.org";
const HOSTED_ICON_PREFIX = "/resource/eventFirmware/";

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
        let parsed: URL;
        try {
          parsed = new URL(edition.iconUrl);
        } catch {
          return edition;
        }
        // Only rewrite icons we host on this server's icon route; leave external
        // (e.g. third-party CDN) URLs untouched.
        if (
          parsed.origin !== HOSTED_ICON_ORIGIN ||
          !parsed.pathname.startsWith(HOSTED_ICON_PREFIX)
        ) {
          return edition;
        }
        return {
          ...edition,
          iconUrl: `${origin}${parsed.pathname}${parsed.search}${parsed.hash}`,
        };
      });
      res.json({ ...data, editions });
    } catch (err) {
      console.error("eventFirmware", err);
      res.sendStatus(502);
    }
  });
