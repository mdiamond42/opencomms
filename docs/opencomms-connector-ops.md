# OpenComms Connector Ops Runbook

Status: v0 sidecar connector working on Mac mini. Native Hermes/local agent runtime platform adapter remains next build.

## Live relay

- Fly app: `https://opencomms-rendezvous.fly.dev`
- Health: `GET /v0/health`
- Expected online users after LaunchAgents start: `hermes`, `monolith`

## Durable files

- Relay token: `.secrets/opencomms_rendezvous_token.txt`
- Hermes bridge config: `.secrets/opencomms-hermes-config.json`
- Monolith bridge config: `.secrets/opencomms-monolith-config.json`
- Monolith CLI adapter: `scripts/opencomms-monolith-adapter.py`
- Hermes connector wrapper: `scripts/run-opencomms-hermes-connector.sh`
- Monolith connector wrapper: `scripts/run-opencomms-monolith-connector.sh`

## LaunchAgents

- `~/Library/LaunchAgents/com.opencomms.bridge.hermes.plist`
- `~/Library/LaunchAgents/com.opencomms.bridge.monolith.plist`

Reload:

```bash
UIDNUM=$(id -u)
launchctl bootout gui/$UIDNUM/com.opencomms.bridge.hermes >/dev/null 2>&1 || true
launchctl bootout gui/$UIDNUM/com.opencomms.bridge.monolith >/dev/null 2>&1 || true
launchctl bootstrap gui/$UIDNUM ~/Library/LaunchAgents/com.opencomms.bridge.hermes.plist
launchctl bootstrap gui/$UIDNUM ~/Library/LaunchAgents/com.opencomms.bridge.monolith.plist
launchctl kickstart -k gui/$UIDNUM/com.opencomms.bridge.hermes
launchctl kickstart -k gui/$UIDNUM/com.opencomms.bridge.monolith
```

Verify:

```bash
launchctl print gui/$(id -u)/com.opencomms.bridge.hermes | egrep 'state =|pid =|last exit code =|runs ='
launchctl print gui/$(id -u)/com.opencomms.bridge.monolith | egrep 'state =|pid =|last exit code =|runs ='
curl -sS https://opencomms-rendezvous.fly.dev/v0/health
curl -sS http://127.0.0.1:8790/v0/health
curl -sS http://127.0.0.1:8791/v0/health
```

## Smoke tests

Hermes:

```bash
TOKEN=$(cat .secrets/opencomms_rendezvous_token.txt)
OPENCOMMS_RENDEZVOUS_URL=https://opencomms-rendezvous.fly.dev \
OPENCOMMS_RENDEZVOUS_TOKEN="$TOKEN" \
OPENCOMMS_SMOKE_RECIPIENT=hermes \
OPENCOMMS_SMOKE_SENDER=phone:baja \
OPENCOMMS_SMOKE_BODY='Reply exactly: HERMES_LAUNCHD_OPENCOMMS_OK' \
OPENCOMMS_SMOKE_TIMEOUT_MS=120000 \
npx pnpm smoke:rendezvous
```

Monolith:

```bash
TOKEN=$(cat .secrets/opencomms_rendezvous_token.txt)
OPENCOMMS_RENDEZVOUS_URL=https://opencomms-rendezvous.fly.dev \
OPENCOMMS_RENDEZVOUS_TOKEN="$TOKEN" \
OPENCOMMS_SMOKE_RECIPIENT=monolith \
OPENCOMMS_SMOKE_SENDER=example-agent \
OPENCOMMS_SMOKE_BODY='Reply exactly: MONOLITH_LAUNCHD_OPENCOMMS_OK' \
OPENCOMMS_SMOKE_TIMEOUT_MS=120000 \
npx pnpm smoke:rendezvous
```

## Logs/transcripts

- Hermes launchd stdout/stderr: `~/.agentcomms/logs/opencomms-hermes-launchd.*.log`
- Monolith launchd stdout/stderr: `~/.agentcomms/logs/opencomms-monolith-launchd.*.log`
- Monolith adapter JSONL log: `~/.agentcomms/logs/opencomms-monolith-adapter.jsonl`
- Hermes transcript: `~/.agentcomms/opencomms-hermes-transcripts.jsonl`
- Monolith transcript: `~/.agentcomms/opencomms-monolith-transcripts.jsonl`

## Next native build

Replace sidecar bridge with native installable adapters:

- Hermes: `OpenCommsAdapter(BasePlatformAdapter)` inside Hermes gateway, matching Telegram/WhatsApp lifecycle.
- local agent runtime: OpenComms plugin/adapter registering `monolith` and dispatching into local agent runtime's normal agent turn lifecycle.
- Phone UI should show transport/model errors visibly instead of requiring transcript inspection.
