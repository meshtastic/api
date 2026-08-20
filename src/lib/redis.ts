import { createClient } from "redis";

// Redis is a cache for the firmware routes and nothing else, so it must never
// gate the server. This module used to end in a top-level `await
// redis.connect()`. Top-level await blocks evaluation of every module that
// imports it -- including index.ts, which reaches `app.listen` only after its
// import graph resolves -- so an unreachable Redis meant the process came up,
// stayed alive, and never bound the port. Every route went dark, cached or not,
// and the platform served 502 for all of them.
export const redis = createClient({
  url: process.env.REDIS_URL,
  socket: {
    // Keep retrying instead of giving up: a Redis that comes back later should
    // reconnect on its own rather than needing a deploy. Capped so the interval
    // does not grow without bound.
    reconnectStrategy: (retries) => Math.min(retries * 200, 5_000),
  },
});

redis.on("error", (err) => console.error("Redis Client Error", err));

// Connect in the background. The rejection is swallowed deliberately -- an
// unhandled one here would terminate the process, which is the outage this
// module is meant to prevent.
void redis.connect().catch((err) => {
  console.error("Redis initial connect failed, continuing without cache", err);
});

/**
 * Cache read that degrades to a miss when Redis is unavailable, so a cache
 * outage costs a GitHub round trip rather than the request.
 */
export const cacheGet = async (key: string): Promise<string | null> => {
  if (!redis.isReady) {
    return null;
  }

  try {
    return await redis.get(key);
  } catch (err) {
    console.error("Redis read failed", key, err);
    return null;
  }
};

/**
 * Fire-and-forget cache write. Never rejects: these calls are not awaited at
 * the call sites, and an unhandled rejection from one would take the process
 * down.
 */
export const cacheSet = (
  key: string,
  value: string,
  ttlSeconds: number,
): void => {
  if (!redis.isReady) {
    return;
  }

  void redis.set(key, value, { EX: ttlSeconds }).catch((err) => {
    console.error("Redis write failed", key, err);
  });
};
