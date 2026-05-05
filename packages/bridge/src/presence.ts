import { createHash, type KeyObject } from "node:crypto";
import { importRawPublicKey, signCanonical, verifyCanonical } from "@agentcomms/protocol/node";
import type { ContactRecord } from "./contacts.js";

export const PRESENCE_FRAME_TYPE = "opencomms_a2a_presence_v1" as const;

export type PresenceStatus = "online" | "heartbeat" | "offline";
export type PeerPresenceState = "online" | "stale" | "offline";

export interface PresenceSignature {
  alg: "ed25519";
  kid: string;
  value: string;
}

export interface PresenceFrame {
  type: typeof PRESENCE_FRAME_TYPE;
  agent_id: string;
  status: PresenceStatus;
  sequence: number;
  issued_at: string;
  expires_at: string;
  capabilities?: string[];
  message?: string;
  signature: PresenceSignature;
}

export interface BuildPresenceFrameOptions {
  agentId: string;
  privateKey: KeyObject;
  keyId: string;
  status: PresenceStatus;
  sequence: number;
  issuedAt: string;
  expiresAt: string;
  capabilities?: string[];
  message?: string;
}

export interface VerifyPresenceOptions {
  now?: string | number | Date;
  maxFutureSkewMs?: number;
  minSequenceExclusive?: number;
}

export interface PeerPresence {
  agentId: string;
  sequence: number;
  lastSeenAt: string;
  expiresAt: string;
  state: PeerPresenceState;
  capabilities?: string[];
  message?: string;
}

const PRESENCE_FRAME_KEYS = new Set([
  "type",
  "agent_id",
  "status",
  "sequence",
  "issued_at",
  "expires_at",
  "capabilities",
  "message",
  "signature",
]);
const SIGNATURE_KEYS = new Set(["alg", "kid", "value"]);
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const DEFAULT_MAX_FUTURE_SKEW_MS = 60_000;

