import { makeEnvelope, type EnvelopeV01 } from "@agentcomms/protocol";
import type { AgentAdapter } from "./adapter.js";

export class EchoAdapter implements AgentAdapter {
  constructor(readonly id = "echo") {}

  async send(env: EnvelopeV01): Promise<EnvelopeV01> {
    return makeEnvelope({
      sender: { type: "agent", id: this.id },
      recipient: env.sender,
      channel: env.channel === "voice" ? "voice" : "text",
      intent: "reply",
      requires_ack: false,
      correlation_id: env.id,
      payload: {
        content_type: env.payload.content_type,
        body: `Echo: ${env.payload.body}`,
        summary: "echo reply",
      },
    });
  }

  async close(): Promise<void> {}
}
