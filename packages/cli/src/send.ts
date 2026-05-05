import { readFileSync } from "node:fs";
import { makeEnvelope, type EnvelopeV01 } from "@agentcomms/protocol";
import type { CliConfig } from "./config.js";

export interface SendOptions {
  to: string;
  text?: string;
  file?: string;
  from?: string;
}

export function buildSendEnvelope(options: SendOptions): EnvelopeV01 {
  const body =
    options.text ??
    (options.file ? readFileSync(options.file === "-" ? 0 : options.file, "utf8") : undefined);
  if (!body) {
    throw new Error("send requires --text or --file");
  }
  return makeEnvelope({
    sender: { type: "human", id: options.from ?? "user:baja", device_id: "cli" },
    recipient: { type: "agent", id: options.to },
    channel: "text",
    intent: "message",
    requires_ack: true,
    correlation_id: null,
    payload: { content_type: "text/plain", body },
  });
}

export async function sendEnvelope(config: CliConfig, envelope: EnvelopeV01): Promise<unknown> {
  const res = await fetch(`${config.bridge_url}/v0/send`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(envelope),
  });
  const body = (await res.json()) as unknown;
  if (!res.ok) {
    throw new Error(JSON.stringify(body));
  }
  return body;
}
