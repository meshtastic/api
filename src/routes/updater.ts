import got from 'got';
import { app } from '../index.js';
import { deviceOctokit } from '../utils/github.js';

export enum SupportedApps {
  MeshtasticDesktopFlasher = "meshtastic-desktop-flasher",
}

export const UpdaterRoutes = () => {
  return app
    .get("/updater", (_req, res) => {
      res.status(200).send("OK");
    })
    .get("/updater/:app/:target/:arch/:currentVersion", async (req, res) => {
      const { app, target, arch, currentVersion } = req.params as {
        app: SupportedApps | string;
        target: string;
        arch: string;
        currentVersion: string;
      };

      let gistId: string | null = null;

      switch (app) {
        case SupportedApps.MeshtasticDesktopFlasher:
          gistId = "4bdf1a679f070e74da61c64132aa431d";
          break;
        default:
          return res.status(404).send("Requested application not found");
      }

      if (!gistId) {
        return res.status(500).send("Error finding requested application");
      }

      const gistResponse = await deviceOctokit.rest.gists.get({
        gist_id: "",
      });
      const manifestsFile = gistResponse.data.files?.["manifests.json"];

      if (!manifestsFile) {
        return res
          .status(500)
          .send("Error finding manifest file, please contact a developer.");
      }

      const { raw_url: rawUrl } = manifestsFile;

      if (!rawUrl) {
        return res
          .status(500)
          .send("Error finding manifest URL, please contact a developer.");
      }

      const gistContent = await got.get(rawUrl);
      const parsedGistContent = JSON.parse(gistContent.body) as object[];
      const mostRecentManifest = parsedGistContent[0];

      if (!mostRecentManifest) {
        return res
          .status(500)
          .send(
            "Error finding most recent manifest, please contact a developer."
          );
      }

      return res.status(200).send(mostRecentManifest);
    });
};