function assertPlainRecord(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Invalid ${label}`);
}

function assertSafeOwnDataProperties(
  value: Record<string, unknown>,
  allowed: Set<string>,
  label: string,
): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") throw new Error(`Invalid ${label} symbol field`);
    if (!allowed.has(key)) throw new Error(`Unknown ${label} field(s): ${key}`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) throw new Error(`Invalid ${label}`);
    if (descriptor.get || descriptor.set) throw new Error(`Invalid ${label} accessor field`);
    if (!descriptor.enumerable) throw new Error(`Invalid ${label} non-enumerable field`);
  }
}

function readOwnDataProperty(
  value: Record<string, unknown>,
  key: string,
  label: string,
  required: true,
): unknown;
function readOwnDataProperty(
  value: Record<string, unknown>,
  key: string,
  label: string,
  required?: false,
): unknown | undefined;
function readOwnDataProperty(
  value: Record<string, unknown>,
  key: string,
  label: string,
  required = false,
): unknown | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) {
    if (required) throw new Error(`Missing ${label} field: ${key}`);
    return undefined;
  }
  if (descriptor.get || descriptor.set) throw new Error(`Invalid ${label} accessor field`);
  if (!descriptor.enumerable) throw new Error(`Invalid ${label} non-enumerable field`);
  return descriptor.value;
}

function assertIso(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || Number.isNaN(Date.parse(value))) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function assertAgentId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new Error("Invalid agent_id");
  return value;
}

function assertSequence(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("Invalid sequence");
  }
  return value;
}

function assertStatus(value: unknown): PresenceStatus {
  if (value !== "online" && value !== "heartbeat" && value !== "offline") {
    throw new Error("Invalid status");
  }
  return value;
}

function assertKeyId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new Error("Invalid signature kid");
  return value;
}

function assertCapabilities(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    !value.every((capability) => typeof capability === "string" && capability.length > 0)
  ) {
    throw new Error("Invalid capabilities");
  }
  return [...value];
}

function assertSignature(value: unknown): PresenceSignature {
  assertPlainRecord(value, "signature");
  assertSafeOwnDataProperties(value, SIGNATURE_KEYS, "signature");
  const alg = readOwnDataProperty(value, "alg", "signature", true);
  const rawKid = readOwnDataProperty(value, "kid", "signature", true);
  const rawValue = readOwnDataProperty(value, "value", "signature", true);
  if (alg !== "ed25519") throw new Error("Invalid signature");
  const kid = assertKeyId(rawKid);
  if (typeof rawValue !== "string" || !BASE64URL_PATTERN.test(rawValue))
    throw new Error("Invalid signature value");
  return { alg: "ed25519", kid, value: rawValue };
}

function normalizePresenceFrame(input: unknown): PresenceFrame {
  assertPlainRecord(input, "presence frame");
  assertSafeOwnDataProperties(input, PRESENCE_FRAME_KEYS, "presence frame");
  const type = readOwnDataProperty(input, "type", "presence frame", true);
  const agentId = readOwnDataProperty(input, "agent_id", "presence frame", true);
  const status = readOwnDataProperty(input, "status", "presence frame", true);
  const sequence = readOwnDataProperty(input, "sequence", "presence frame", true);
  const issuedAt = readOwnDataProperty(input, "issued_at", "presence frame", true);
  const expiresAt = readOwnDataProperty(input, "expires_at", "presence frame", true);
  const rawSignature = readOwnDataProperty(input, "signature", "presence frame", true);
  const capabilities = readOwnDataProperty(input, "capabilities", "presence frame");
  const message = readOwnDataProperty(input, "message", "presence frame");
  if (Object.prototype.hasOwnProperty.call(input, "capabilities") && capabilities === undefined) {
    throw new Error("Invalid capabilities");
  }
  if (Object.prototype.hasOwnProperty.call(input, "message") && message === undefined) {
    throw new Error("Invalid message");
  }
  if (type !== PRESENCE_FRAME_TYPE) throw new Error("Invalid presence frame type");
  if (message !== undefined && typeof message !== "string") throw new Error("Invalid message");
  const typedMessage = message as string | undefined;
  const frame: PresenceFrame = {
    type: PRESENCE_FRAME_TYPE,
    agent_id: assertAgentId(agentId),
    status: assertStatus(status),
    sequence: assertSequence(sequence),
    issued_at: assertIso(issuedAt, "issued_at"),
    expires_at: assertIso(expiresAt, "expires_at"),
    signature: assertSignature(rawSignature),
  };
  const typedCapabilities = assertCapabilities(capabilities);
  if (typedCapabilities !== undefined) frame.capabilities = typedCapabilities;
  if (typedMessage !== undefined) frame.message = typedMessage;
  return frame;
}

function signingPayload(frame: Omit<PresenceFrame, "signature">): Omit<PresenceFrame, "signature"> {
  const payload: Omit<PresenceFrame, "signature"> = {
    type: frame.type,
    agent_id: frame.agent_id,
    status: frame.status,
    sequence: frame.sequence,
    issued_at: frame.issued_at,
    expires_at: frame.expires_at,
  };
  if (frame.capabilities !== undefined) payload.capabilities = [...frame.capabilities];
  if (frame.message !== undefined) payload.message = frame.message;
  return payload;
}

function nowMs(value: string | number | Date | undefined): number {
  if (value === undefined) return Date.now();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Invalid now");
    return value;
  }
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("Invalid now");
  return parsed;
}

function maxFutureSkewMs(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_FUTURE_SKEW_MS;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("Invalid maxFutureSkewMs");
  }
  return value;
}

export function buildPresenceFrame(options: BuildPresenceFrameOptions): PresenceFrame {
  const issuedAt = assertIso(options.issuedAt, "issued_at");
  const expiresAt = assertIso(options.expiresAt, "expires_at");
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) throw new Error("Invalid expires_at");
  const capabilities = assertCapabilities(options.capabilities);
  const message = options.message;
  if (message !== undefined && typeof message !== "string") throw new Error("Invalid message");
  const payload = signingPayload({
    type: PRESENCE_FRAME_TYPE,
    agent_id: assertAgentId(options.agentId),
    status: assertStatus(options.status),
    sequence: assertSequence(options.sequence),
    issued_at: issuedAt,
    expires_at: expiresAt,
    ...(capabilities !== undefined ? { capabilities } : {}),
    ...(message !== undefined ? { message } : {}),
  });
  return {
    ...payload,
    signature: {
      alg: "ed25519",
      kid: assertKeyId(options.keyId),
      value: signCanonical(options.privateKey, payload),
    },
  };
}

export function verifyPresenceFrame(
  input: unknown,
  contact: ContactRecord,
  options: VerifyPresenceOptions = {},
): PresenceFrame {
  if (contact.revoked || contact.revoked_at || contact.trust_level === "revoked")
    throw new Error("Contact is revoked");
  const frame = normalizePresenceFrame(input);
  if (frame.agent_id !== contact.agent_id) throw new Error("presence agent_id mismatch");
  if (contact.public_key.alg !== "ed25519") throw new Error("Invalid contact public_key alg");
  if (frame.signature.kid !== contact.public_key.kid) throw new Error("signature kid mismatch");

  const current = nowMs(options.now);
  const maxSkew = maxFutureSkewMs(options.maxFutureSkewMs);
  const issued = Date.parse(frame.issued_at);
  const expires = Date.parse(frame.expires_at);
  if (expires <= issued) throw new Error("Invalid expires_at");
  if (expires <= current) throw new Error("Presence frame expired");
  if (issued - current > maxSkew) {
    throw new Error("Presence frame issued_at is future-skewed");
  }
  if (
    options.minSequenceExclusive !== undefined &&
    frame.sequence <= options.minSequenceExclusive
  ) {
    throw new Error("Presence replay or non-monotonic sequence");
  }

  let publicKey: KeyObject;
  try {
    publicKey = importRawPublicKey(contact.public_key.value);
  } catch {
    throw new Error("Malformed contact public key");
  }
  const payload = signingPayload(frame);
  if (!verifyCanonical(publicKey, payload, frame.signature.value))
    throw new Error("Invalid presence signature");
  return frame;
}

export interface PresenceTrackerOptions {
  staleAfterMs: number;
  offlineAfterMs: number;
  now?: () => number;
}

export class PresenceTracker {
  private readonly peers = new Map<string, PeerPresence>();
  private readonly now: () => number;

  constructor(private readonly options: PresenceTrackerOptions) {
    if (options.staleAfterMs < 0 || options.offlineAfterMs <= options.staleAfterMs) {
      throw new Error("Invalid presence thresholds");
    }
    this.now = options.now ?? Date.now;
  }

  observe(frame: unknown, contact: ContactRecord): PeerPresence {
    const existing = this.peers.get(contact.agent_id);
    const verified = verifyPresenceFrame(frame, contact, {
      now: this.now(),
      minSequenceExclusive: existing?.sequence,
    });
    const lastSeenAt = new Date(this.now()).toISOString();
    const record: PeerPresence = {
      agentId: verified.agent_id,
      sequence: verified.sequence,
      lastSeenAt,
      expiresAt: verified.expires_at,
      state: verified.status === "offline" ? "offline" : "online",
    };
    if (verified.capabilities !== undefined) record.capabilities = [...verified.capabilities];
    if (verified.message !== undefined) record.message = verified.message;
    this.peers.set(verified.agent_id, record);
    return { ...record, capabilities: record.capabilities ? [...record.capabilities] : undefined };
  }

  status(agentId: string, atMs = this.now()): PeerPresenceState {
    const peer = this.peers.get(agentId);
    if (!peer || peer.state === "offline") return "offline";
    const age = atMs - Date.parse(peer.lastSeenAt);
    if (age >= this.options.offlineAfterMs || Date.parse(peer.expiresAt) <= atMs) return "offline";
    if (age >= this.options.staleAfterMs) return "stale";
    return "online";
  }

  get(agentId: string): PeerPresence | undefined {
    const peer = this.peers.get(agentId);
    return peer
      ? {
          ...peer,
          state: this.status(agentId),
          capabilities: peer.capabilities ? [...peer.capabilities] : undefined,
        }
      : undefined;
  }
}

export interface BackoffOptions {
  initialMs: number;
  factor: number;
  maxMs: number;
  jitter?: (delayMs: number, attempt: number) => number;
}

export interface BackoffController {
  next(): number;
  reset(): void;
}

export function createBackoff(options: BackoffOptions): BackoffController {
  if (options.initialMs < 0 || options.factor < 1 || options.maxMs < options.initialMs)
    throw new Error("Invalid backoff options");
  let attempt = 0;
  return {
    next(): number {
      const capped = Math.min(options.maxMs, options.initialMs * options.factor ** attempt);
      const delay = Math.min(
        options.maxMs,
        options.jitter ? options.jitter(capped, attempt) : capped,
      );
      attempt += 1;
      return Math.max(0, Math.round(delay));
    },
    reset(): void {
      attempt = 0;
    },
  };
}

export type AckState = "pending" | "acked" | "dead_letter";

export interface OutboundMessageInput {
  messageId: string;
  correlationId: string;
  peerAgentId: string;
}

export interface AckInput {
  messageId: string;
  correlationId: string;
  fromAgentId: string;
}

export interface OutboundMessageState extends OutboundMessageInput {
  state: AckState;
  attempts: number;
  lastAttemptAt: number;
  ackedAt?: number;
}

export interface AckTrackerOptions {
  ackTimeoutMs: number;
  maxAttempts: number;
  now?: () => number;
}

export interface ObservabilitySnapshotOptions {
  now: number;
  peers: PeerPresence[];
  deliveries: OutboundMessageState[];
  ackTimeoutMs?: number;
  nextBackoffMs?: number;
}

export interface ObservabilitySnapshot {
  generatedAt: string;
  summary: Record<PeerPresenceState, number>;
  peers: Array<Pick<PeerPresence, "agentId" | "sequence" | "lastSeenAt" | "expiresAt" | "state">>;
  delivery: {
    retryQueueCount: number;
    deadLetterCount: number;
    nextRetryInMs: number | null;
    nextBackoffMs: number | null;
    retryQueue: Array<Pick<OutboundMessageState, "messageId" | "correlationId" | "peerAgentId" | "attempts"> & { nextRetryAt: number | null }>;
    deadLetters: Array<Pick<OutboundMessageState, "messageId" | "correlationId" | "peerAgentId" | "attempts" | "lastAttemptAt">>;
    lastAck: Pick<OutboundMessageState, "messageId" | "correlationId" | "peerAgentId" | "ackedAt"> | null;
  };
}

function finiteNumber(value: number | undefined, label: string, fallback?: number): number {
  if (value === undefined) {
    if (fallback === undefined) throw new Error(`Invalid ${label}`);
    return fallback;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`Invalid ${label}`);
  return value;
}

const UNSAFE_OBSERVABILITY_IDENTIFIER_PATTERN =
  /bearer\s+\S+|token\s*[=:]\s*\S+|private[_ -]?key|-----BEGIN [^-]*PRIVATE KEY-----|\b(transcript|private|secret)\b\s*:?\s*.+/i;

function redactObservabilityIdentifier(value: string, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Invalid ${label}`);
  if (!UNSAFE_OBSERVABILITY_IDENTIFIER_PATTERN.test(value)) return value;
  const digest = createHash("sha256").update(`${label}:${value}`).digest("hex").slice(0, 12);
  return `redacted:${digest}`;
}

