import { z } from "zod";
import { ProtocolError } from "./errors.js";
import { newId, newIdempotencyKey } from "./ids.js";
import { expiresIn, isoNow, isExpired } from "./ttl.js";

export const participantTypeSchema = z.enum(["human", "agent", "service"]);
export const channelSchema = z.enum(["voice", "text", "system"]);
export const intentSchema = z.enum([
  "message",
  "ack",
  "reply",
  "escalation",
  "status",
  "command_request",
  "system",
]);
export const contentTypeSchema = z.enum(["text/plain", "audio/opus", "application/json"]);
export const riskLevelSchema = z.enum(["low", "medium", "high"]);

export const envelopeSchema = z
  .object({
    version: z.literal("0.1"),
    id: z.string().uuid(),
    idempotency_key: z.string().min(1),
    created_at: z.string().datetime(),
    expires_at: z.string().datetime(),
    sender: z.object({
      type: participantTypeSchema,
      id: z.string().min(1),
      device_id: z.string().min(1).optional(),
    }),
    recipient: z.object({
      type: participantTypeSchema,
      id: z.string().min(1),
    }),
    channel: channelSchema,
    intent: intentSchema,
    requires_ack: z.boolean(),
    correlation_id: z.string().uuid().nullable(),
    payload: z.object({
      content_type: contentTypeSchema,
      body: z.string(),
      summary: z.string().optional(),
    }),
    permissions: z.object({
      may_execute_tools: z.boolean(),
      may_notify_human: z.boolean(),
      risk_level: riskLevelSchema,
    }),
  })
  .strict();

export type EnvelopeV01 = z.infer<typeof envelopeSchema>;

export type EnvelopeInput = Omit<
  EnvelopeV01,
  "version" | "id" | "idempotency_key" | "created_at" | "expires_at" | "permissions"
> &
  Partial<Pick<EnvelopeV01, "id" | "idempotency_key" | "created_at" | "expires_at">> & {
    permissions?: Partial<EnvelopeV01["permissions"]>;
    ttlMs?: number;
  };

export function makeEnvelope(input: EnvelopeInput): EnvelopeV01 {
  const createdAt = input.created_at ?? isoNow();
  const envelope = {
    version: "0.1" as const,
    id: input.id ?? newId(),
    idempotency_key: input.idempotency_key ?? newIdempotencyKey(),
    created_at: createdAt,
    expires_at: input.expires_at ?? expiresIn(input.ttlMs, new Date(createdAt)),
    sender: input.sender,
    recipient: input.recipient,
    channel: input.channel,
    intent: input.intent,
    requires_ack: input.requires_ack,
    correlation_id: input.correlation_id,
    payload: input.payload,
    permissions: {
      may_execute_tools: input.permissions?.may_execute_tools ?? false,
      may_notify_human: input.permissions?.may_notify_human ?? true,
      risk_level: input.permissions?.risk_level ?? "low",
    },
  };
  return validateEnvelope(envelope);
}

export function validateEnvelope(value: unknown): EnvelopeV01 {
  const parsed = envelopeSchema.safeParse(value);
  if (!parsed.success) {
    throw new ProtocolError(
      "Invalid AgentComms envelope",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  if (isExpired(parsed.data.expires_at)) {
    throw new ProtocolError("Envelope expired", ["expires_at is in the past"]);
  }
  return parsed.data;
}

export function validateEnvelopeShape(value: unknown): EnvelopeV01 {
  const parsed = envelopeSchema.safeParse(value);
  if (!parsed.success) {
    throw new ProtocolError(
      "Invalid AgentComms envelope",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  return parsed.data;
}

export function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}

export function parseJsonBody<T>(body: string): T {
  return JSON.parse(body) as T;
}
