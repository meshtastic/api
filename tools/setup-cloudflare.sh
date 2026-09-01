#!/usr/bin/env bash
#
# One-time setup for the v2 Cloudflare deployment.
#
# Automates everything that can be automated WITHOUT creating a super-credential.
#
# Secrets are read from gitignored files and piped straight to their destination. They are never
# prompted for and never rendered to a terminal: `read -rs` is NOT reliably invisible, because
# under bracketed paste many terminals echo pasted text before the read consumes it.
#
#   ./tools/setup-cloudflare.sh check      # show what is and is not configured
#   ./tools/setup-cloudflare.sh bucket     # wrangler OAuth -> create the R2 bucket
#   ./tools/setup-cloudflare.sh dns        # create the apiv2 DNS record
#   ./tools/setup-cloudflare.sh dns-debug  # what the API holds vs what DNS answers
#   ./tools/setup-cloudflare.sh dns-probe  # write+query+delete a TXT record to isolate a fault
#   ./tools/setup-cloudflare.sh secrets    # store the tokens as GitHub Actions secrets
#
# Tokens are read from gitignored files, never from a prompt -- see load_token below.
#
# Why the two Cloudflare API tokens are NOT minted here: `POST /user/tokens` requires a calling
# token carrying `API Tokens Write`, and that bootstrap credential can mint any token in the
# account -- strictly more dangerous than the two narrowly-scoped tokens it would produce. It
# would also have to be created in the dashboard anyway ("Before you can use the API, you need to
# generate an initial token via the Cloudflare dashboard"). Five minutes of clicking beats
# creating, storing, and then having to remember to revoke an account-wide super-credential.
set -euo pipefail

REPO=meshtastic/api
BUCKET=meshtastic-api-v1
ZONE=meshtastic.org
HOST=apiv2.meshtastic.org

die() { echo "error: $*" >&2; exit 1; }

TOKEN_FILE=".cf-token"

# Reads the Cloudflare API token from a gitignored file rather than prompting for it.
#
# The earlier version prompted with `read -rs`. That is NOT reliably invisible: under bracketed
# paste, many terminals echo pasted text before the read consumes it, so a token can land in
# scrollback anyway -- which is exactly what happened. A file keeps the value off the terminal
# entirely, out of shell history, and easy to delete when you are done.
#
#   printf '%s' 'YOUR_TOKEN' > .cf-token && chmod 600 .cf-token
#
# .cf-token is gitignored. Delete it when you are finished: rm -P .cf-token
load_token() {
  if [ -n "${CF_DNS_TOKEN:-}" ]; then return 0; fi
  if [ ! -f "$TOKEN_FILE" ]; then
    cat >&2 <<EOF
error: no token available.

  Write it to ${TOKEN_FILE} (gitignored, never echoed):

    printf '%s' 'YOUR_CLOUDFLARE_TOKEN' > ${TOKEN_FILE} && chmod 600 ${TOKEN_FILE}

  Then re-run. Delete it afterwards with: rm -P ${TOKEN_FILE}
EOF
    exit 1
  fi
  # Strip a trailing newline; a token pasted via an editor usually has one, and it silently
  # produces a 400 that looks like a permissions problem.
  CF_DNS_TOKEN=$(tr -d '\r\n' < "$TOKEN_FILE")
  [ -n "$CF_DNS_TOKEN" ] || die "${TOKEN_FILE} is empty"
}


need() { command -v "$1" >/dev/null 2>&1 || die "$1 is not installed"; }

cmd_bucket() {
  need npx
  echo "==> Checking wrangler auth"
  if ! npx wrangler whoami >/dev/null 2>&1 || npx wrangler whoami 2>&1 | grep -q "not authenticated"; then
    echo "    Not authenticated. Opening the browser for OAuth..."
    echo "    (This grants wrangler workers/R2 access. It canNOT create DNS records or API tokens"
    echo "     -- neither scope exists -- which is why those are separate steps below.)"
    npx wrangler login
  fi
  npx wrangler whoami 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -iE "account name|account id" || true

  echo "==> Creating R2 bucket ${BUCKET} (private; no public access, no custom domain)"
  if npx wrangler r2 bucket list 2>/dev/null | grep -q "\b${BUCKET}\b"; then
    echo "    already exists"
  else
    npx wrangler r2 bucket create "$BUCKET"
  fi
  echo
  echo "    Do NOT attach a custom domain or enable public access to this bucket. It is read"
  echo "    only through the Worker's DATA binding; making it public would reintroduce a bucket"
  echo "    CORS policy and a Cache Rule -- dashboard state that a git revert cannot undo."
}