export function createObservabilitySnapshot(options: ObservabilitySnapshotOptions): ObservabilitySnapshot {
  const current = finiteNumber(options.now, "now");
  const ackTimeout = finiteNumber(options.ackTimeoutMs, "ackTimeoutMs", 0);
  const nextBackoffMs = options.nextBackoffMs === undefined ? null : finiteNumber(options.nextBackoffMs, "nextBackoffMs");
  const summary: Record<PeerPresenceState, number> = { online: 0, stale: 0, offline: 0 };
  const peers = options.peers.map((peer) => {
    if (peer.state !== "online" && peer.state !== "stale" && peer.state !== "offline") throw new Error("Invalid peer state");
    if (!Number.isSafeInteger(peer.sequence) || peer.sequence < 0) throw new Error("Invalid peer sequence");
    if (Number.isNaN(Date.parse(peer.lastSeenAt))) throw new Error("Invalid lastSeenAt");
    if (Number.isNaN(Date.parse(peer.expiresAt))) throw new Error("Invalid expiresAt");
    summary[peer.state] += 1;
    return {
      agentId: redactObservabilityIdentifier(peer.agentId, "peer agentId"),
      sequence: peer.sequence,
      lastSeenAt: peer.lastSeenAt,
      expiresAt: peer.expiresAt,
      state: peer.state,
    };
  });
  const deliveryStates = options.deliveries.map((delivery) => {
    finiteNumber(delivery.lastAttemptAt, "lastAttemptAt");
    if (delivery.ackedAt !== undefined) finiteNumber(delivery.ackedAt, "ackedAt");
    if (!Number.isSafeInteger(delivery.attempts) || delivery.attempts < 0) throw new Error("Invalid attempts");
    return delivery;
  });
  const pending = deliveryStates.filter((delivery) => delivery.state === "pending");
  const retryQueue = pending
    .map((delivery) => ({
      messageId: redactObservabilityIdentifier(delivery.messageId, "delivery messageId"),
      correlationId: redactObservabilityIdentifier(delivery.correlationId, "delivery correlationId"),
      peerAgentId: redactObservabilityIdentifier(delivery.peerAgentId, "delivery peerAgentId"),
      attempts: delivery.attempts,
      nextRetryAt: ackTimeout > 0 ? delivery.lastAttemptAt + ackTimeout : null,
    }))
    .filter((delivery) => delivery.nextRetryAt !== null && delivery.nextRetryAt <= current + ackTimeout);
  const nextRetryAt = retryQueue.reduce<number | null>((min, delivery) => {
    if (delivery.nextRetryAt === null) return min;
    return min === null ? delivery.nextRetryAt : Math.min(min, delivery.nextRetryAt);
  }, null);
  const deadLetters = deliveryStates
    .filter((delivery) => delivery.state === "dead_letter")
    .map((delivery) => ({
      messageId: redactObservabilityIdentifier(delivery.messageId, "delivery messageId"),
      correlationId: redactObservabilityIdentifier(delivery.correlationId, "delivery correlationId"),
      peerAgentId: redactObservabilityIdentifier(delivery.peerAgentId, "delivery peerAgentId"),
      attempts: delivery.attempts,
      lastAttemptAt: delivery.lastAttemptAt,
    }));
  const lastAcked = deliveryStates
    .filter((delivery): delivery is OutboundMessageState & { ackedAt: number } => delivery.state === "acked" && delivery.ackedAt !== undefined)
    .sort((a, b) => b.ackedAt - a.ackedAt)[0];
  return {
    generatedAt: new Date(current).toISOString(),
    summary,
    peers,
    delivery: {
      retryQueueCount: retryQueue.length,
      deadLetterCount: deadLetters.length,
      nextRetryInMs: nextRetryAt === null ? null : Math.max(0, nextRetryAt - current),
      nextBackoffMs,
      retryQueue,
      deadLetters,
      lastAck: lastAcked
        ? {
            messageId: redactObservabilityIdentifier(lastAcked.messageId, "delivery messageId"),
            correlationId: redactObservabilityIdentifier(lastAcked.correlationId, "delivery correlationId"),
            peerAgentId: redactObservabilityIdentifier(lastAcked.peerAgentId, "delivery peerAgentId"),
            ackedAt: lastAcked.ackedAt,
          }
        : null,
    },
  };
}

