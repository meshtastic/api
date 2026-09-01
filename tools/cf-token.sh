#!/usr/bin/env bash
#
# Takes the Cloudflare "API token created!" page as copy-pasted text, finds the token in it,
# proves it works, and writes it to a gitignored file.
#
#   ./tools/cf-token.sh                    # read the clipboard (macOS)
#   ./tools/cf-token.sh --stdin            # paste, then Ctrl-D (input is not echoed)
#   ./tools/cf-token.sh --token <TOKEN>
#   ./tools/cf-token.sh --out .cf-token    # write somewhere else (default .cf-worker-token)
#
# Paste the WHOLE page. The token appears twice on it -- once on its own and once inside the
# `curl ... -H "Authorization: Bearer ..."` example -- and the page also carries an account id and
# other identifiers. Rather than guess which string is the token, every candidate is offered to
# Cloudflare's own /user/tokens/verify and the one that authenticates wins. The API is a better
# judge of what a token is than any regex.
#
# Nothing is ever echoed or printed.
set -euo pipefail

OUT=.cf-worker-token
blob=""
token=""

die() { echo "error: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --stdin)
      echo "Paste the Cloudflare token page, then press Ctrl-D."
      echo "(Input is hidden. Nothing is echoed.)"
      stty -echo 2>/dev/null || true
      trap 'stty echo 2>/dev/null || true' EXIT
      blob=$(cat)
      stty echo 2>/dev/null || true
      echo
      ;;
    --token) token="${2:-}"; shift ;;
    --out)   OUT="${2:-}"; shift ;;
    -h|--help) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done

if [ -z "$token" ] && [ -z "$blob" ]; then
  command -v pbpaste >/dev/null || die "no clipboard tool; use --stdin or --token"
  blob=$(pbpaste)
  [ -n "$blob" ] || die "the clipboard is empty"
  echo "==> Read $(printf '%s' "$blob" | wc -c | tr -d ' ') bytes from the clipboard"
fi

account=$(gh variable list -R meshtastic/api --json name,value \
  --jq '.[]|select(.name=="CLOUDFLARE_ACCOUNT_ID")|.value' 2>/dev/null || true)

candidates=""
if [ -n "$token" ]; then
  candidates="$token"
else
  # Cloudflare has issued several token shapes -- a bare 40-char string, and prefixed ones
  # (cfat_ for account tokens, cfut_ for user tokens; observed, not documented). Match all of them
  # generously and let verification do the filtering. Bare 32-hex strings are dropped: those are
  # account and zone ids, and this page is full of them.
  candidates=$(printf '%s' "$blob" \
    | grep -oE '\b(cf[a-z]{2}_[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]{40,80})\b' \
    | grep -vE '^[0-9a-f]{32}$' \
    | sort -u)
fi

count=$(printf '%s\n' "$candidates" | grep -c . || true)
[ "$count" != "0" ] || die "no token-shaped string found in the pasted text"
echo "==> ${count} candidate$([ "$count" = 1 ] || echo s) to try against Cloudflare"

found=""
while IFS= read -r c; do
  [ -n "$c" ] || continue
  if CLOUDFLARE_API_TOKEN="$c" CLOUDFLARE_ACCOUNT_ID="$account" \
     node tools/cf-verify-token.mjs >/tmp/cf-token-check.$$ 2>&1; then
    found="$c"
    cat /tmp/cf-token-check.$$
    rm -f /tmp/cf-token-check.$$
    break
  fi
  rm -f /tmp/cf-token-check.$$
done <<< "$candidates"

if [ -z "$found" ]; then
  # Re-run the single/last candidate with output shown, so the reason is visible rather than
  # swallowed -- "no candidate worked" is not an actionable message on its own.
  echo "==> No candidate authenticated. Reason from the most likely one:" >&2
  last=$(printf '%s\n' "$candidates" | tail -1)
  CLOUDFLARE_API_TOKEN="$last" CLOUDFLARE_ACCOUNT_ID="$account" \
    node tools/cf-verify-token.mjs || true
  die "nothing was written"
fi

umask 077
printf '%s' "$found" > "$OUT"
chmod 600 "$OUT"
echo "==> Wrote ${OUT} (mode 600, gitignored)"
echo
echo "Next:"
echo "  ./tools/setup-cloudflare.sh secrets   # store it on the repo"
echo "  rm -P ${OUT}                          # then delete the local copy"