cmd_dns() {
  need curl; need jq
  # A DNS:Edit + Zone:Read token. Far narrower than the API-Tokens-Write bootstrap that minting
  # tokens would need, and it can be deleted immediately after this step.
  load_token

  local api=https://api.cloudflare.com/client/v4
  echo "==> Looking up zone ${ZONE}"
  local zones
  zones=$(curl -fsS "${api}/zones?name=${ZONE}" -H "Authorization: Bearer ${CF_DNS_TOKEN}")
  local count
  count=$(printf '%s' "$zones" | jq -r '.result | length')
  [ "$count" != "0" ] || die "no zone named ${ZONE} visible to this token (lacks Zone:Read, or wrong account)"

  printf '%s' "$zones" | jq -r '.result[] | "    candidate: id=\(.id) status=\(.status) account=\(.account.name) ns=\(.name_servers // [] | join(","))"'

  # A domain can exist as more than one zone object -- a live one plus a pending/moved duplicate in
  # another account. Creating a record in the wrong one succeeds, returns 200, and then never
  # resolves, which is a genuinely confusing failure. Pick the zone whose ASSIGNED NAMESERVERS
  # match what the internet is actually being told to use.
  local live_ns
  live_ns=$(dig +short NS "${ZONE}" | sed 's/\.$//' | sort | head -1)
  [ -n "$live_ns" ] || die "could not read the live NS for ${ZONE}"
  echo "    live nameserver in public DNS: ${live_ns}"

  local zone_id
  zone_id=$(printf '%s' "$zones" | jq -r --arg ns "$live_ns" \
    '.result[] | select((.name_servers // []) | map(ascii_downcase) | index($ns)) | .id' | head -1)

  if [ -z "$zone_id" ]; then
    echo
    echo "    None of the zones this token can see is the one serving ${ZONE}:" >&2
    echo "    its live nameservers (${live_ns}...) do not match any candidate above." >&2
    echo >&2
    echo "    That means this token belongs to a different Cloudflare account than the one" >&2
    echo "    hosting ${ZONE}. It matters beyond DNS: Worker routes and R2 custom domains for" >&2
    echo "    this zone can only be created from the account that owns it, so the whole" >&2
    echo "    deployment has to happen in that account." >&2
    die "wrong Cloudflare account for ${ZONE}"
  fi

  local status
  status=$(printf '%s' "$zones" | jq -r --arg id "$zone_id" '.result[] | select(.id==$id) | .status')
  echo "    selected zone: ${zone_id} (status=${status})"
  [ "$status" = "active" ] || echo "    WARNING: zone status is '${status}', not 'active'" >&2

  echo "==> Creating proxied placeholder record for ${HOST}"
  # AAAA to 100:: is the documented route-only placeholder: it exists purely so a Worker route can
  # attach to the hostname. It must be PROXIED (orange) or the route never sees traffic.
  # Filter client-side on an exact name match rather than trusting the API's ?name= semantics.
  # Taking .result[0] from a filter that turns out to be ignored hands you an arbitrary record
  # from the zone -- the same mistake that made the zone lookup above pick the wrong zone.
  local records existing
  records=$(curl -fsS "${api}/zones/${zone_id}/dns_records?per_page=5000" \
    -H "Authorization: Bearer ${CF_DNS_TOKEN}")
  existing=$(printf '%s' "$records" | jq -r --arg n "$HOST" \
    '[.result[] | select(.name == $n)] | .[0].id // empty')
  printf '%s' "$records" | jq -r --arg n "$HOST" \
    '.result[] | select(.name == $n) | "    existing: type=\(.type) content=\(.content) proxied=\(.proxied) ttl=\(.ttl)"'

  if [ -n "$existing" ]; then
    echo "    a record for ${HOST} already exists (id ${existing}) -- leaving it alone"
  else
    curl -fsS -X POST "${api}/zones/${zone_id}/dns_records" \
      -H "Authorization: Bearer ${CF_DNS_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "{\"type\":\"AAAA\",\"name\":\"${HOST}\",\"content\":\"100::\",\"proxied\":true,\"comment\":\"Worker route placeholder for meshtastic/api v2 staging\"}" \
      | jq -r 'if .success then "    created: \(.result.name) \(.result.type) proxied=\(.result.proxied)" else "    FAILED: \(.errors)" end'
  fi
  unset CF_DNS_TOKEN

  # A 200 from the API is not proof the name resolves -- it only proves SOME zone accepted it.
  # Ask the zone's own authoritative nameservers, which bypasses every cache.
  echo "==> Verifying against the authoritative nameservers"
  local ns rc
  ns=$(dig +short NS "${ZONE}" | head -1 | sed 's/\.$//')
  rc=$(dig "@${ns}" "${HOST}" 2>/dev/null | grep -c "^${HOST}" || true)
  if [ "${rc:-0}" -gt 0 ]; then
    echo "    ${HOST} resolves authoritatively -- good"
  else
    echo "    ${HOST} does NOT resolve on ${ns}." >&2
    echo "    The record was accepted by a zone that is not serving this domain." >&2
    exit 1
  fi
}

# Derives the R2 S3 credentials from a Cloudflare API token, per the R2 docs:
#   Access Key ID     = the token's ID
#   Secret Access Key = SHA-256 of the token VALUE
# Most people miss the second one and try to use the raw token value, which fails with an opaque
# SignatureDoesNotMatch.
r2_secret_from_value() {
  printf '%s' "$1" | shasum -a 256 | cut -d' ' -f1
}

cmd_secrets() {
  need gh
  gh auth status >/dev/null 2>&1 || die "gh is not authenticated"

  echo "==> Cloudflare account ID (not secret; stored as a repo VARIABLE)"
  read -r -p "    CLOUDFLARE_ACCOUNT_ID: " account_id
  [ -n "$account_id" ] || die "account id is required"
  gh variable set CLOUDFLARE_ACCOUNT_ID -R "$REPO" --body "$account_id"

  echo
  echo "==> Workers deploy token"
  echo "    Dashboard -> My Profile -> API Tokens -> Create Token -> Custom token"
  echo "      Account | Workers Scripts        : Edit"
  echo "      Account | Workers R2 Storage     : Edit"
  echo "      Account | Account Settings       : Read"
  echo "      Zone    | Workers Routes         : Edit   (zone: ${ZONE})"
  echo "    Do NOT add Cache Purge or any Rulesets permission. The Worker sets every header in"
  echo "    code, so the token needs neither -- and without Rulesets it cannot touch the other"
  echo "    hostnames in this zone."
  echo
  echo "==> R2 token"
  echo "    Dashboard -> R2 -> API -> Manage API Tokens -> Create -> Object Read & Write,"
  echo "    scoped to the ${BUCKET} bucket ONLY. Both values are shown once and are not"
  echo "    recoverable afterwards."
  echo
  echo "    Put each value in its own gitignored file -- never paste a secret at a prompt, since"
  echo "    a terminal can echo pasted text before the read consumes it:"
  echo
  echo "      printf '%s' 'VALUE' > .cf-worker-token     && chmod 600 .cf-worker-token"
  echo "      printf '%s' 'VALUE' > .r2-access-key-id    && chmod 600 .r2-access-key-id"
  echo "      printf '%s' 'VALUE' > .r2-secret-access-key && chmod 600 .r2-secret-access-key"
  echo
  local missing=0
  for f in .cf-worker-token .r2-access-key-id .r2-secret-access-key; do
    [ -f "$f" ] || { echo "    missing: $f" >&2; missing=1; }
  done
  [ "$missing" = "0" ] || die "create the files above, then re-run"

  # Piped straight from file to gh; the value is never rendered to a terminal.
  tr -d '\r\n' < .cf-worker-token       | gh secret set CLOUDFLARE_API_TOKEN   -R "$REPO"
  tr -d '\r\n' < .r2-access-key-id      | gh secret set R2_ACCESS_KEY_ID       -R "$REPO"
  tr -d '\r\n' < .r2-secret-access-key  | gh secret set R2_SECRET_ACCESS_KEY   -R "$REPO"

  echo "    stored. Now delete the local copies:"
  echo "      rm -P .cf-worker-token .r2-access-key-id .r2-secret-access-key"

  echo
  echo "==> Stored. Verifying names only (values are never readable back):"
  gh secret list -R "$REPO"
  gh variable list -R "$REPO"
}

cmd_check() {
  need gh
  echo "== GitHub =="
  echo "-- secrets --";   gh secret list -R "$REPO"   2>/dev/null || echo "   (none / no access)"
  echo "-- variables --"; gh variable list -R "$REPO" 2>/dev/null || echo "   (none / no access)"
  echo "-- labels --"
  gh label list -R "$REPO" 2>/dev/null | grep -i "pipeline-alert" \
    || echo "   pipeline-alert MISSING -- every workflow's failure-reporting step would itself fail"
  echo
  echo "== Cloudflare =="
  if npx wrangler whoami 2>&1 | grep -q "not authenticated"; then
    echo "   wrangler: not authenticated (run: $0 bucket)"
  else
    npx wrangler whoami 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -iE "account name|account id" || true
    npx wrangler r2 bucket list 2>/dev/null | grep -q "\b${BUCKET}\b" \
      && echo "   bucket ${BUCKET}: exists" || echo "   bucket ${BUCKET}: MISSING"
  fi
  echo
  echo "== DNS =="
  if command -v dig >/dev/null 2>&1; then
    local r; r=$(dig +short "$HOST" 2>/dev/null | head -3)
    [ -n "$r" ] && echo "   ${HOST} -> ${r}" || echo "   ${HOST}: no record yet (run: $0 dns)"
  fi
}

# Dumps what the API believes about the record, next to what DNS actually answers. Prints no
# secrets -- DNS records are public data.
cmd_dns_debug() {
  need curl; need jq
  load_token
  local api=https://api.cloudflare.com/client/v4 zone_id
  zone_id=$(curl -fsS "${api}/zones?name=${ZONE}" -H "Authorization: Bearer ${CF_DNS_TOKEN}" \
    | jq -r '.result[0].id')
  echo "== what the API says =="
  curl -fsS "${api}/zones/${zone_id}/dns_records?per_page=5000" \
    -H "Authorization: Bearer ${CF_DNS_TOKEN}" \
    | jq --arg n "$HOST" '[.result[] | select(.name == $n)]'
  echo "== zone settings that can suppress a record =="
  curl -fsS "${api}/zones/${zone_id}" -H "Authorization: Bearer ${CF_DNS_TOKEN}" \
    | jq '{status: .result.status, paused: .result.paused, type: .result.type, plan: .result.plan.name}'
  unset CF_DNS_TOKEN
  echo "== what DNS actually answers =="
  local ns; ns=$(dig +short NS "${ZONE}" | head -1 | sed 's/\.$//')
  dig "@${ns}" "${HOST}" AAAA | grep -E "status:|^${HOST}" || echo "   (no answer)"
}

# Distinguishes "the API writes are not reaching the zone that DNS actually serves" from
# "this specific proxied AAAA will not publish", by writing a plain unproxied TXT record --
# the simplest thing a nameserver can serve -- and asking the authoritative servers for it.
# Self-cleaning: the TXT is deleted whether or not it resolved.
cmd_dns_probe() {
  need curl; need jq; need dig
  load_token
  local api=https://api.cloudflare.com/client/v4 zone_id ns probe rec_id
  zone_id=$(curl -fsS "${api}/zones?name=${ZONE}" -H "Authorization: Bearer ${CF_DNS_TOKEN}" \
    | jq -r '.result[0].id')
  ns=$(dig +short NS "${ZONE}" | head -1 | sed 's/\.$//')
  probe="_v2probe.${ZONE}"

  echo "==> SOA serial before the write"
  local before; before=$(dig "@${ns}" "${ZONE}" SOA +short | awk '{print $3}')
  echo "    ${before}"

  echo "==> Creating unproxied TXT ${probe}"
  rec_id=$(curl -fsS -X POST "${api}/zones/${zone_id}/dns_records" \
    -H "Authorization: Bearer ${CF_DNS_TOKEN}" -H "Content-Type: application/json" \
    --data "{\"type\":\"TXT\",\"name\":\"${probe}\",\"content\":\"v2probe\",\"ttl\":60}" \
    | jq -r '.result.id // empty')
  [ -n "$rec_id" ] || die "the API refused to create the TXT record"
  echo "    id ${rec_id}"

  sleep 10
  echo "==> Asking ${ns} for it"
  local got; got=$(dig "@${ns}" "${probe}" TXT +short 2>/dev/null)
  local after; after=$(dig "@${ns}" "${ZONE}" SOA +short | awk '{print $3}')

  echo "==> Deleting the probe record"
  curl -fsS -X DELETE "${api}/zones/${zone_id}/dns_records/${rec_id}" \
    -H "Authorization: Bearer ${CF_DNS_TOKEN}" >/dev/null && echo "    deleted"
  unset CF_DNS_TOKEN

  echo
  echo "    SOA serial: ${before} -> ${after}"
  if [ -n "$got" ]; then
    echo "    TXT RESOLVED (${got})."
    echo "    => Writes DO reach the served zone. The problem is specific to the proxied AAAA"
    echo "       placeholder, not to the account or the token."
  else
    echo "    TXT did NOT resolve."
    echo "    => API writes are not reaching the zone these nameservers serve, even for a plain"
    echo "       TXT record. That is an account/zone-object mismatch, not anything about Workers."
    echo "       Check the dashboard: does ${ZONE} -> DNS list the records this token can see?"
  fi
}

case "${1:-}" in
  bucket)  cmd_bucket ;;
  dns-probe) cmd_dns_probe ;;
  dns)     cmd_dns ;;
  dns-debug) cmd_dns_debug ;;
  secrets) cmd_secrets ;;
  check)   cmd_check ;;
  *) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
