#!/usr/bin/env python3
from __future__ import annotations

import datetime
import json
import re
import subprocess
import sys
import uuid
from pathlib import Path

LOG_PATH = Path.home() / ".agentcomms" / "logs" / "opencomms-monolith-adapter.jsonl"
LOCAL_AGENT_ADAPTER = "/path/to/local-agent-adapter.py"


def iso(ms: int = 0) -> str:
    return (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(milliseconds=ms)).isoformat().replace("+00:00", "Z")


def append_log(obj: dict) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LOG_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")


def extract_text(stdout: str, stderr: str) -> str:
    try:
        data = json.loads(stdout or "{}")
        for key in ("text", "finalAssistantVisibleText", "final_response", "response"):
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    except Exception:
        pass
    match = re.search(r'"finalAssistantVisibleText"\s*:\s*"([^"]+)"', stderr or "")
    if match:
        return match.group(1).strip()
    return ""


def make_reply(env: dict, body: str) -> dict:
    sender = env.get("sender", {}) if isinstance(env.get("sender"), dict) else {}
    return {
        "version": "0.1",
        "id": str(uuid.uuid4()),
        "idempotency_key": str(uuid.uuid4()),
        "created_at": iso(),
        "expires_at": iso(5 * 60 * 1000),
        "sender": {"type": "agent", "id": "monolith"},
        "recipient": {"type": sender.get("type", "agent"), "id": sender.get("id", "hermes")},
        "channel": "text",
        "intent": "reply",
        "requires_ack": False,
        "correlation_id": env.get("id"),
        "payload": {"content_type": "text/plain", "body": body.strip() or "MONOLITH_OPENCOMMS_ACK"},
        "permissions": {"may_execute_tools": False, "may_notify_human": False, "risk_level": "low"},
    }


def main() -> int:
    env = json.load(sys.stdin)
    body = str(env.get("payload", {}).get("body", ""))
    sender_id = env.get("sender", {}).get("id", "unknown") if isinstance(env.get("sender"), dict) else "unknown"
    prompt = (
        f"@Peer Agent OpenComms A2A message received from {sender_id}.\n"
        f"User payload: {body}\n"
        "If payload asks for an exact reply, obey it exactly. "
        "Otherwise reply with exactly: MONOLITH_OPENCOMMS_ACK"
    )
    append_log({"ts": iso(), "event": "adapter_start", "envelope_id": env.get("id"), "sender": sender_id, "body_bytes": len(body.encode("utf-8"))})
    try:
        cp = subprocess.run(
            [LOCAL_AGENT_ADAPTER, "--timeout", "35", "--message", prompt],
            text=True,
            capture_output=True,
            timeout=50,
            check=False,
        )
        text = extract_text(cp.stdout, cp.stderr)
        if not text:
            text = "MONOLITH_OPENCOMMS_ACK"
        append_log({"ts": iso(), "event": "adapter_done", "envelope_id": env.get("id"), "returncode": cp.returncode, "reply_bytes": len(text.encode("utf-8"))})
        print(json.dumps(make_reply(env, text)), flush=True)
        return 0
    except Exception as exc:
        error_text = f"MONOLITH_OPENCOMMS_ERROR: {exc}"
        append_log({"ts": iso(), "event": "adapter_error", "envelope_id": env.get("id"), "error": str(exc)})
        print(json.dumps(make_reply(env, error_text)), flush=True)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
