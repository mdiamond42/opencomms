# OpenComms Android

A generic, open-source Android messaging client for the OpenComms relay protocol.
Communicates with humans, agents, devices, and services via a transport-only relay.

---

## Build instructions

### Prerequisites

| Tool | Version |
|------|---------|
| Java | 17 (set `JAVA_HOME`) |
| Android SDK | API 34 |
| Android SDK Build Tools | 34.x |
| Gradle | 8.7 (managed by wrapper) |

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export ANDROID_SDK_ROOT=$ANDROID_HOME
export PATH="$JAVA_HOME/bin:/opt/homebrew/bin:$ANDROID_HOME/platform-tools:$PATH"
```

### First-time setup (Gradle wrapper jar)

The `gradle-wrapper.jar` binary is not committed. Generate it once:

```bash
cd apps/android
gradle wrapper --gradle-version 8.7
```

Or download it from [https://github.com/gradle/gradle/releases](https://github.com/gradle/gradle/releases).

### Build debug APK

```bash
cd apps/android
./gradlew assembleDebug
# Output: app/build/outputs/apk/debug/app-debug.apk
```

### Run unit tests

```bash
cd apps/android
./gradlew test
```

### Lint

```bash
cd apps/android
./gradlew lint
```

### Install on device

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

---

## How to add a contact

### Via manual paste (works offline)

Obtain a v1 simple pairing payload from your agent operator:

```json
{
  "type": "opencomms_pairing_v1",
  "relay_url": "https://your-relay-url",
  "token": "your-token",
  "contact_id": "agent:assistant",
  "contact_display_name": "Assistant",
  "contact_kind": "agent"
}
```

In the app: **Add contact → Paste payload → paste the JSON → Validate → Confirm add.**

### Via QR scan

The agent operator generates a QR code encoding the same JSON (UTF-8, no base64 wrapper).
In the app: **Add contact → Scan QR → point camera at QR.**

### Pointing at a real relay (no code changes required)

Paste a pairing payload that contains the real `relay_url`. The app derives the WebSocket
endpoint automatically: `relay_url` with `https://` → `wss://` + `/v0/ws`.

Example with v1 simple shape (fill with real values locally, **never commit** real tokens):

```json
{
  "type": "opencomms_pairing_v1",
  "relay_url": "https://your-relay.example.com",
  "token": "<real-or-scoped-token>",
  "contact_id": "agent:hermes",
  "contact_display_name": "Hermes",
  "contact_kind": "agent"
}
```

---

## Architecture overview

```
identity/        LocalIdentity generation + persistence (SharedPreferences)
pairing/         PairingPayload, PairingParser, PairingValidator, PairingError
relay/           RelayAccount, ClientStateMachine, RelayClient (OkHttp WebSocket)
protocol/        EnvelopeV01, EnvelopeWrapper, RegisterFrame, RelayFrameCodec
contacts/        Contact, ContactRepository
chat/            ChatMessage, TranscriptRepository, ChatViewModel
storage/         PrefsStore (SharedPreferences JSON adapter)
diagnostics/     DiagnosticsExporter (scrubbed — no tokens, bodies, or full IDs)
ui/              Jetpack Compose screens + Navigation
```

### WebSocket lifecycle

```
Idle
  └─ connect() ──────────────────────────> Connecting
                                              └─ socket open ──> SocketOpenAwaitingRegister
                                                                    └─ registered frame ──> Registered
                                                                                              └─ error frame ──> Error
Any state ──────────────────────────────────────────────────────────────────────────────> Disconnected (auto-reconnect)
```

Composer is **disabled** until state == `Registered`.

### Outbound message format

All outbound messages are wrapped:

```json
{
  "type": "envelope",
  "envelope": {
    "v": "0.1",
    "id": "<uuid>",
    "created_at": "<ISO-8601>",
    "sender": { "type": "human", "id": "human:local:<uuid>", "device_id": "device:android:<uuid>" },
    "recipient": { "type": "agent", "id": "<contact-id>" },
    "kind": "text",
    "body": { "text": "<message>" }
  }
}
```

Raw `EnvelopeV01` is **never** sent at the top level.

---

## Privacy notes

- `android:allowBackup="false"` — no Android backup/cloud sync of app data.
- No tokens, message bodies, or full contact IDs are written to Logcat at WARN/ERROR.
  Debug-only logging is gated on `BuildConfig.DEBUG`.
- Diagnostics export excludes tokens, message bodies, and full contact IDs (only SHA-256
  hashed prefixes are included).
- No crash reporter or analytics SDK is integrated.
- All transcripts are stored locally only; they never leave the device via the relay.

---

## Known limitations and follow-ups

| Item | Status |
|------|--------|
| `EncryptedSharedPreferences` for token storage | Planned follow-up |
| Keystore-backed keypair for E2E encryption | Stub only; encryption not applied |
| Short-lived pairing endpoint flow (`pairing_endpoint`) | `NotImplementedExchanger` stub |
| Package rename: `com.opencomms.baja` → `com.opencomms.app` | Planned after Play Store scoping |
| Production ProGuard rules | Placeholder only |
| Play Store release signing | Out of scope |

---

## Examples (not defaults)

The following are example agent profiles that can be added as contacts via pairing payloads.
They are not built into the app. No Hermes/local agent-specific logic exists in core code paths.

- **Hermes** — `contact_id: "agent:hermes"`, `contact_kind: "agent"`
- **Peer agent** — `contact_id: "agent:monolith"`, `contact_kind: "agent"`

---

## License

See repository root for license. (Follow-up: confirm open-source license before public release.)
