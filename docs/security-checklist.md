# AgentComms v0.1 Security Checklist

- [x] Bridge binds to `127.0.0.1` by default.
- [x] Same-LAN phone testing requires explicit `AGENTCOMMS_ALLOW_LAN=1` or config override.
- [x] HTTP and WebSocket calls require a local bearer token.
- [x] `payload.body` is excluded from structured logs and covered by a test.
- [x] Typed browser/PWA mode is the no-cloud baseline.
- [x] Browser STT is not implemented in this slice, so no vendor STT traffic is introduced.
- [x] `scripts/check-no-cloud.sh` rejects non-local URLs in source.
- [x] No relay, analytics, telemetry, or native app code is included.
- [ ] SQLite is deferred; the vertical slice uses a local JSONL transcript file under `~/.agentcomms/`.
- [ ] Real Hermes integration is deferred; the stdio adapter contract has a local placeholder.
