import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeEnvelope } from "@agentcomms/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { type BridgeRuntime, startBridge } from "../src/server.js";

let runtime: BridgeRuntime | null = null;

afterEach(async () => {
  await runtime?.close();
  runtime = null;
});

describe("bridge server", () => {
  it("POST /v0/send returns an echo reply", async () => {
    const transcript_path = join(mkdtempSync(join(tmpdir(), "agentcomms-")), "transcripts.jsonl");
    runtime = await startBridge({
      bind: "127.0.0.1",
      port: 0,
      token: "test-token",
      transcript_path,
      transcripts_enabled: true,
      allow_lan: false,
      adapters: { echo: { kind: "echo" } },
    });

    const res = await fetch(`${runtime.url}/v0/send`, {
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify(
        makeEnvelope({
          sender: { type: "human", id: "user:baja" },
          recipient: { type: "agent", id: "echo" },
          channel: "text",
          intent: "message",
          requires_ack: true,
          correlation_id: null,
          payload: { content_type: "text/plain", body: "secret text" },
        }),
      ),
    });
    const body = (await res.json()) as { status: string; reply: { payload: { body: string } } };

    expect(res.status).toBe(200);
    expect(body.status).toBe("delivered");
    expect(body.reply.payload.body).toBe("Echo: secret text");
  });
});
