# OpenComms / AgentComms

OpenComms is a local-first communication layer for talking to AI agents, tools, and local services without handing transcripts to a third-party chat platform by default.

This repository currently contains:

- **AgentComms protocol**: typed envelopes, contact cards, trust-card parsing, and pairing helpers.
- **Local bridge**: loopback-first HTTP/WebSocket bridge with echo, CLI, and local HTTP adapters.
- **Dumb rendezvous relay**: optional WebSocket relay for routing envelopes between devices/agents without message-body persistence.
- **Browser client**: typed local/PWA client for development.
- **Android app**: native local-first client with QR/deep-link pairing, contacts, chat, collaboration flows, STT/TTS controls, and Samsung/Android TTS support.

## Principles

- **Local-first**: local bridge binds to `127.0.0.1` by default.
- **No cloud transcripts by default**: the relay is intentionally dumb and does not persist message bodies.
- **Explicit pairing**: contacts and agents are added through signed cards or pairing links.
- **Persona-neutral defaults**: specific agent identities and prompt styles belong in local config, not product defaults.
- **Portable adapters**: connect your own agent via local CLI, local HTTP, or the echo adapter for tests.

## Requirements

- Node.js 20+
- pnpm 9.x
- Java 17 + Android SDK for Android builds

## Quickstart

```sh
pnpm install
AGENTCOMMS_DEV_DEFAULT_TOKEN=replace-with-local-dev-token pnpm dev:bridge
```

In another terminal:

```sh
AGENTCOMMS_DEV_DEFAULT_TOKEN=replace-with-local-dev-token pnpm cli send --to echo --text "hello"
AGENTCOMMS_DEV_DEFAULT_TOKEN=replace-with-local-dev-token pnpm cli tail
```

For the browser client:

```sh
pnpm dev:client
```

Open `http://127.0.0.1:5173`, paste your local dev token, keep recipient as `echo`, connect, and send typed text.

Browser speech recognition is intentionally not the privacy baseline because browser STT may use vendor services.

## Local bridge config

Use `~/.agentcomms/config.json` for normal local runs:

```json
{
  "bind": "127.0.0.1",
  "port": 8787,
  "token": "replace-with-a-long-random-token",
  "transcript_path": "~/.agentcomms/transcripts.jsonl",
  "transcripts_enabled": true,
  "adapters": {
    "echo": { "kind": "echo" },
    "local-agent": {
      "kind": "agent_cli",
      "command": "your-agent-cli",
      "args": ["--json"],
      "message_arg": "--message",
      "timeout_ms": 120000,
      "prompt_prefix": "You are a concise local assistant responding through OpenComms."
    }
  }
}
```

Same-LAN phone testing is off by default. Enable it only for explicit development runs:

```sh
AGENTCOMMS_DEV_DEFAULT_TOKEN=replace-with-local-dev-token \
AGENTCOMMS_ALLOW_LAN=1 \
AGENTCOMMS_BIND=0.0.0.0 \
pnpm dev:bridge

pnpm dev:client --host 0.0.0.0
```

Then open `http://LAN_IP:5173` on a phone on the same Wi-Fi and set the bridge URL to `http://LAN_IP:8787` in the browser fields.

## Rendezvous relay prototype

The relay lives in `packages/rendezvous`. It is intentionally minimal:

- WebSocket only: `/v0/ws`
- Health: `/v0/health`
- In-memory presence: `user_id -> sockets`
- Envelope routing by `envelope.recipient.id`
- No message-body persistence
- Redacted logs only: IDs, sender/recipient, byte counts, status

Local three-process smoke:

```sh
# Terminal 1: relay
OPENCOMMS_RENDEZVOUS_TOKEN=replace-with-local-token PORT=8799 pnpm dev:rendezvous

# Terminal 2: local bridge registers as echo and forwards relay traffic to local echo adapter
AGENTCOMMS_DEV_DEFAULT_TOKEN=replace-with-local-dev-token \
OPENCOMMS_RENDEZVOUS_URL=http://127.0.0.1:8799 \
OPENCOMMS_RENDEZVOUS_TOKEN=replace-with-local-token \
OPENCOMMS_USER_ID=echo \
pnpm dev:rendezvous-bridge

# Terminal 3: simulated phone/user sends through relay and receives reply through relay
OPENCOMMS_RENDEZVOUS_URL=http://127.0.0.1:8799 \
OPENCOMMS_RENDEZVOUS_TOKEN=replace-with-local-token \
pnpm smoke:rendezvous
```

Fly.io deployment is optional:

```sh
fly launch --copy-config --name opencomms-rendezvous --region iad --no-deploy
fly secrets set OPENCOMMS_RENDEZVOUS_TOKEN='replace-with-production-token'
fly deploy
fly status
```

## Android app

The Android app is under `apps/android`.

```sh
cd apps/android
./gradlew :app:testDebugUnitTest :app:assembleDebug --no-daemon --stacktrace
```

The app supports Android TTS settings and engine/voice selection, including Samsung TTS where the device exposes it. Speech controls are in Settings so chat stays clean.

## Commands

```sh
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm check:no-cloud
pnpm build
pnpm dev:rendezvous
pnpm dev:rendezvous-bridge
pnpm smoke:rendezvous
```

## Repository hygiene

Local runtime files are intentionally ignored: `.secrets/`, `.install/`, generated Android builds, Gradle caches, APK/AAB artifacts, local transcripts, logs, and environment files.

Do not commit real relay tokens, API keys, private keys, transcripts, local pairing QR payloads, or personal agent configs.

## Roadmap

OpenComms is currently an early local-first release. Near-term work is focused on making relay choice explicit, portable, and easy for normal users.

### Near term

- **Bring your own relay**: let users enter a custom relay URL and token in the Android app instead of relying on a default hosted relay.
- **Hosted relay option**: provide a simple hosted relay for users who want the app to work without deploying infrastructure.
- **Relay identity cards**: signed share cards that include a contact ID, relay URL, public key, capabilities, and signature so contacts can be paired across user-controlled relay endpoints.
- **Per-contact relay routing**: allow one app install to keep contacts on multiple relays and route each message through the relay declared by that contact card.
- **Relay setup docs/scripts**: document a minimal self-hosted relay path for Fly.io, VPS, or other Node-friendly hosts.

### Later

- **Relay federation or bridging**: explore relay-to-relay forwarding so users on separate relays can communicate without manually adding each relay as a separate account.
- **Production relay hardening**: improve monitoring, abuse controls, rate limits, and operational playbooks while keeping the relay dumb and message-body-free.
- **Store release readiness**: Play Store packaging, privacy policy, data safety disclosures, closed testing, and subscription support for hosted relay convenience.

## Status

This is an early open-source release. The core protocol, bridge, relay, CLI, browser dev client, and Android app are present, but production hardening is still ongoing. Custom relay UX and relay identity cards are planned roadmap items, not completed features yet.

## License

MIT. See [LICENSE](LICENSE).
