# Rollback

Read this before you need it, not during an incident. Rehearse the clicks.

## Current state -- the flip is DONE (2026-09-08)

> `api.meshtastic.org` is **proxied** and served by the **`meshtastic-api`** Worker.
>
> ```
> dig +short api.meshtastic.org        -> 104.21.46.221, 172.67.142.226   (CF anycast A, no CNAME)
> curl -sI https://api.meshtastic.org/ -> server: cloudflare, cf-ray: ...
> TLS issuer                           -> Google Trust Services (Cloudflare)
> ```
>
> A proxied record answers with Cloudflare anycast **A records**; a grey-cloud one answers with the
> origin **CNAME**. That difference is the fastest way to tell which state you are in.
>
> Verified at cutover: `parity.mjs --self-check` 12/12 against production, and 39/40 on the full
> diff against Railway. The single FAIL is a harness artifact -- the old server derives `iconUrl`
> from the request Host, so the railway.app baseline emits railway.app URLs; the payload is
> byte-identical.

**Railway is still running and still the rollback target.** Nothing about it changed; the DNS
record underneath still points at it, which is what makes route deletion an instant rollback.

### One thing to know before you roll back

The production route was added **in the dashboard**, not via `wrangler.jsonc` -- the `routes` block
under `env.production` there is still commented out. Two consequences:

- A `wrangler deploy --env production` does **not** re-create the route, so the "disable the Deploy
  workflow first" step below is belt-and-braces rather than load-bearing. It is still the right
  habit, and it becomes load-bearing the moment that block is uncommented.
- Production routing currently lives only as dashboard state and is not described by the repo.
  Uncommenting the block to make config match reality is worth doing deliberately, not by accident.

## The one-line summary

`api.meshtastic.org` is served by a Cloudflare **Worker Route**, not a Custom Domain, and the DNS
record still points at Railway underneath. Removing the route hands
traffic straight back to Railway with no DNS change and no TTL to wait out.

## If the Worker is serving something wrong

**Order matters. Do step 1 first.**

1. **Disable the `Deploy` workflow.** Actions → Deploy → `⋯` → Disable workflow.

   The route is declared in `wrangler.jsonc`. If any `deploy.yml` run fires while you are
   mid-incident — a scheduled sync calls it — it will silently re-create the route you just
   deleted and re-break production.

2. **Delete the Worker Route.** Cloudflare dashboard → Workers & Pages → `meshtastic-api` →
   Settings → Domains & Routes → remove `api.meshtastic.org/*`.

Traffic now flows through the Cloudflare proxy to Railway, as it did before the flip. Sub-minute,
no DNS propagation, and it needs no Railway access.

Verify:

```bash
curl -sI https://api.meshtastic.org/resource/deviceHardware | grep -iE 'server|cf-ray'
```

`server: railway-hikari` means you are back on Railway.

## If only the Worker *code* is wrong (route is fine)

```bash
wrangler rollback --env production
```

Reverts to the previous Worker version. This is available now: every Deploy run before 2026-09-08
was `--env staging` so the production script did not exist, but `meshtastic-api` has since been
deployed more than once and therefore has a version to fall back to. Route deletion above remains
the faster and broader rollback -- it does not depend on the Worker being healthy at all. Because the five consumer-facing JSON documents are
compiled **into the bundle**, this reverts data and routing together, atomically — there is no
window where a new Worker reads an old object.

## If a bad payload reached R2

R2 is not versioned, so there is no `git revert` for an object. Two paths:

- The bundled documents (`deviceHardware`, `deviceLinks`, `eventFirmware`, `bootloaderOtaQuirks`,
  `maintenanceUf2`) are in the Worker — use `wrangler rollback` above.
- The R2-held objects (`github/*`, binaries, favicon) are all built from files in git. Re-publish
  a known-good commit:

  Actions → Deploy → Run workflow → `ref: <known-good-sha>`, `environment: production`.

## What NOT to do

- **Do not touch Railway.** It is the rollback target for the whole cutover window and requires no
  action, ever. Nobody on this project has access to it anyway. While the record is grey-cloud,
  Railway is not merely the rollback target -- it *is* production, and deleting the service takes
  the API offline immediately.
- **Do not delete the `api.meshtastic.org` DNS record.** It is what the rollback falls back to.
  Only repoint it to an `AAAA 100::` placeholder once you are confident, and understand that doing
  so makes `wrangler rollback` the only remaining rollback.
- **Do not grey-cloud the record to "bypass Cloudflare".** The Configuration Rule that sets SSL
  mode to Full is scoped to this hostname; going grey while the Worker route exists just makes the
  failure harder to reason about. Delete the route instead.

## Health checks

```bash
# contract self-check (canonical JSON, 304s, Range ignored, CORS both branches)
node tools/parity.mjs --self-check --base https://api.meshtastic.org

# full diff against Railway's own hostname, which keeps working because Railway was never touched
node tools/parity.mjs \
  --baseline https://api-production-871d.up.railway.app \
  --candidate https://api.meshtastic.org --routes all
```
