# Rollback

Read this **before** the flip, not during one. Rehearse the clicks.

## Preconditions -- READ FIRST, this is not yet true

> **`api.meshtastic.org` is currently a DNS-only (grey-cloud) CNAME straight to Railway.**
>
> Everything below describes the system *after* the flip, and the flip itself cannot happen until
> that record is set to **Proxied (orange)** in Cloudflare. A Worker Route only sees traffic that
> reaches Cloudflare's edge; against a grey-cloud record, uncommenting the route in
> `wrangler.jsonc` and deploying is a **silent no-op** -- no error, no traffic moved.
> `tools/setup-cloudflare.sh` states the requirement: "It must be PROXIED (orange) or the route
> never sees traffic."
>
> Verified 2026-09-08, four independent ways:
>
> ```
> dig +noall +answer @gene.ns.cloudflare.com api.meshtastic.org
>   api.meshtastic.org. 60 IN CNAME api-production-871d.up.railway.app.
>   api-production-871d.up.railway.app. 60 IN A 69.46.46.101      # Railway's IP, not CF anycast
> curl -sI https://api.meshtastic.org/ | grep cf-ray              # (nothing)
> curl -s -o /dev/null -w '%{http_code}' https://api.meshtastic.org/cdn-cgi/trace   # 404
> openssl s_client -connect api.meshtastic.org:443 ... -issuer    # Let's Encrypt (Railway's), not
>                                                                 # Google Trust Services (CF's)
> ```
>
> For contrast, `apiv2.meshtastic.org` answers on 104.21.46.221 / 172.67.142.226, sends a `cf-ray`,
> serves `/cdn-cgi/trace`, and presents a Google Trust Services cert.

### Order of operations for the flip

1. **Set the record to Proxied** in Cloudflare, and confirm SSL/TLS mode is **Full** for this
   hostname before doing so -- proxying moves TLS termination to Cloudflare, and a Flexible or
   Full (strict) mismatch against Railway's origin cert breaks every request. With SSL correct
   this step is transparent: traffic flows eyeball -> Cloudflare -> Railway, still Railway-served.
   Verify with `curl -sI https://api.meshtastic.org/ | grep -i 'cf-ray\|server'` -- expect a
   `cf-ray` AND `server: railway-hikari`. This step is independently reversible (toggle back to
   grey; the record carries a 60s TTL).
2. **Only then** uncomment the `routes` block under `env.production` in `wrangler.jsonc` and run
   the Deploy workflow with `environment: production`. That is the actual cutover.
3. Verify `server: cloudflare` on `api.meshtastic.org`, then soak before touching Railway.

Doing 2 before 1 is harmless but accomplishes nothing. Doing 1 alone is a safe, reversible
half-step that proves the SSL path before any traffic changes hands.

## The one-line summary (post-flip)

Once the record is proxied, `api.meshtastic.org` is served by a Cloudflare **Worker Route**, not a
Custom Domain, and the DNS record still points at Railway underneath. Removing the route hands
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

Reverts to the previous Worker version. **Check there is one first:** every Deploy run before
2026-09-08 was `--env staging`, so the production Worker script did not exist at all. It has since
been deployed once (run 34267700592, sha 87c7325, no route attached), which means the script now
exists but has a single version -- `rollback` needs a *previous* one, so it only becomes a real
option after the flip deploy makes a second. Until then the route deletion above is the rollback. Because the five consumer-facing JSON documents are
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
