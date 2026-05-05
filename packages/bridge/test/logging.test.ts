import { makeEnvelope } from "@agentcomms/protocol";
import { describe, expect, it } from "vitest";
import { logInfo, safeEnvelopeLog } from "../src/logging.js";

describe("logging", () => {
  it("redacts payload body from safe envelope logs", () => {
    const env = makeEnvelope({
      sender: { type: "human", id: "user:baja" },
      recipient: { type: "agent", id: "echo" },
      channel: "text",
      intent: "message",
      requires_ack: true,
      correlation_id: null,
      payload: { content_type: "text/plain", body: "do-not-log-me" },
    });

    expect(JSON.stringify(safeEnvelopeLog(env))).not.toContain("do-not-log-me");
  });

  it("refuses suspicious log details", () => {
    expect(() => logInfo("bad", { payload: { body: "secret" } })).toThrow(/Refusing/);
  });
});
