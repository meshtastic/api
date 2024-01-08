import { app } from "../index.js";

export type SupportedApps = "meshtastic-desktop-flasher";

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
      const gistContent = await fetch(
        "https://gist.githubusercontent.com/ajmcquilkin/4bdf1a679f070e74da61c64132aa431d/raw/manifests.json",
      );
      const parsedGistContent = (await gistContent.json()) as object[];
      const mostRecentManifest = parsedGistContent[0];

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
