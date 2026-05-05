import { describe, expect, it } from "vitest";
import { buildSendEnvelope } from "../src/send.js";
import { formatTail } from "../src/tail.js";

describe("cli send", () => {
  it("builds valid text envelopes", () => {
    const env = buildSendEnvelope({ to: "echo", text: "hello" });
    expect(env.recipient.id).toBe("echo");
    expect(env.payload.body).toBe("hello");
  });

  it("requires text or file", () => {
    expect(() => buildSendEnvelope({ to: "echo" })).toThrow(/requires/);
  });
});

describe("cli tail", () => {
  it("formats transcript rows", () => {
    expect(
      formatTail([
        {
          stored_at: "2026-01-01T00:00:00.000Z",
          direction: "inbound",
          envelope: { intent: "message", sender_id: "human", recipient_id: "echo" },
          payload_body: "hello",
        },
      ]),
    ).toContain("human -> echo");
  });
});
