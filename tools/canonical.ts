import { createHash } from "node:crypto";

/**
 * The wire format of every JSON response this API has ever served.
 *
 * tinyhttp's `res.json()` and `res.send(object)` both emit
 * `JSON.stringify(value, null, 2)` as UTF-8, with **no trailing newline**, under
 * `Content-Type: application/json` with **no charset**. That is the contract every consumer
 * has been parsing for years, and the committed `data/*.json` files are NOT it --
 * `data/eventFirmware.json` is 13,953 B on disk and 15,018 B on the wire.
 *
 * So the publisher must re-serialize, never copy. `jq .` is not a substitute either: it appends
 * a newline. Everything that produces a JSON body goes through this function.
 */
export const canonical = (value: unknown): string =>
  JSON.stringify(value, null, 2);

/**
 * Strong ETag over the exact response bytes. The old server only ever produced a *weak* ETag,
 * and only on the `res.send()` routes -- the `res.json()` ones (which include the largest and
 * most cacheable payloads) had none at all. A strong ETag is a deliberate improvement, declared
 * as an exemption in the parity harness rather than smuggled in.
 */
export const etagOf = (body: string | Uint8Array): string =>
  `"${createHash("sha256").update(body).digest("hex").slice(0, 32)}"`;

export const sha256 = (body: string | Uint8Array): string =>
  createHash("sha256").update(body).digest("hex");
