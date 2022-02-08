import { got } from 'got';

import { App } from '@tinyhttp/app';
import { cors } from '@tinyhttp/cors';
import { logger } from '@tinyhttp/logger';

import { prisma } from './utils/prisma';

import { deviceOctokit, DeviceRequestOptions, DeviceFirmwareResource, FirmwareLinkRegex } from './github';

const app = new App();

app
  .use(logger())
  .use(
    cors({
      origin: "https://meshtastic.org",
    })
  )
  .get("/", (_, res) => {
    res.sendStatus(200);
  })
  .get("/mirror/webui", async (_, res) => {
    await got
      .get(
        "https://github.com/meshtastic/meshtastic-web/releases/download/latest/build.tar"
      )
      .then((data) => {
        res.setHeader("content-disposition", "attachment; filename=build.tar");
        res.setHeader("content-type", "application/octet-stream");
        res.send(data.rawBody);
      });
  })
  .get("/showcase", async (_, res) => {
    const showcases = await prisma.showcase.findMany({
      include: {
        tags: true,
        nodes: true,
      },
    });
    res.json(showcases ?? []);
  })
  .get("/showcase/tags/", async (_, res) => {
    const tags = await prisma.showcaseTag.findMany();

    res.json(tags ?? []);
  })
  .get("/showcase/:id/", async (req, res) => {
    const showcase = await prisma.showcase.findUnique({
      where: {
        id: req.params.id,
      },
      include: {
        materials: {
          include: {
            family: true,
          },
        },
        author: true,
        nodes: true,
        tags: true,
      },
    });

    if (!showcase) {
      res.status(404);
    }
    res.json(showcase);
  })
  .get("/device/firmware/release", async (req, res) => {
    const releases = await deviceOctokit.rest.repos
      .listReleases(DeviceRequestOptions)
      
    res.send(releases.data
      .map(release => {
        return <DeviceFirmwareResource> {
          id: release.tag_name,
          title: release.name,
          page_url: release.html_url,
          zip_url: release.assets
            .find(asset => asset.name.startsWith('firmware-'))?.browser_download_url
        }; 
      })
    );
  })
  .get("/device/firmware/pull-request", async (req, res) => {
    const prs = await deviceOctokit.rest.pulls.list(DeviceRequestOptions);

    const prArtifacts = await Promise.all(prs.data.map(async pr => { 
      let zip_url: string | undefined;
      const comments = await deviceOctokit.request(pr.comments_url);
      const artifactComments = comments.data
        .filter((comment: { user: { login: string } }) => comment.user.login == 'github-actions[bot]');

      if (artifactComments.length > 0) {
        const matches = FirmwareLinkRegex.exec(artifactComments[0].body);
        if (matches && matches.length > 0) {
          zip_url = matches[1];
        }
      }
      
      return <DeviceFirmwareResource> {
        id: pr.number.toString(),
        title: pr.title,
        page_url: pr.html_url,
        zip_url: zip_url
      };
    }));
      
    res.send(prArtifacts.filter(pr => pr.zip_url));
  })
  .listen(parseInt(process.env.PORT ?? "4000"));