export class AckTracker {
  private readonly messages = new Map<string, OutboundMessageState>();
  private readonly now: () => number;

  constructor(private readonly options: AckTrackerOptions) {
    if (options.ackTimeoutMs < 0 || options.maxAttempts < 1)
      throw new Error("Invalid ACK tracker options");
    this.now = options.now ?? Date.now;
  }

  track(input: OutboundMessageInput): OutboundMessageState | false {
    if (!input.messageId || !input.correlationId || !input.peerAgentId)
      throw new Error("Invalid outbound message");
    if (this.messages.has(input.messageId)) return false;
    const state: OutboundMessageState = {
      ...input,
      state: "pending",
      attempts: 1,
      lastAttemptAt: this.now(),
    };
    this.messages.set(input.messageId, state);
    return { ...state };
  }

  ack(input: AckInput): OutboundMessageState | false {
    const state = this.messages.get(input.messageId);
    if (!state) throw new Error("Unknown message ACK");
    if (state.state !== "pending") return false;
    if (state.correlationId !== input.correlationId) throw new Error("ACK correlation mismatch");
    if (state.peerAgentId !== input.fromAgentId) throw new Error("ACK from wrong peer");
    state.state = "acked";
    state.ackedAt = this.now();
    return { ...state };
  }

  retryable(atMs = this.now()): OutboundMessageState[] {
    return [...this.messages.values()]
      .filter(
        (state) =>
          state.state === "pending" && atMs - state.lastAttemptAt >= this.options.ackTimeoutMs,
      )
      .map((state) => ({ ...state }));
  }

  markAttempt(messageId: string, atMs = this.now()): OutboundMessageState {
    const state = this.messages.get(messageId);
    if (!state) throw new Error("Unknown outbound message");
    if (state.state !== "pending") return { ...state };
    state.attempts += 1;
    state.lastAttemptAt = atMs;
    if (state.attempts >= this.options.maxAttempts) state.state = "dead_letter";
    return { ...state };
  }

  deadLetters(): OutboundMessageState[] {
    return [...this.messages.values()]
      .filter((state) => state.state === "dead_letter")
      .map((state) => ({ ...state }));
  }

  get(messageId: string): OutboundMessageState | undefined {
    const state = this.messages.get(messageId);
    return state ? { ...state } : undefined;
  }
}
