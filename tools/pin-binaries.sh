#!/usr/bin/env bash
# Regenerates the binary immutability pins. Run this ONLY when deliberately adding or retiring a
# published binary -- never to make a failing validate pass.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p tests/golden
{
  find static/eventFirmware -name '*.png' | sort
  find static/maintenanceUf2 -name '*.uf2' | sort
  echo static/favicon.ico
} | xargs shasum -a 256 > tests/golden/binaries.sha256
wc -l < tests/golden/binaries.sha256 | xargs echo "pinned binaries:"
