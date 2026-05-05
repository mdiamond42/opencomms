import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeEnvelope } from "@agentcomms/protocol";
import { describe, expect, it } from "vitest";
import { EchoAdapter } from "../src/adapters/echo.js";
import { Router } from "../src/router.js";
import { TranscriptStore } from "../src/store/transcripts.js";

function message(to = "echo", key = "same-key") {
  return makeEnvelope({
    idempotency_key: key,
    sender: { type: "human", id: "user:baja" },
    recipient: { type: "agent", id: to },
    channel: "text",
    intent: "message",
    requires_ack: true,
    correlation_id: null,
    payload: { content_type: "text/plain", body: "secret body" },
  });
}

describe("router", () => {
  it("routes by recipient id and writes transcripts", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "agentcomms-")), "transcripts.jsonl");
    const store = new TranscriptStore(path, true);
    const router = new Router(store);
    router.register(new EchoAdapter("echo"));

    const result = await router.route(message());

    expect(result.status).toBe("delivered");
    expect(result.reply?.correlation_id).toBeTruthy();
    expect(store.list()).toHaveLength(2);
  });

  it("throws for unknown recipients", async () => {
    const router = new Router(new TranscriptStore("/tmp/unused.jsonl", false));
    await expect(router.route(message("missing"))).rejects.toThrow(/Unknown recipient/);
  });

  it("deduplicates idempotency keys", async () => {
    const router = new Router(new TranscriptStore("/tmp/unused.jsonl", false));
    router.register(new EchoAdapter("echo"));
    expect((await router.route(message("echo", "dupe"))).status).toBe("delivered");
    expect((await router.route(message("echo", "dupe"))).status).toBe("duplicate");
  });
});
