import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';

const DEVICE_OWNER = 'meshtastic';
const DEVICE_REPO = 'Meshtastic-Device';

export const deviceOctokit = new Octokit({
  userAgent: 'meshtastic-api v1',
  // TODO: App auth
  // authStrategy: createAppAuth,
  // auth: {
  //   appId: 1,
  //   privateKey: "-----BEGIN PRIVATE KEY-----\n...",
  //   clientId: "1234567890abcdef1234",
  //   clientSecret: "1234567890abcdef1234567890abcdef12345678",
  // },
});

export interface DeviceFirmwareResource {
  id: string,
  title: string,
  page_url: string | undefined,
  zip_url: string | undefined
};

export const DeviceRequestOptions = {
  owner: DEVICE_OWNER,
  repo: DEVICE_REPO
}; 

export const FirmwareLinkRegex = /\(([^)]+)\)/;
