import type { EnvelopeV01 } from "@agentcomms/protocol";

export interface SafeEnvelopeLog {
  id: string;
  intent: EnvelopeV01["intent"];
  correlation_id: string | null;
  sender_id: string;
  recipient_id: string;
  created_at: string;
  risk_level: EnvelopeV01["permissions"]["risk_level"];
}

export function safeEnvelopeLog(env: EnvelopeV01): SafeEnvelopeLog {
  return {
    id: env.id,
    intent: env.intent,
    correlation_id: env.correlation_id,
    sender_id: env.sender.id,
    recipient_id: env.recipient.id,
    created_at: env.created_at,
    risk_level: env.permissions.risk_level,
  };
}

export function logInfo(message: string, details?: unknown): void {
  const rendered = JSON.stringify(details ?? {});
  if (rendered.includes("payload") || rendered.includes("body")) {
    throw new Error("Refusing to log possible payload body");
  }
  console.log(JSON.stringify({ level: "info", message, ...((details as object | undefined) ?? {}) }));
}
