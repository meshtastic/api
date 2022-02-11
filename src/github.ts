import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';

const DEVICE_OWNER = "meshtastic";
const DEVICE_REPO = "Meshtastic-Device";

export const deviceOctokit = new Octokit({
  userAgent: "meshtastic-api v1",
  // TODO: App auth
  authStrategy: createAppAuth,
  auth: {
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
