import { makeEnvelope } from "@agentcomms/protocol";
import { describe, expect, it } from "vitest";
import { EchoAdapter } from "../src/adapters/echo.js";

describe("EchoAdapter", () => {
  it("round-trips a message with correlation id", async () => {
    const env = makeEnvelope({
      sender: { type: "human", id: "user:baja" },
      recipient: { type: "agent", id: "echo" },
      channel: "text",
      intent: "message",
      requires_ack: true,
      correlation_id: null,
      payload: { content_type: "text/plain", body: "hello" },
    });

    const reply = await new EchoAdapter().send(env);

    expect(reply.intent).toBe("reply");
    expect(reply.correlation_id).toBe(env.id);
    expect(reply.payload.body).toBe("Echo: hello");
  });
});
