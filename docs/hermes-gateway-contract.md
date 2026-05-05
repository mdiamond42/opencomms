# Hermes Gateway Contract for AgentComms v0.1

Status: confirmed locally on 2026-04-28.

## Base URL

Default local-only endpoint:

```text
http://127.0.0.1:8642
```

AgentComms bridge should call this URL from the Mac mini only. The phone/PWA must not call Hermes directly and must not receive Hermes API credentials.

## Health

```http
GET /health
```

Confirmed response:

```json
{"status":"ok","platform":"hermes-agent"}
```

No auth required for health.

## Recommended MVP request path

Use OpenAI-compatible non-streaming chat completions:

```http
POST /v1/chat/completions
Content-Type: application/json
Authorization: Bearer <API_SERVER_KEY>   # only when Hermes has API_SERVER_KEY configured
X-Hermes-Session-Id: agentcomms-phone-loop-v0.1   # optional; requires API key if used
```

Request body:

```json
{
  "model": "hermes-agent",
  "stream": false,
  "messages": [
    {
      "role": "system",
      "content": "You are Hermes responding through AgentComms. Keep replies concise."
    },
    {
      "role": "user",
      "content": "<phone text>"
    }
  ]
}
```

Minimum body if no session continuation/system prompt is needed:

```json
{
  "model": "hermes-agent",
  "stream": false,
  "messages": [{"role":"user","content":"<phone text>"}]
}
```

Confirmed local smoke:

- POST `/v1/chat/completions`
- body asked: `Reply exactly: AGENTCOMMS_CONTRACT_OK`
- returned assistant content: `AGENTCOMMS_CONTRACT_OK`

## Success response shape

The adapter should read:

```text
choices[0].message.content
```

Observed top-level keys:

```json
["id", "object", "created", "model", "choices", "usage"]
```

Expected success shape:

```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 1777390000,
  "model": "hermes-agent",
  "choices": [
    {
      "index": 0,
      "message": {"role": "assistant", "content": "..."},
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 0,
    "completion_tokens": 0,
    "total_tokens": 0
  }
}
```

## Auth behavior

`API_SERVER_KEY` may be unset for local-only use; if unset, Hermes accepts local requests without `Authorization`.

If a key is configured, send:

```http
Authorization: Bearer <token>
```

Invalid token returns HTTP `401` with OpenAI-style error:

```json
{"error":{"message":"Invalid API key","type":"invalid_request_error","code":"invalid_api_key"}}
```

Important: `X-Hermes-Session-Id` continuation is rejected with HTTP `403` when no API key is configured. For the v0.1 adapter, either:

1. omit `X-Hermes-Session-Id` when no token is configured, or
2. require `HERMES_GATEWAY_TOKEN` before enabling explicit session continuation.

## Error mapping for AgentComms

The bridge Hermes adapter should translate upstream failures into these stable classes:

- `hermes_unreachable`: network connection refused/reset, DNS/URL failure, or fetch error before HTTP response.
- `hermes_unauthorized`: HTTP `401` or `403`.
- `hermes_timeout`: adapter `AbortController` timeout.
- `hermes_malformed`: non-JSON response, missing `choices[0].message.content`, or non-string content.
- `hermes_upstream`: other non-2xx HTTP response or JSON error envelope.

For v0.1 WebSocket behavior, throwing an `Error` with one of these codes in the message is acceptable because the existing bridge sends `{ "error": "..." }` frames. A later UI pass can promote these to typed error UI states.

## Timeout

The existing CLI adapter defaults to 20 seconds. For HTTP Hermes adapter, use a default `timeout_ms` of `30000` unless config overrides it.

## No-cloud-storage guarantee

The only public hop remains phone browser/PWA through the temporary Cloudflare tunnel to the local AgentComms bridge. The bridge calls Hermes locally on `127.0.0.1`. No Telegram loopback or cloud message-body storage is used.
