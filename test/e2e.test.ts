import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeEnvelope } from "../packages/protocol/src/index.js";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { type BridgeRuntime, startBridge } from "../packages/bridge/src/server.js";

let runtime: BridgeRuntime | null = null;

afterEach(async () => {
  await runtime?.close();
  runtime = null;
});

describe("typed browser/PWA vertical slice", () => {
  it("sends typed text over WebSocket to echo and stores transcript rows", async () => {
    const transcript_path = join(mkdtempSync(join(tmpdir(), "agentcomms-e2e-")), "transcripts.jsonl");
    runtime = await startBridge({
      bind: "127.0.0.1",
      port: 0,
      token: "test-token",
      transcript_path,
      transcripts_enabled: true,
      allow_lan: false,
      adapters: { echo: { kind: "echo" } },
    });

    const wsUrl = runtime.url.replace("http://", "ws://");
    const socket = new WebSocket(`${wsUrl}/ws?token=test-token`);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });

    const replyPromise = new Promise<string>((resolve, reject) => {
      socket.on("message", (data) => {
        const parsed = JSON.parse(data.toString()) as { payload?: { body?: string } };
        if (parsed.payload?.body) resolve(parsed.payload.body);
      });
      socket.once("error", reject);
    });

    socket.send(
      JSON.stringify(
        makeEnvelope({
          sender: { type: "human", id: "user:baja", device_id: "browser" },
          recipient: { type: "agent", id: "echo" },
          channel: "text",
          intent: "message",
          requires_ack: true,
          correlation_id: null,
          payload: { content_type: "text/plain", body: "hello from browser" },
        }),
      ),
    );

    await expect(replyPromise).resolves.toBe("Echo: hello from browser");
    expect(runtime.router.recipients()).toContain("echo");
    const tail = await fetch(`${runtime.url}/v0/transcripts`, {
      headers: { authorization: "Bearer test-token" },
    });
    const body = (await tail.json()) as { rows: unknown[] };
    expect(body.rows).toHaveLength(2);
    socket.close();
  });
});
