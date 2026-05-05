# AgentComms Protocol v0.1

Every runtime frame is a JSON envelope with `version: "0.1"`. `payload.body` is always a string, even for JSON payloads. Use `payload.content_type: "application/json"` plus a serialized JSON string when structured body content is needed.

## Text Message

```json
{
  "version": "0.1",
  "id": "uuid",
  "idempotency_key": "idem_uuid",
  "created_at": "2026-04-27T12:00:00.000Z",
  "expires_at": "2026-04-27T12:01:00.000Z",
  "sender": { "type": "human", "id": "user:baja", "device_id": "browser" },
  "recipient": { "type": "agent", "id": "echo" },
  "channel": "text",
  "intent": "message",
  "requires_ack": true,
  "correlation_id": null,
  "payload": { "content_type": "text/plain", "body": "hello" },
  "permissions": {
    "may_execute_tools": false,
    "may_notify_human": true,
    "risk_level": "low"
  }
}
```

## WebSocket Register

On connect, clients may send a `system` envelope to identify the participant:

```json
{
  "intent": "system",
  "channel": "system",
  "payload": {
    "content_type": "application/json",
    "body": "{\"kind\":\"register\",\"as\":{\"type\":\"human\",\"id\":\"user:baja\"}}"
  }
}
```

The full envelope fields are still required. The protocol package helper `makeEnvelope` fills ids, timestamps, defaults, and `version`.

## Privacy Rules

`payload.body` may be sent over localhost to the bridge and may be stored in the local transcript store when enabled. It must not be logged. Cloud relay, native app packaging, and encryption are deferred beyond this vertical slice.
