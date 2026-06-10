import { config } from "@tinyhttp/dotenv";
import { Octokit } from "octokit";

const DEVICE_OWNER = "meshtastic";
const DEVICE_REPO = "firmware";

config();

// Fall back to a plain token (or unauthenticated) Octokit for local
// development when the GitHub App credentials are not configured. The
// app-auth strategy is imported lazily so its JWT dependency chain is only
// loaded when it is actually used.
export const deviceOctokit = process.env.GH_APP_ID
  ? new Octokit({
      userAgent: "meshtastic-api v1",
      authStrategy: (await import("@octokit/auth-app")).createAppAuth,
      auth: {
        installationId: process.env.GH_APP_INSTALL_ID,
        appId: process.env.GH_APP_ID,
        privateKey: process.env.GH_APP_PRIVATE_KEY,
        clientId: process.env.GH_APP_CLIENT_ID,
        clientSecret: process.env.GH_APP_CLIENT_SECRET,
      },
    })
  : new Octokit({
      userAgent: "meshtastic-api v1",
      auth: process.env.GITHUB_TOKEN,
    });

export interface DeviceFirmwareResource {
  id: string;
  title: string;
  page_url?: string;
  zip_url?: string;
  release_notes?: string;
}

export const DeviceRequestOptions = {
  owner: DEVICE_OWNER,
  repo: DEVICE_REPO,
};

export const FirmwareLinkRegex = /\(([^)]+)\)/;
