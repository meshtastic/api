#!/usr/bin/env bash
#
# One-time setup for the v2 Cloudflare deployment.
#
# Automates everything that can be automated WITHOUT creating a super-credential, and reads the
# two Cloudflare tokens interactively so their values never reach a shell history, a log, or a
# terminal scrollback buffer. Nothing here prints a secret.
#
#   ./tools/setup-cloudflare.sh bucket    # wrangler OAuth -> create the R2 bucket
#   ./tools/setup-cloudflare.sh dns       # create the apiv2 DNS record (needs a DNS:Edit token)
#   ./tools/setup-cloudflare.sh secrets   # store the tokens as GitHub Actions secrets
#   ./tools/setup-cloudflare.sh check     # show what is and is not configured
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
  if [ -z "${CF_DNS_TOKEN:-}" ]; then
    printf 'Cloudflare API token with Zone:Read + DNS:Edit on %s (input hidden): ' "$ZONE"
    read -rs CF_DNS_TOKEN; echo
  fi
  [ -n "$CF_DNS_TOKEN" ] || die "no token given"

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
  printf '    CLOUDFLARE_API_TOKEN (input hidden): '
  read -rs cf_token; echo
  [ -n "$cf_token" ] || die "no token given"
  printf '%s' "$cf_token" | gh secret set CLOUDFLARE_API_TOKEN -R "$REPO"
  unset cf_token

  echo
  echo "==> R2 token"
  echo "    Dashboard -> R2 -> API -> Manage API Tokens -> Create -> Object Read & Write,"
  echo "    scoped to the ${BUCKET} bucket ONLY."
  echo "    Paste the Access Key ID and Secret Access Key it shows you (they are not"
  echo "    recoverable afterwards)."
  printf '    R2_ACCESS_KEY_ID (input hidden): '
  read -rs r2_id; echo
  printf '    R2_SECRET_ACCESS_KEY (input hidden): '
  read -rs r2_secret; echo
  [ -n "$r2_id" ] && [ -n "$r2_secret" ] || die "both R2 values are required"
  printf '%s' "$r2_id" | gh secret set R2_ACCESS_KEY_ID -R "$REPO"
  printf '%s' "$r2_secret" | gh secret set R2_SECRET_ACCESS_KEY -R "$REPO"
  unset r2_id r2_secret

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
  if [ -z "${CF_DNS_TOKEN:-}" ]; then
    printf 'Cloudflare API token with Zone:Read + DNS:Read (input hidden): '
    read -rs CF_DNS_TOKEN; echo
  fi
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

case "${1:-}" in
  bucket)  cmd_bucket ;;
  dns)     cmd_dns ;;
  dns-debug) cmd_dns_debug ;;
  secrets) cmd_secrets ;;
  check)   cmd_check ;;
  *) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
