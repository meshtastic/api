import { redis } from "./redis.js";

export const firmwareCache: Promise<Buffer> = async (
	version: number,
	hardware: string,
) => {
	const releaseCache = await redis.get(`firmware-${version}-${hardware}`);

	if (releaseCache) {
		//base64 decode firmware binary
		return Buffer.from(releaseCache, "binary");
	} else {
		//Fetch firmawre binary from zip
	}
};
