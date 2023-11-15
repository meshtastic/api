import { app } from "../index.js";
import { prisma } from "../utils/prisma.js";

export const showCaseRoutes = () => {
	return app
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
		});
};
