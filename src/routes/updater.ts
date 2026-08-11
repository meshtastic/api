import { app } from "../index.js";

export type SupportedApps = "meshtastic-desktop-flasher";

// A production endpoint should not depend on one contributor's personal gist.
// The gist remains the default so existing clients keep working, but the source
// is overridable via UPDATER_MANIFEST_URL and should be pointed at infrastructure
// the project controls.
const DEFAULT_MANIFEST_URL =
  "https://gist.githubusercontent.com/ajmcquilkin/4bdf1a679f070e74da61c64132aa431d/raw/manifests.json";

const manifestUrl = process.env.UPDATER_MANIFEST_URL || DEFAULT_MANIFEST_URL;

// A manifest source that accepts the connection and then stalls would otherwise
// leave the updater request pending indefinitely. The abort rejects the fetch,
// which the catch below maps to 502 like any other upstream failure.
const MANIFEST_FETCH_TIMEOUT_MS = 10_000;

// The payload is whatever the manifest source chose to serve, so it is checked
// at runtime rather than asserted. `typeof null === "object"`, and arrays are
// objects too, so both are excluded explicitly.
const isManifest = (value: unknown): value is object =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const UpdaterRoutes = () => {
  return app
    .get("/updater", (_req, res) => {
      res.status(200).send("OK");
    })
    .get("/updater/:app/:target/:arch/:currentVersion", async (_, res) => {
      // let gist_id: string | null = null;

      // switch (req.params.app as SupportedApps) {
      // 	case "meshtastic-desktop-flasher":
      // 		gist_id = "4bdf1a679f070e74da61c64132aa431d";
      // 		break;
      // 	default:
      // 		return res.status(404).send("Requested application not found");
      // }

      // if (!gist_id) {
      // 	return res.status(500).send("Error finding requested application");
      // }

      // const gistResponse = await deviceOctokit.rest.gists.get({
      // 	gist_id
      // });
      // const manifestsFile = gistResponse.data.files?.["manifests.json"];

      // if (!manifestsFile) {
      // 	return res
      // 		.status(500)
      // 		.send("Error finding manifest file, please contact a developer.");
      // }

      // const { raw_url: rawUrl } = manifestsFile;

      // if (!rawUrl) {
      // 	return res
      // 		.status(500)
      // 		.send("Error finding manifest URL, please contact a developer.");
      // }

      // const gistContent = await fetch(rawUrl);
      let parsedManifests: unknown;

      try {
        const manifestResponse = await fetch(manifestUrl, {
          signal: AbortSignal.timeout(MANIFEST_FETCH_TIMEOUT_MS),
        });

        if (!manifestResponse.ok) {
          console.error(
            "[updater] manifest fetch returned",
            manifestResponse.status,
            manifestUrl,
          );
          // Release the connection: an unread body is not returned to the pool
          // until it is consumed or cancelled.
          await manifestResponse.body?.cancel().catch(() => {});
          return res
            .status(502)
            .send("Error fetching manifests, please contact a developer.");
        }

        parsedManifests = await manifestResponse.json();
      } catch (error) {
        // An unreachable or non-JSON manifest source previously threw out of the
        // handler rather than returning a response.
        console.error("[updater] manifest fetch failed", manifestUrl, error);
        return res
          .status(502)
          .send("Error fetching manifests, please contact a developer.");
      }

      const mostRecentManifest = Array.isArray(parsedManifests)
        ? parsedManifests[0]
        : undefined;

      // Non-array JSON, an empty array and a first element that is not a
      // manifest object are all the manifest source serving something this
      // endpoint cannot use, so they are reported as upstream failures rather
      // than as a fault in this service.
      if (!isManifest(mostRecentManifest)) {
        console.error(
          "[updater] manifest source returned an unusable payload",
          manifestUrl,
        );
        return res
          .status(502)
          .send(
            "Error finding most recent manifest, please contact a developer.",
          );
      }

      return res.status(200).send(mostRecentManifest);
    });
};
