#!/usr/bin/env bash
#
# Takes the R2 token screen as copy-pasted text, pulls the credentials out of it, proves they
# work, and writes them to the gitignored files that setup-cloudflare.sh reads.
#
#   ./tools/r2-credentials.sh              # read the clipboard (macOS)
#   ./tools/r2-credentials.sh --stdin      # paste, then Ctrl-D (input is not echoed)
#   ./tools/r2-credentials.sh --id <ID> --secret <SECRET>
#
# Paste the WHOLE block from the R2 token page -- labels, endpoint URL and all. Values are found
# by shape, so surrounding text is harmless. That is deliberate: the previous attempt at this
# stored 1077 bytes of page text as the Access Key ID because it accepted whatever it was handed.
#
# Nothing is ever echoed or printed. The credentials are verified against R2 before being written.
set -euo pipefail

BUCKET=meshtastic-api-v1
ID_FILE=.r2-access-key-id
SECRET_FILE=.r2-secret-access-key

die() { echo "error: $*" >&2; exit 1; }

blob=""
key_id=""
secret=""

while [ $# -gt 0 ]; do
  case "$1" in
    --stdin)
      echo "Paste the R2 credentials block, then press Ctrl-D."
      echo "(Input is hidden. Nothing is echoed.)"
      # stty -echo covers pasted input as well as typed input, which `read -rs` does not reliably
      # do: under bracketed paste many terminals echo the pasted text before the read consumes it.
      stty -echo 2>/dev/null || true
      trap 'stty echo 2>/dev/null || true' EXIT
      blob=$(cat)
      stty echo 2>/dev/null || true
      echo
      ;;
    --id)     key_id="${2:-}"; shift ;;
    --secret) secret="${2:-}"; shift ;;
    -h|--help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done

if [ -z "$key_id" ] && [ -z "$secret" ] && [ -z "$blob" ]; then
  command -v pbpaste >/dev/null || die "no clipboard tool; use --stdin or --id/--secret"
  blob=$(pbpaste)
  [ -n "$blob" ] || die "the clipboard is empty"
  echo "==> Read $(printf '%s' "$blob" | wc -c | tr -d ' ') bytes from the clipboard"
fi

# The account id is also 32 hex and appears in the endpoint URL on the very same page
# (https://<ACCOUNT_ID>.r2.cloudflarestorage.com), so a naive "find a 32-hex string" grabs the
# wrong one about half the time. Resolve the account id first and exclude it explicitly.
account=$(gh variable list -R meshtastic/api --json name,value \
  --jq '.[]|select(.name=="CLOUDFLARE_ACCOUNT_ID")|.value' 2>/dev/null || true)
if [ -z "$account" ]; then
  account=$(npx wrangler whoami 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g' \
            | grep -oE '[0-9a-f]{32}' | head -1 || true)
fi

if [ -n "$blob" ]; then
  # 64 hex = Secret Access Key. Unambiguous: nothing else on that page is 64 hex.
  secret=$(printf '%s' "$blob" | grep -oE '\b[0-9a-f]{64}\b' | head -1 || true)

  # 32 hex = Access Key ID, once the account id and anything inside an r2.cloudflarestorage.com
  # hostname are removed.
  candidates=$(printf '%s' "$blob" \
    | sed -E 's#[0-9a-f]{32}\.r2\.cloudflarestorage\.com##g' \
    | grep -oE '\b[0-9a-f]{32}\b' | sort -u || true)
  [ -n "$account" ] && candidates=$(printf '%s\n' "$candidates" | grep -v "^${account}$" || true)
  count=$(printf '%s\n' "$candidates" | grep -c . || true)

  case "$count" in
    0) die "no Access Key ID found in the pasted text (expected a 32-character hex string)" ;;
    1) key_id=$(printf '%s\n' "$candidates" | head -1) ;;
    *) die "found ${count} possible Access Key IDs; pass it explicitly with --id <ID>" ;;
  esac
fi

printf '%s' "$key_id" | grep -qE '^[0-9a-f]{32}$' || die "the Access Key ID is not 32 hex characters"
printf '%s' "$secret" | grep -qE '^[0-9a-f]{64}$' || die "the Secret Access Key is not 64 hex characters"
[ -n "$account" ] || die "could not determine the Cloudflare account id"

echo "==> Found an Access Key ID and a Secret Access Key of the right shape"
echo "==> Verifying them against the ${BUCKET} bucket before writing anything"
if ! R2_ACCOUNT_ID="$account" R2_BUCKET="$BUCKET" \
     R2_ACCESS_KEY_ID="$key_id" R2_SECRET_ACCESS_KEY="$secret" \
     node tools/r2-verify-creds.mjs; then
  die "the credentials did not authenticate -- nothing was written"
fi

umask 077
printf '%s' "$key_id" > "$ID_FILE"
printf '%s' "$secret" > "$SECRET_FILE"
chmod 600 "$ID_FILE" "$SECRET_FILE"
echo "==> Wrote ${ID_FILE} and ${SECRET_FILE} (mode 600, gitignored)"
echo
echo "Next:"
echo "  ./tools/setup-cloudflare.sh secrets     # store them on the repo"
echo "  rm -P ${ID_FILE} ${SECRET_FILE}         # then delete the local copies"
