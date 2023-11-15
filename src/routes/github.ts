import { app } from "../index.js";
import {
	DeviceFirmwareResource,
	deviceOctokit,
	DeviceRequestOptions,
} from "../utils/github.js";

export const GithubRoutes = () => {
	return app.get("/github/releases", async (req, res) => {
		const releases =
			await deviceOctokit.rest.repos.listReleases(DeviceRequestOptions);

		res.send(
			releases.data.map((release) => {
				return <DeviceFirmwareResource>{
					id: release.tag_name,
					title: release.name,
					page_url: release.html_url,
					zip_url: release.assets.find((asset) =>
						asset.name.startsWith("firmware-"),
					)?.browser_download_url,
				};
			}),
		);
	});
};
