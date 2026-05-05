import { describe, expect, it } from "vitest";
import { expiresIn, isExpired, makeEnvelope, newIdempotencyKey } from "../src/index.js";

describe("ttl helpers", () => {
  it("sets a default expiry in the future", () => {
    const env = makeEnvelope({
      sender: { type: "human", id: "user:baja" },
      recipient: { type: "agent", id: "echo" },
      channel: "text",
      intent: "message",
      requires_ack: true,
      correlation_id: null,
      payload: { content_type: "text/plain", body: "hello" },
    });

    expect(Date.parse(env.expires_at)).toBeGreaterThan(Date.parse(env.created_at));
  });

  it("detects expiry", () => {
    const base = new Date("2026-01-01T00:00:00.000Z");
    expect(isExpired(expiresIn(1000, base), new Date(base.getTime() + 999))).toBe(false);
    expect(isExpired(expiresIn(1000, base), new Date(base.getTime() + 1000))).toBe(true);
  });

  it("creates idempotency keys", () => {
    expect(newIdempotencyKey()).toMatch(/^idem_/);
  });
});
