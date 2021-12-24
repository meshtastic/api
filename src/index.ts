import { App } from '@tinyhttp/app';
import { cors } from '@tinyhttp/cors';
import { logger } from '@tinyhttp/logger';

import { prisma } from './utils/prisma';

const app = new App();

app
  .use(logger())
  .use(
    cors({
      origin: "https://meshtastic.org",
    })
  )
  .get("/", (_, res) => {
    res.status(200);
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
  .listen(parseInt(process.env.PORT ?? "4000"));
