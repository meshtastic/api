import { app } from "../index.js";

export type SupportedApps = "meshtastic-desktop-flasher";

// A production endpoint should not depend on one contributor's personal gist.
// The gist remains the default so existing clients keep working, but the source
// is overridable via UPDATER_MANIFEST_URL and should be pointed at infrastructure
// the project controls.
const DEFAULT_MANIFEST_URL =
  "https://gist.githubusercontent.com/ajmcquilkin/4bdf1a679f070e74da61c64132aa431d/raw/manifests.json";

const manifestUrl = process.env.UPDATER_MANIFEST_URL || DEFAULT_MANIFEST_URL;

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
        const manifestResponse = await fetch(manifestUrl);

        if (!manifestResponse.ok) {
          console.error(
            "[updater] manifest fetch returned",
            manifestResponse.status,
            manifestUrl,
          );
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
        ? (parsedManifests[0] as object | undefined)
        : undefined;

      if (!mostRecentManifest) {
        return res
          .status(500)
          .send(
            "Error finding most recent manifest, please contact a developer.",
          );
      }

      return res.status(200).send(mostRecentManifest);
    });
};
