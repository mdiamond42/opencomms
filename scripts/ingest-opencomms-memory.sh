#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

node scripts/export-opencomms-memory.mjs "$@"

BAJA="${BAJA_BIN:-baja}"
if [ ! -x "$BAJA" ]; then
  if command -v baja >/dev/null 2>&1; then
    BAJA=$(command -v baja)
  else
    echo "ingest-opencomms-memory: baja CLI not found; skipping ingest" >&2
    exit 0
  fi
fi

set -- ingest docs/memory/opencomms/ --kind note --status current --json
if [ -n "${BAJA_DB:-}" ]; then
  "$BAJA" init --json --db "$BAJA_DB" >/dev/null
  set -- "$@" --db "$BAJA_DB"
else
  "$BAJA" init --json >/dev/null
fi
exec "$BAJA" "$@"
