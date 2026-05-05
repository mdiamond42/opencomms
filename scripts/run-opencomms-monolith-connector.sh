#!/bin/bash
set -euo pipefail
export HOME=/Users/example
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/Library/pnpm:$HOME/.local/bin
cd /path/to/agentcomms
TOKEN_FILE="$PWD/.secrets/opencomms_rendezvous_token.txt"
if [ ! -r "$TOKEN_FILE" ]; then
  echo "missing token file: $TOKEN_FILE" >&2
  exit 1
fi
OPENCOMMS_RENDEZVOUS_SCHEME="${OPENCOMMS_RENDEZVOUS_SCHEME:-https}"
OPENCOMMS_RENDEZVOUS_HOST="${OPENCOMMS_RENDEZVOUS_HOST:-opencomms-rendezvous.fly.dev}"
export OPENCOMMS_RENDEZVOUS_URL="${OPENCOMMS_RENDEZVOUS_URL:-${OPENCOMMS_RENDEZVOUS_SCHEME}://${OPENCOMMS_RENDEZVOUS_HOST}}"
export OPENCOMMS_RENDEZVOUS_TOKEN="$(tr -d '\n' < "$TOKEN_FILE")"
export OPENCOMMS_USER_ID=monolith
export AGENTCOMMS_CONFIG=/path/to/agentcomms/.secrets/opencomms-monolith-config.json
exec npx pnpm --filter @agentcomms/bridge dev:rendezvous
