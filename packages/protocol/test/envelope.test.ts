import { describe, expect, it } from "vitest";
import {
  EnvelopeV01,
  jsonBody,
  makeEnvelope,
  parseJsonBody,
  validateEnvelope,
} from "../src/index.js";

describe("envelope v0.1", () => {
  it("accepts the spec shape", () => {
    const env = makeEnvelope({
      sender: { type: "human", id: "user:baja", device_id: "mac" },
      recipient: { type: "agent", id: "echo" },
      channel: "text",
      intent: "message",
      requires_ack: true,
      correlation_id: null,
      payload: { content_type: "text/plain", body: "hello" },
    });

    expect(validateEnvelope(env).version).toBe("0.1");
    expect(env.permissions.may_execute_tools).toBe(false);
  });

  it("accepts a system register envelope", () => {
    const body = jsonBody({ kind: "register", as: { type: "human", id: "user:baja" } });
    const env = makeEnvelope({
      sender: { type: "human", id: "user:baja", device_id: "browser" },
      recipient: { type: "service", id: "bridge" },
      channel: "system",
      intent: "system",
      requires_ack: false,
      correlation_id: null,
      payload: { content_type: "application/json", body },
    });

    expect(parseJsonBody<{ kind: string }>(env.payload.body).kind).toBe("register");
  });

  it("rejects raw object payload bodies", () => {
    const env = makeEnvelope({
      sender: { type: "human", id: "user:baja" },
      recipient: { type: "agent", id: "echo" },
      channel: "text",
      intent: "message",
      requires_ack: true,
      correlation_id: null,
      payload: { content_type: "text/plain", body: "hello" },
    }) as unknown as { payload: { body: unknown } };
    env.payload.body = { text: "hello" };

    expect(() => validateEnvelope(env)).toThrow(/Invalid AgentComms envelope/);
  });

  it("rejects missing required fields", () => {
    expect(() => validateEnvelope({ version: "0.1" })).toThrow(/Invalid AgentComms envelope/);
  });

  it("rejects version mismatches", () => {
    const env = makeEnvelope({
      sender: { type: "human", id: "user:baja" },
      recipient: { type: "agent", id: "echo" },
      channel: "text",
      intent: "message",
      requires_ack: true,
      correlation_id: null,
      payload: { content_type: "text/plain", body: "hello" },
    }) as EnvelopeV01 & { version: string };
    env.version = "0.2";

    expect(() => validateEnvelope(env)).toThrow(/Invalid AgentComms envelope/);
  });

  it("rejects expired envelopes", () => {
    const expired = {
      ...makeEnvelope({
        sender: { type: "human", id: "user:baja" },
        recipient: { type: "agent", id: "echo" },
        channel: "text",
        intent: "message",
        requires_ack: true,
        correlation_id: null,
        payload: { content_type: "text/plain", body: "hello" },
      }),
      expires_at: new Date(Date.now() - 1000).toISOString(),
    };

    expect(() => validateEnvelope(expired)).toThrow(/Envelope expired/);
  });
});
