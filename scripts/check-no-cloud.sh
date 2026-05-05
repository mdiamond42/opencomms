#!/bin/sh
set -eu

tmp_lines=$(mktemp "${TMPDIR:-/tmp}/agentcomms-no-cloud-lines.XXXXXX")
tmp_urls=$(mktemp "${TMPDIR:-/tmp}/agentcomms-no-cloud-urls.XXXXXX")
trap 'rm -f "$tmp_lines" "$tmp_urls"' EXIT
scan_root="${CHECK_NO_CLOUD_ROOT:-.}"

rg -n --hidden \
  --glob '!node_modules/**' --glob '!dist/**' --glob '!dist-types/**' \
  --glob '!.git/**' --glob '!docs/**' --glob '!specs/**' \
  --glob '!**/build/**' --glob '!**/.gradle/**' \
  --glob '!**/gradlew' --glob '!**/gradlew.bat' \
  --glob '!**/README.md' --glob '!**/test/**' --glob '!**/tests/**' \
  --glob '!**/*.test.*' --glob '!**/*.spec.*' \
  --glob '!package.json' --glob '!pnpm-lock.yaml' \
  --glob '!scripts/check-no-cloud.sh' --glob '!scripts/check-no-cloud.test.mjs' \
  'https?://|wss?://' "$scan_root" > "$tmp_lines" || true

if [ ! -s "$tmp_lines" ]; then
  exit 0
fi

# Validate each URL token independently. Do not allow an approved URL or
# scheme-only literal elsewhere on the same source line to mask a cloud URL.
rg -o --no-filename 'https?://[^[:space:]"'"'"'<>),;]*|wss?://[^[:space:]"'"'"'<>),;]*' "$tmp_lines" > "$tmp_urls" || true

if rg -v '^(https?|wss?)://(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])([/:?#]|$)|^(https?|wss?)://$|^http://\$\{config\.bind\}[:/}]|^https://\*\.trycloudflare\.com$|^wss://\*\.trycloudflare\.com$|^http://schemas\.android\.com/|^http://www\.apple\.com/DTDs/PropertyList' "$tmp_urls"; then
  echo "check:no-cloud failed: non-local URL found in source" >&2
  exit 1
fi
