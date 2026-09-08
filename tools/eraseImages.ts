/**
 * The erase images named by data/maintenanceUf2.json, resolved from the manifest itself.
 *
 * This exists because the same list used to be written down twice -- an explicit `UF2S` array in
 * build-static.ts (what gets uploaded) and an explicit key list in validate.ts (what gets checked)
 * -- and the two silently disagreed the moment `erase.nrf52Bootloader` was added as an additive
 * sibling of `nrf52`/`rp2040`. The manifest named meshtastic_factory_erase.uf2 with its digest, no
 * upload ever emitted it, and the validator whose stated job is "a manifest naming a file we do
 * not publish is a build failure" walked straight past it, because an allowlist of keys cannot
 * fail closed against a schema designed to grow.
 *
 * Walking the tree for anything shaped like an entry means the publisher and the validator now
 * read the SAME list from the SAME place. A new erase key is picked up by both, or by neither.
 */
export interface EraseImage {
  readonly fileName: string;
  readonly sha256: string;
}

const isEntry = (n: Record<string, unknown>): boolean =>
  typeof n.fileName === "string" && typeof n.sha256 === "string";

/**
 * Depth-first over `erase`, collecting every node carrying a fileName + sha256. Sorted by
 * fileName so the emitted R2 manifest is a pure function of the tree regardless of key order.
 */
export const collectEraseImages = (erase: unknown): EraseImage[] => {
  const out: EraseImage[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    if (isEntry(rec)) {
      out.push({
        fileName: rec.fileName as string,
        sha256: rec.sha256 as string,
      });
      return;
    }
    for (const child of Object.values(rec)) walk(child);
  };
  walk(erase);
  return out.sort((a, b) => (a.fileName < b.fileName ? -1 : 1));
};
