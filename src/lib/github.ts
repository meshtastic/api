import { Octokit } from "octokit";

import { createAppAuth } from "@octokit/auth-app";
import { config } from "@tinyhttp/dotenv";

const DEVICE_OWNER = "meshtastic";
const DEVICE_REPO = "firmware";

config();

export const deviceOctokit = new Octokit({
  userAgent: "meshtastic-api v1",
  // TODO: App auth
  authStrategy: createAppAuth,
  auth: {
    installationId: process.env.GH_APP_INSTALL_ID,
    appId: process.env.GH_APP_ID,
    privateKey: process.env.GH_APP_PRIVATE_KEY,
    clientId: process.env.GH_APP_CLIENT_ID,
    clientSecret: process.env.GH_APP_CLIENT_SECRET,
  },
});

export interface DeviceFirmwareResource {
  id: string;
  title: string;
  page_url?: string;
  zip_url?: string;
}

export const DeviceRequestOptions = {
  owner: DEVICE_OWNER,
  repo: DEVICE_REPO,
};

export const FirmwareLinkRegex = /\(([^)]+)\)/;
