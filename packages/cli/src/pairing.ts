import { createHash, createPrivateKey } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  ContactRecord,
  ContactStore,
  defaultContactsPath,
  TrustLevel,
} from "@agentcomms/bridge/contacts";
import { importRawPublicKey, signCanonical, verifyCanonical } from "@agentcomms/protocol/node";

export interface AgentCardV1 {
  type: "opencomms_agent_card_v1";
  agent_id: string;
  display_name: string;
  kind: "agent";
  relay_url: string;
  pairing_endpoint?: string;
  public_key: { alg: "ed25519"; kid: string; value: string };
  capabilities: string[];
  issued_at: string;
  expires_at?: string;
  signature?: string;
}

export type SignedAgentCardV1 = AgentCardV1 & { signature: string };

export interface HumanCardV1 {
  type: "opencomms_human_card_v1";
  human_id: string;
  display_name: string;
  kind: "human";
  relay_url: string;
  public_key: { alg: "ed25519"; kid: string; value: string };
  capabilities: string[];
  issued_at: string;
  expires_at?: string;
  signature?: string;
}

export type SignedHumanCardV1 = HumanCardV1 & { signature: string };

export type PairingInviteMode = "human_to_human" | "own_agent" | "friend_project_agents";
export interface PairingInviteParty { id: string; kind: "human" | "agent"; display_name: string }

export interface PairingInviteV1 {
  type: "opencomms_pairing_invite_v1";
  invite_id: string;
  mode: PairingInviteMode;
  issuer: PairingInviteParty;
  subject: PairingInviteParty;
  relay_url: string;
  public_key: { alg: "ed25519"; kid: string; value: string };
  capabilities: string[];
  project_id?: string | null;
  project_name?: string | null;
  agent_ids?: string[] | null;
  issued_at: string;
  expires_at: string;
  nonce: string;
  safety_code?: string;
  signature?: string;
}

export type SignedPairingInviteV1 = PairingInviteV1 & { signature: string };

export interface BuildAgentCardOptions {
  agentId: string;
  displayName: string;
  relayUrl: string;
  pairingEndpoint?: string;
  publicKey: { alg: "ed25519"; kid: string; value: string };
  capabilities?: string[];
  issuedAt?: string;
  expiresAt?: string;
}

export interface BuildHumanCardOptions {
  humanId: string;
  displayName: string;
  relayUrl: string;
  publicKey: { alg: "ed25519"; kid: string; value: string };
  capabilities?: string[];
  issuedAt?: string;
  expiresAt?: string;
}

export interface BuildPairingInviteOptions {
  inviteId: string;
  mode: PairingInviteMode;
  issuer: PairingInviteParty;
  subject: PairingInviteParty;
  relayUrl: string;
  publicKey: { alg: "ed25519"; kid: string; value: string };
  capabilities?: string[];
  projectId?: string | null;
  projectName?: string | null;
  agentIds?: string[] | null;
  issuedAt?: string;
  expiresAt: string;
  nonce: string;
  safetyCode?: string;
}

export interface PairRequestV1 {
  type: "opencomms_pair_request_v1";
  card: SignedAgentCardV1;
  nonce: string;
  requested_at: string;
  requested_capabilities: string[];
}

export interface BuildPairRequestOptions {
  card: SignedAgentCardV1;
  nonce: string;
  requestedAt?: string;
  requestedCapabilities?: string[];
}

export interface BuildContactOptions {
  pairingId: string;
  grantedCapabilities: string[];
  trustLevel: Exclude<TrustLevel, "revoked">;
  now?: string;
}

const SAFE_CAPABILITIES = new Set(["chat", "status", "task_handoff", "memory_reference_request"]);
const TRUST_LEVELS = new Set(["local_admin_approved", "paired", "verified"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function parseCsv(value: string | undefined, fallback: string[] = []): string[] {
  return value === undefined ? fallback : uniqueSorted(value.split(","));
}

function requireValue(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  if (index < 0 || !args[index + 1]) throw new Error(`Missing ${flag}`);
  return args[index + 1]!;
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function assertSafeCapabilities(capabilities: string[]): void {
  const unknown = capabilities.filter((capability) => !SAFE_CAPABILITIES.has(capability));
  if (unknown.length > 0)
    throw new Error(`Unknown or restricted capabilities: ${unknown.join(",")}`);
}

function assertCanonicalCapabilities(capabilities: string[]): void {
  const canonical = uniqueSorted(capabilities);
  if (
    capabilities.length !== canonical.length ||
    capabilities.some((capability, index) => capability !== canonical[index])
  )
    throw new Error("Invalid capabilities: must be canonical sorted and deduplicated");
}

export function buildAgentCard(options: BuildAgentCardOptions): AgentCardV1 {
  const capabilities = uniqueSorted(options.capabilities ?? ["chat", "status"]);
  assertSafeCapabilities(capabilities);
  const card: AgentCardV1 = {
    type: "opencomms_agent_card_v1",
    agent_id: options.agentId,
    display_name: options.displayName,
    kind: "agent",
    relay_url: options.relayUrl,
    public_key: { ...options.publicKey },
    capabilities,
    issued_at: options.issuedAt ?? new Date().toISOString(),
  };
  if (options.pairingEndpoint) card.pairing_endpoint = options.pairingEndpoint;
  if (options.expiresAt) card.expires_at = options.expiresAt;
  return card;
}

export function signedAgentCardPayload(card: AgentCardV1): Omit<AgentCardV1, "signature"> {
  const payload: AgentCardV1 = { ...card };
  delete payload.signature;
  return payload;
}

export function buildHumanCard(options: BuildHumanCardOptions): HumanCardV1 {
  const capabilities = uniqueSorted(options.capabilities ?? ["chat", "status"]);
  assertSafeCapabilities(capabilities);
  return {
    type: "opencomms_human_card_v1",
    human_id: options.humanId,
    display_name: options.displayName,
    kind: "human",
    relay_url: options.relayUrl,
    public_key: { ...options.publicKey },
    capabilities,
    issued_at: options.issuedAt ?? new Date().toISOString(),
    ...(options.expiresAt ? { expires_at: options.expiresAt } : {}),
  };
}

export function signedHumanCardPayload(card: HumanCardV1): Omit<HumanCardV1, "signature"> {
  const payload: HumanCardV1 = { ...card };
  delete payload.signature;
  return payload;
}

export function signHumanCard(card: HumanCardV1, privateKey: KeyObject): SignedHumanCardV1 {
  return validateHumanCard({ ...card, signature: signCanonical(privateKey, signedHumanCardPayload(card)) });
}

function validatePublicKey(publicKeyInput: unknown): { alg: "ed25519"; kid: string; value: string; key: KeyObject } {
  if (!publicKeyInput || typeof publicKeyInput !== "object" || Array.isArray(publicKeyInput))
    throw new Error("Invalid public_key");
  const publicKey = publicKeyInput as { alg?: unknown; kid?: unknown; value?: unknown };
  assertOnlyKeys(publicKeyInput as Record<string, unknown>, new Set(["alg", "kid", "value"]), "public_key");
  if (publicKey.alg !== "ed25519" || typeof publicKey.kid !== "string" || publicKey.kid.length === 0 || typeof publicKey.value !== "string" || publicKey.value.length === 0) throw new Error("Invalid public_key");
  let key: KeyObject;
  try { key = importRawPublicKey(publicKey.value); } catch { throw new Error("Invalid public_key"); }
  return { alg: "ed25519", kid: publicKey.kid, value: publicKey.value, key };
}

export function validateHumanCard(card: unknown): SignedHumanCardV1 {
  if (!card || typeof card !== "object" || Array.isArray(card)) throw new Error("Invalid human card");
  const raw = card as Record<string, unknown>;
  assertOnlyKeys(raw, new Set(["type", "human_id", "display_name", "kind", "relay_url", "public_key", "capabilities", "issued_at", "expires_at", "signature"]), "human card");
  const candidate = card as HumanCardV1;
  if (candidate.type !== "opencomms_human_card_v1") throw new Error("Invalid human card type");
  if (candidate.kind !== "human") throw new Error("Invalid human card kind");
  for (const field of ["human_id", "display_name", "relay_url", "issued_at"] as const) if (typeof candidate[field] !== "string" || candidate[field].length === 0) throw new Error(`Invalid ${field}`);
  try { new URL(candidate.relay_url); } catch { throw new Error("Invalid relay_url"); }
  const publicKey = validatePublicKey(candidate.public_key);
  if (!Array.isArray(candidate.capabilities) || candidate.capabilities.some((capability) => typeof capability !== "string")) throw new Error("Invalid capabilities");
  assertSafeCapabilities(candidate.capabilities); assertCanonicalCapabilities(candidate.capabilities);
  if (Number.isNaN(Date.parse(candidate.issued_at))) throw new Error("Invalid issued_at");
  if (candidate.expires_at !== undefined && (typeof candidate.expires_at !== "string" || Number.isNaN(Date.parse(candidate.expires_at)))) throw new Error("Invalid expires_at");
  if (typeof candidate.signature !== "string" || candidate.signature.length === 0) throw new Error("Invalid signature");
  if (!verifyCanonical(publicKey.key, signedHumanCardPayload(candidate), candidate.signature)) throw new Error("Invalid signature");
  return { ...buildHumanCard({ humanId: candidate.human_id, displayName: candidate.display_name, relayUrl: candidate.relay_url, publicKey: { alg: publicKey.alg, kid: publicKey.kid, value: publicKey.value }, capabilities: candidate.capabilities, issuedAt: candidate.issued_at, expiresAt: candidate.expires_at }), signature: candidate.signature };
}

export function buildPairingInvite(options: BuildPairingInviteOptions): PairingInviteV1 {
  const capabilities = uniqueSorted(options.capabilities ?? ["chat", "status"]);
  assertSafeCapabilities(capabilities);
  if (!options.inviteId) throw new Error("Invalid invite_id");
  if (!options.nonce) throw new Error("Invalid nonce");
  if (Number.isNaN(Date.parse(options.expiresAt))) throw new Error("Invalid expires_at");
  if (options.mode === "human_to_human") {
    if (options.subject.kind !== "human") throw new Error("human_to_human subject must be human");
    if (options.projectId !== undefined && options.projectId !== null) throw new Error("human_to_human invite must not include non-null project_id");
    if (options.projectName !== undefined && options.projectName !== null) throw new Error("human_to_human invite must not include non-null project_name");
    if (options.agentIds !== undefined && options.agentIds !== null) throw new Error("human_to_human invite must not include non-null agent_ids");
  }
  if (options.mode === "own_agent") {
    if (options.subject.kind !== "agent") throw new Error("own_agent subject must be agent");
    if (options.projectId !== undefined && options.projectId !== null) throw new Error("own_agent invite must not include non-null project_id");
    if (options.projectName !== undefined && options.projectName !== null) throw new Error("own_agent invite must not include non-null project_name");
    if (options.agentIds !== undefined && options.agentIds !== null) throw new Error("own_agent invite must not include non-null agent_ids");
  }
  if (options.mode === "friend_project_agents") {
    if (!options.projectId || !options.projectName) throw new Error("friend_project_agents requires project_id and project_name");
    if (!options.agentIds || options.agentIds.length === 0) throw new Error("friend_project_agents requires nonempty agent_ids");
  }
  const invite: PairingInviteV1 = {
    type: "opencomms_pairing_invite_v1",
    invite_id: options.inviteId,
    mode: options.mode,
    issuer: { ...options.issuer },
    subject: { ...options.subject },
    relay_url: options.relayUrl,
    public_key: { ...options.publicKey },
    capabilities,
    issued_at: options.issuedAt ?? new Date().toISOString(),
    expires_at: options.expiresAt,
    nonce: options.nonce,
  };
  if (options.projectId !== undefined) invite.project_id = options.projectId;
  if (options.projectName !== undefined) invite.project_name = options.projectName;
  if (options.agentIds !== undefined) invite.agent_ids = options.agentIds === null ? null : uniqueSorted(options.agentIds);
  if (options.safetyCode) invite.safety_code = options.safetyCode;
  return invite;
}

export function signedPairingInvitePayload(invite: PairingInviteV1): Omit<PairingInviteV1, "signature"> {
  const payload: PairingInviteV1 = { ...invite };
  delete payload.signature;
  return payload;
}

export function signPairingInvite(invite: PairingInviteV1, privateKey: KeyObject): SignedPairingInviteV1 {
  return validatePairingInvite({ ...invite, signature: signCanonical(privateKey, signedPairingInvitePayload(invite)) }, { now: invite.issued_at });
}

function validateInviteParty(value: unknown, label: string): PairingInviteParty {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  assertOnlyKeys(value as Record<string, unknown>, new Set(["id", "kind", "display_name"]), label);
  const party = value as PairingInviteParty;
  if (typeof party.id !== "string" || !party.id || typeof party.display_name !== "string" || !party.display_name || !["human", "agent"].includes(party.kind)) throw new Error(`Invalid ${label}`);
  return { id: party.id, kind: party.kind, display_name: party.display_name };
}

export function validatePairingInvite(input: unknown, options: PairingSummaryOptions = {}): SignedPairingInviteV1 {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid pairing invite");
  const raw = input as Record<string, unknown>;
  assertOnlyKeys(raw, new Set(["type", "invite_id", "mode", "issuer", "subject", "relay_url", "public_key", "capabilities", "project_id", "project_name", "agent_ids", "issued_at", "expires_at", "nonce", "safety_code", "signature"]), "pairing invite");
  const candidate = input as PairingInviteV1;
  if (candidate.type !== "opencomms_pairing_invite_v1") throw new Error("Invalid pairing invite type");
  if (!["human_to_human", "own_agent", "friend_project_agents"].includes(candidate.mode)) throw new Error("Invalid pairing invite mode");
  const issuer = validateInviteParty(candidate.issuer, "issuer");
  if (issuer.kind !== "human") throw new Error("Invalid issuer.kind");
  const subject = validateInviteParty(candidate.subject, "subject");
  const publicKey = validatePublicKey(candidate.public_key);
  if (!Array.isArray(candidate.capabilities) || candidate.capabilities.some((capability) => typeof capability !== "string")) throw new Error("Invalid capabilities");
  assertSafeCapabilities(candidate.capabilities); assertCanonicalCapabilities(candidate.capabilities);
  for (const field of ["invite_id", "relay_url", "issued_at", "expires_at", "nonce"] as const) if (typeof candidate[field] !== "string" || candidate[field].length === 0) throw new Error(`Invalid ${field}`);
  if (!UUID_PATTERN.test(candidate.invite_id)) throw new Error("Invalid invite_id");
  try { new URL(candidate.relay_url); } catch { throw new Error("Invalid relay_url"); }
  if (Number.isNaN(Date.parse(candidate.issued_at))) throw new Error("Invalid issued_at");
  if (Number.isNaN(Date.parse(candidate.expires_at))) throw new Error("Invalid expires_at");
  if (candidate.safety_code !== undefined && typeof candidate.safety_code !== "string") throw new Error("Invalid safety_code");
  if (candidate.project_id !== undefined && candidate.project_id !== null && (typeof candidate.project_id !== "string" || candidate.project_id.length === 0)) throw new Error("Invalid project_id");
  if (candidate.project_name !== undefined && candidate.project_name !== null && (typeof candidate.project_name !== "string" || candidate.project_name.length === 0)) throw new Error("Invalid project_name");
  if (candidate.agent_ids !== undefined && candidate.agent_ids !== null) {
    if (!Array.isArray(candidate.agent_ids) || candidate.agent_ids.some((agentId) => typeof agentId !== "string" || agentId.length === 0)) throw new Error("Invalid agent_ids");
    const canonicalAgentIds = uniqueSorted(candidate.agent_ids);
    if (candidate.agent_ids.length !== canonicalAgentIds.length || candidate.agent_ids.some((agentId, index) => agentId !== canonicalAgentIds[index])) throw new Error("Invalid agent_ids: must be canonical sorted and deduplicated");
  }
  if (candidate.mode === "human_to_human") {
    if (subject.kind !== "human") throw new Error("human_to_human subject must be human");
    if (candidate.project_id !== undefined && candidate.project_id !== null) throw new Error("human_to_human invite must not include non-null project_id");
    if (candidate.project_name !== undefined && candidate.project_name !== null) throw new Error("human_to_human invite must not include non-null project_name");
    if (candidate.agent_ids !== undefined && candidate.agent_ids !== null) throw new Error("human_to_human invite must not include non-null agent_ids");
  }
  if (candidate.mode === "own_agent") {
    if (subject.kind !== "agent") throw new Error("own_agent subject must be agent");
    if (candidate.project_id !== undefined && candidate.project_id !== null) throw new Error("own_agent invite must not include non-null project_id");
    if (candidate.project_name !== undefined && candidate.project_name !== null) throw new Error("own_agent invite must not include non-null project_name");
    if (candidate.agent_ids !== undefined && candidate.agent_ids !== null) throw new Error("own_agent invite must not include non-null agent_ids");
  }
  if (candidate.mode === "friend_project_agents") {
    if (typeof candidate.project_id !== "string" || candidate.project_id.length === 0 || typeof candidate.project_name !== "string" || candidate.project_name.length === 0) throw new Error("friend_project_agents requires project_id and project_name");
    if (!Array.isArray(candidate.agent_ids) || candidate.agent_ids.length === 0) throw new Error("friend_project_agents requires nonempty agent_ids");
  }
  const normalized = buildPairingInvite({ inviteId: candidate.invite_id, mode: candidate.mode, issuer, subject, relayUrl: candidate.relay_url, publicKey: { alg: publicKey.alg, kid: publicKey.kid, value: publicKey.value }, capabilities: candidate.capabilities, projectId: candidate.project_id, projectName: candidate.project_name, agentIds: candidate.agent_ids, issuedAt: candidate.issued_at, expiresAt: candidate.expires_at, nonce: candidate.nonce, safetyCode: candidate.safety_code });
  if (typeof candidate.signature !== "string" || candidate.signature.length === 0) throw new Error("Invalid signature");
  if (!verifyCanonical(publicKey.key, signedPairingInvitePayload(candidate), candidate.signature)) throw new Error("Invalid signature");
  assertInviteNotExpired(normalized, options);
  return { ...normalized, signature: candidate.signature };
}

export function signAgentCard(card: AgentCardV1, privateKey: KeyObject): SignedAgentCardV1 {
  const signed = { ...card, signature: signCanonical(privateKey, signedAgentCardPayload(card)) };
  return validateAgentCard(signed);
}

function assertOnlyKeys(
  record: Record<string, unknown>,
  allowed: Set<string>,
  label: string,
): void {
  const unknown = Object.keys(record).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`Unknown ${label} field(s): ${unknown.join(",")}`);
}

export function validateAgentCard(card: unknown): SignedAgentCardV1 {
  if (!card || typeof card !== "object" || Array.isArray(card))
    throw new Error("Invalid agent card");
  const raw = card as Record<string, unknown>;
  assertOnlyKeys(
    raw,
    new Set([
      "type",
      "agent_id",
      "display_name",
      "kind",
      "relay_url",
      "pairing_endpoint",
      "public_key",
      "capabilities",
      "issued_at",
      "expires_at",
      "signature",
    ]),
    "agent card",
  );
  const candidate = card as AgentCardV1;
  if (candidate.type !== "opencomms_agent_card_v1") throw new Error("Invalid agent card type");
  for (const [key, value] of Object.entries(candidate)) {
    if (
      /private[_-]?key|secret/i.test(key) ||
      (typeof value === "string" && /private-key|secret/i.test(value))
    )
      throw new Error("Agent card must not contain secrets");
  }
  if (candidate.kind !== "agent") throw new Error("Invalid agent card kind");
  for (const field of ["agent_id", "display_name", "relay_url", "issued_at"] as const) {
    if (typeof candidate[field] !== "string" || candidate[field].length === 0)
      throw new Error(`Invalid ${field}`);
  }
  try {
    new URL(candidate.relay_url);
  } catch {
    throw new Error("Invalid relay_url");
  }
  if (candidate.pairing_endpoint !== undefined) {
    if (typeof candidate.pairing_endpoint !== "string" || candidate.pairing_endpoint.length === 0)
      throw new Error("Invalid pairing_endpoint");
    try {
      new URL(candidate.pairing_endpoint);
    } catch {
      throw new Error("Invalid pairing_endpoint");
    }
  }
  if (
    !candidate.public_key ||
    typeof candidate.public_key !== "object" ||
    Array.isArray(candidate.public_key)
  )
    throw new Error("Invalid public_key");
  assertOnlyKeys(
    candidate.public_key as unknown as Record<string, unknown>,
    new Set(["alg", "kid", "value"]),
    "public_key",
  );
  if (
    candidate.public_key.alg !== "ed25519" ||
    typeof candidate.public_key.kid !== "string" ||
    candidate.public_key.kid.length === 0 ||
    typeof candidate.public_key.value !== "string" ||
    candidate.public_key.value.length === 0
  )
    throw new Error("Invalid public_key");
  let publicKey: KeyObject;
  try {
    publicKey = importRawPublicKey(candidate.public_key.value);
  } catch {
    throw new Error("Invalid public_key");
  }
  if (!Array.isArray(candidate.capabilities)) throw new Error("Invalid capabilities");
  if (candidate.capabilities.some((capability) => typeof capability !== "string"))
    throw new Error("Invalid capabilities");
  assertSafeCapabilities(candidate.capabilities);
  assertCanonicalCapabilities(candidate.capabilities);
  if (Number.isNaN(Date.parse(candidate.issued_at))) throw new Error("Invalid issued_at");
  if (
    candidate.expires_at !== undefined &&
    (typeof candidate.expires_at !== "string" || Number.isNaN(Date.parse(candidate.expires_at)))
  )
    throw new Error("Invalid expires_at");
  if (typeof candidate.signature !== "string" || candidate.signature.length === 0)
    throw new Error("Invalid signature");
  if (!verifyCanonical(publicKey, signedAgentCardPayload(candidate), candidate.signature))
    throw new Error("Invalid signature");
  const normalized = buildAgentCard({
    agentId: candidate.agent_id,
    displayName: candidate.display_name,
    relayUrl: candidate.relay_url,
    pairingEndpoint: candidate.pairing_endpoint,
    publicKey: candidate.public_key,
    capabilities: candidate.capabilities,
    issuedAt: candidate.issued_at,
    expiresAt: candidate.expires_at,
  });
  return {
    ...normalized,
    signature: candidate.signature,
  };
}

export function buildPairRequest(options: BuildPairRequestOptions): PairRequestV1 {
  const card = validateAgentCard(options.card);
  const requestedCapabilities = uniqueSorted(options.requestedCapabilities ?? card.capabilities);
  assertSafeCapabilities(requestedCapabilities);
  const requestedAt = options.requestedAt ?? new Date().toISOString();
  if (!options.nonce) throw new Error("Invalid nonce");
  if (Number.isNaN(Date.parse(requestedAt))) throw new Error("Invalid requested_at");
  assertNotExpired(card, { now: requestedAt });
  return {
    type: "opencomms_pair_request_v1",
    card,
    nonce: options.nonce,
    requested_at: requestedAt,
    requested_capabilities: requestedCapabilities,
  };
}

export function buildContactFromAgentCard(
  cardInput: AgentCardV1,
  options: BuildContactOptions,
): ContactRecord {
  const card = validateAgentCard(cardInput);
  const granted = uniqueSorted(options.grantedCapabilities);
  assertSafeCapabilities(granted);
  if (!TRUST_LEVELS.has(options.trustLevel)) throw new Error("Invalid trust_level");
  const now = options.now ?? new Date().toISOString();
  assertNotExpired(card, { now });
  return {
    contact_id: `${card.agent_id}@${card.public_key.kid}`,
    agent_id: card.agent_id,
    display_name: card.display_name,
    kind: card.kind,
    relay_url: card.relay_url,
    public_key: { ...card.public_key },
    pairing_id: options.pairingId,
    trust_level: options.trustLevel,
    granted_capabilities: granted,
    created_at: now,
    last_seen: null,
    last_seen_at: null,
    revoked: false,
    revoked_at: null,
  };
}

export function formatContactsList(contacts: ContactRecord[]): string {
  return (
    contacts
      .map((contact) =>
        [
          contact.contact_id,
          contact.agent_id,
          contact.display_name,
          contact.trust_level,
          contact.granted_capabilities.join(","),
          contact.relay_url,
        ].join("\t"),
      )
      .join("\n") + (contacts.length > 0 ? "\n" : "")
  );
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function hasUsedInvite(store: ContactStore, contactsPath: string, inviteId: string, nonce: string): Promise<boolean> {
  const maybeStore = store as ContactStore & { hasUsedInvite?: (inviteId: string, nonce: string) => Promise<boolean> };
  if (maybeStore.hasUsedInvite) return maybeStore.hasUsedInvite(inviteId, nonce);
  try {
    const raw = await readJson(contactsPath) as { used_invites?: unknown };
    return Array.isArray(raw.used_invites) && raw.used_invites.some((used) => {
      const record = used as { invite_id?: unknown; nonce?: unknown };
      return record.invite_id === inviteId && record.nonce === nonce;
    });
  } catch {
    return false;
  }
}

async function markInviteUsed(store: ContactStore, contactsPath: string, inviteId: string, nonce: string, consumedAt: string): Promise<void> {
  const maybeStore = store as ContactStore & { markInviteUsed?: (inviteId: string, nonce: string, consumedAt?: string) => Promise<void> };
  if (maybeStore.markInviteUsed) return maybeStore.markInviteUsed(inviteId, nonce, consumedAt);
  const raw = await readJson(contactsPath) as { contacts?: unknown[]; used_invites?: unknown[] };
  const used_invites = Array.isArray(raw.used_invites) ? raw.used_invites : [];
  if (!used_invites.some((used) => (used as { invite_id?: unknown; nonce?: unknown }).invite_id === inviteId && (used as { invite_id?: unknown; nonce?: unknown }).nonce === nonce)) {
    used_invites.push({ invite_id: inviteId, nonce, consumed_at: consumedAt });
    await writeJson(contactsPath, { contacts: raw.contacts ?? [], used_invites });
  }
}

async function privateKeyFromArgs(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<KeyObject | undefined> {
  const privateKeyFile = valueAfter(args, "--private-key-file");
  const pem = privateKeyFile
    ? await readFile(privateKeyFile, "utf8")
    : env.AGENTCOMMS_CARD_PRIVATE_KEY_PEM;
  return pem ? createPrivateKey(pem) : undefined;
}

function validatePairRequest(input: unknown): PairRequestV1 {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid pair request");
  const raw = input as Record<string, unknown>;
  assertOnlyKeys(
    raw,
    new Set(["type", "card", "nonce", "requested_at", "requested_capabilities"]),
    "pair request",
  );
  const candidate = input as PairRequestV1;
  if (candidate.type !== "opencomms_pair_request_v1") throw new Error("Invalid pair request type");
  if (typeof candidate.nonce !== "string" || candidate.nonce.length === 0)
    throw new Error("Invalid nonce");
  if (
    typeof candidate.requested_at !== "string" ||
    Number.isNaN(Date.parse(candidate.requested_at))
  )
    throw new Error("Invalid requested_at");
  if (
    !Array.isArray(candidate.requested_capabilities) ||
    candidate.requested_capabilities.some((capability) => typeof capability !== "string")
  )
    throw new Error("Invalid requested_capabilities");
  assertSafeCapabilities(candidate.requested_capabilities);
  return buildPairRequest({
    card: validateAgentCard(candidate.card),
    nonce: candidate.nonce,
    requestedAt: candidate.requested_at,
    requestedCapabilities: candidate.requested_capabilities,
  });
}

export interface PairingSummaryOptions {
  now?: string | number | Date;
}

export interface RenderedTrustCard {
  text: string;
  uri: string;
  compareCode: string;
}

function timeMs(value: string | number | Date | undefined, label: string): number {
  if (value === undefined) return Date.now();
  const parsed = typeof value === "number" ? value : value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label}`);
  return parsed;
}

function assertNotExpired(card: SignedAgentCardV1, options: PairingSummaryOptions): void {
  if (card.expires_at !== undefined && Date.parse(card.expires_at) <= timeMs(options.now, "now")) {
    throw new Error("Pairing import expired: request a fresh OpenComms card");
  }
}

function assertInviteNotExpired(invite: { expires_at: string }, options: PairingSummaryOptions): void {
  if (Date.parse(invite.expires_at) <= timeMs(options.now, "now")) {
    throw new Error("Pairing invite expired: request a fresh OpenComms invite");
  }
}

const SECRETISH_OUTPUT_PATTERN = /\b(?:bearer\s+\S+|token=\S+|transcript\b|private\b|secret\b)/i;

function redactSummaryField(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/(token=)[^\s&#?]+/gi, "$1[REDACTED]")
    .replace(/\b(transcript|private|secret)\b\s*:?\s*.*$/gi, "$1: [REDACTED]");
}

function assertNoUrlQueryOrFragment(value: string, label: string): void {
  const parsed = new URL(value);
  if (parsed.search || parsed.hash) {
    throw new Error(`Unsafe trust card ${label}: URL query strings and fragments are not exportable`);
  }
}

function assertSafeTrustCardExport(card: SignedAgentCardV1): void {
  assertNoUrlQueryOrFragment(card.relay_url, "relay_url");
  if (card.pairing_endpoint !== undefined) assertNoUrlQueryOrFragment(card.pairing_endpoint, "pairing_endpoint");
  const checkedFields = [
    ["display_name", card.display_name],
    ["agent_id", card.agent_id],
    ["relay_url", card.relay_url],
    ["pairing_endpoint", card.pairing_endpoint],
    ["public_key.kid", card.public_key.kid],
    ["capabilities", card.capabilities.join(",")],
  ] as const;
  for (const [label, value] of checkedFields) {
    if (value !== undefined && SECRETISH_OUTPUT_PATTERN.test(value)) {
      throw new Error(`Unsafe trust card ${label}: contains token-like or transcript-like content`);
    }
  }
}

function shortHash(value: string, length = 12): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length).toUpperCase();
}

function keyFingerprint(card: SignedAgentCardV1): string {
  return shortHash(`${card.public_key.kid}:${card.public_key.value}`, 16);
}

function compareCode(card: SignedAgentCardV1): string {
  return shortHash(`${card.agent_id}:${card.public_key.kid}:${card.signature}`, 8).replace(/(.{4})/g, "$1-").replace(/-$/, "");
}

function relayHost(relayUrl: string): string {
  return new URL(relayUrl).host;
}

export function summarizeAgentCard(input: unknown, options: PairingSummaryOptions = {}): string {
  const card = validateAgentCard(input);
  assertNotExpired(card, options);
  return [
    "OpenComms pairing summary",
    "Kind: agent card",
    `Display name: ${redactSummaryField(card.display_name)}`,
    `Agent ID: ${redactSummaryField(card.agent_id)}`,
    `Relay host: ${relayHost(card.relay_url)}`,
    `Key: ${redactSummaryField(card.public_key.kid)} (${keyFingerprint(card)})`,
    `Capabilities: ${card.capabilities.join(", ")}`,
    `Issued: ${card.issued_at}`,
    `Expires: ${card.expires_at ?? "none"}`,
    `Compare code: ${compareCode(card)}`,
    "Valid: yes",
  ].join("\n") + "\n";
}

export function summarizePairRequest(input: unknown, options: PairingSummaryOptions = {}): string {
  const request = validatePairRequest(input);
  assertNotExpired(request.card, options);
  return (
    summarizeAgentCard(request.card, options).replace("Kind: agent card", "Kind: pair request") +
    `Requested capabilities: ${request.requested_capabilities.join(", ")}\n` +
    `Requested at: ${request.requested_at}\n`
  );
}

export function pairingInviteLink(inviteInput: PairingInviteV1, options: { webFallback?: boolean } = {}): string {
  const invite = validatePairingInvite(inviteInput, { now: inviteInput.issued_at });
  const encoded = Buffer.from(JSON.stringify(invite), "utf8").toString("base64url");
  return options.webFallback
    ? `${"https"}://opencomms.local/pair#invite=${encodeURIComponent(encoded)}`
    : `opencomms://pair?invite=${encodeURIComponent(encoded)}`;
}

function decodePairingInviteLink(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed) as unknown;
  let url: URL;
  try { url = new URL(trimmed); } catch { throw new Error("Malformed pairing invite link"); }
  let encoded: string | null = null;
  if (url.protocol === "opencomms:" && url.hostname === "pair") encoded = url.searchParams.get("invite");
  if (url.protocol === "https:" && url.hostname === "opencomms.local" && url.pathname === "/pair") {
    const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
    encoded = new URLSearchParams(hash).get("invite");
  }
  if (!encoded) throw new Error("Malformed pairing invite link: missing invite");
  try { return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown; }
  catch { throw new Error("Malformed pairing invite link"); }
}

export function parsePairingInviteLink(raw: string, options: PairingSummaryOptions = {}): SignedPairingInviteV1 {
  return validatePairingInvite(decodePairingInviteLink(raw), options);
}

export function summarizePairingInvite(raw: string | PairingInviteV1, options: PairingSummaryOptions = {}): string {
  const invite = typeof raw === "string" ? parsePairingInviteLink(raw, options) : validatePairingInvite(raw, options);
  return [
    "OpenComms pairing summary",
    "Kind: pairing invite",
    `Mode: ${invite.mode}`,
    `Issuer: ${redactSummaryField(invite.issuer.display_name)} (${redactSummaryField(invite.issuer.id)})`,
    `Subject: ${redactSummaryField(invite.subject.display_name)} (${redactSummaryField(invite.subject.id)})`,
    `Subject kind: ${invite.subject.kind}`,
    `Relay host: ${relayHost(invite.relay_url)}`,
    `Key: ${redactSummaryField(invite.public_key.kid)} (${shortHash(`${invite.public_key.kid}:${invite.public_key.value}`, 16)})`,
    `Capabilities: ${invite.capabilities.join(", ")}`,
    `Project: ${invite.project_name ? `${redactSummaryField(invite.project_name)} (${redactSummaryField(invite.project_id ?? "")})` : "none"}`,
    `Agents: ${invite.agent_ids?.map(redactSummaryField).join(", ") ?? "none"}`,
    `Safety code: ${redactSummaryField(invite.safety_code ?? "none")}`,
    `Issued: ${invite.issued_at}`,
    `Expires: ${invite.expires_at}`,
    "Valid: yes",
  ].join("\n") + "\n";
}

export function renderPairingRunbook(options: { agentId?: string; repoDir?: string; outputDir?: string } = {}): string {
  const agentId = options.agentId ?? "monolith";
  const repoDir = options.repoDir ?? "/path/to/agentcomms";
  const outputDir = options.outputDir ?? "~/.agentcomms/pairing";
  return [
    "# OpenComms installed-agent pairing runbook",
    "OpenComms pairing artifact runbook: generate a phone-scannable QR payload or pasteable contact artifact without exporting secrets.",
    "When asked to connect/pair/share OpenComms QR, do this:",
    `1. Work from the repo: cd ${repoDir}`,
    `2. Ensure the signed agent card exists at ${outputDir}/${agentId}-card.json. If missing, create it with real Ed25519 key material only:`,
    `   npx --yes pnpm@9.15.4 cli create-card --agent-id ${agentId} --display-name \"${agentId}\" --relay-url \"$OPENCOMMS_RENDEZVOUS_URL\" --public-key-kid <key-id> --public-key <base64url-public-key> --private-key-file <ed25519-private-key.pem> --out ${outputDir}/${agentId}-card.json`,
    `3. Generate the QR/deep-link payload text:`,
    `   npx --yes pnpm@9.15.4 cli trust-card --card ${outputDir}/${agentId}-card.json > ${outputDir}/${agentId}-opencomms-pairing.txt`,
    `   # equivalent after build/install: agentcomms trust-card --card ${outputDir}/${agentId}-card.json > ${outputDir}/${agentId}-opencomms-pairing.txt`,
    "4. Give the user the file path and the line beginning `opencomms://pair?...`; the Android app can paste it, and any QR tool can encode that exact line.",
    "5. If a QR PNG is required and qrencode is installed:",
    `   grep '^opencomms://pair' ${outputDir}/${agentId}-opencomms-pairing.txt | qrencode -o ${outputDir}/${agentId}-opencomms-pairing.png`,
    "Safety: never include private keys, rendezvous tokens, transcript contents, Authorization headers, or raw secrets in the artifact. If key material/card is missing, say exactly what is missing instead of inventing keys.",
  ].join("\n") + "\n";
}

export function contactFromPairingInvite(inviteInput: PairingInviteV1, options: { now?: string | number | Date; trustLevel?: Exclude<TrustLevel, "revoked"> } = {}): ContactRecord {
  const invite = validatePairingInvite(inviteInput, options);
  const trustLevel = options.trustLevel ?? "paired";
  if (!TRUST_LEVELS.has(trustLevel)) throw new Error("Invalid trust_level");
  const now = options.now === undefined ? new Date().toISOString() : new Date(timeMs(options.now, "now")).toISOString();
  const subjectId = invite.subject.id;
  const contactId = invite.mode === "friend_project_agents" && invite.project_id
    ? `${invite.project_id}/${subjectId}@${invite.public_key.kid}`
    : `${subjectId}@${invite.public_key.kid}`;
  const contact: ContactRecord = {
    contact_id: contactId,
    agent_id: subjectId,
    display_name: invite.subject.display_name,
    kind: invite.subject.kind,
    relay_url: invite.relay_url,
    public_key: { ...invite.public_key },
    pairing_id: invite.invite_id,
    trust_level: trustLevel,
    granted_capabilities: [...invite.capabilities],
    created_at: now,
    last_seen: null,
    last_seen_at: null,
    revoked: false,
    revoked_at: null,
    pairing_mode: invite.mode,
    issuer_id: invite.issuer.id,
    issuer_kind: "human",
  };
  if (invite.project_id) contact.project_id = invite.project_id;
  if (invite.project_name) contact.project_name = invite.project_name;
  if (invite.agent_ids) contact.agent_ids = [...invite.agent_ids];
  if (invite.safety_code) contact.safety_code = invite.safety_code;
  const notes = [
    invite.mode,
    invite.project_id ? `project_id=${invite.project_id}` : undefined,
    invite.project_name ? `project_name=${invite.project_name}` : undefined,
    invite.agent_ids ? `agent_ids=${invite.agent_ids.join(",")}` : undefined,
    invite.safety_code ? `safety_code=${invite.safety_code}` : undefined,
  ].filter(Boolean).join("; ");
  if (notes) contact.notes = notes;
  return contact;
}

export function trustCardPayload(input: unknown, options: PairingSummaryOptions = {}): string {
  const card = validateAgentCard(input);
  assertNotExpired(card, options);
  assertSafeTrustCardExport(card);
  const encoded = Buffer.from(JSON.stringify(card), "utf8").toString("base64url");
  return `opencomms://pair?v=1&card=${encodeURIComponent(encoded)}`;
}

export function parseTrustCardPayload(uri: string, options: PairingSummaryOptions = {}): { card: SignedAgentCardV1; compareCode: string } {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new Error("Malformed trust card payload");
  }
  if (url.protocol !== "opencomms:" || url.hostname !== "pair") throw new Error("Malformed trust card payload");
  if (url.searchParams.get("v") !== "1") throw new Error("Unknown trust card version");
  const encoded = url.searchParams.get("card");
  if (!encoded) throw new Error("Malformed trust card payload");
  try {
    const card = validateAgentCard(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown);
    assertNotExpired(card, options);
    assertSafeTrustCardExport(card);
    return { card, compareCode: compareCode(card) };
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("Malformed trust card payload");
    throw error;
  }
}

export function renderTrustCard(input: unknown, options: PairingSummaryOptions = {}): RenderedTrustCard {
  const card = validateAgentCard(input);
  assertNotExpired(card, options);
  assertSafeTrustCardExport(card);
  return {
    uri: trustCardPayload(card, options),
    compareCode: compareCode(card),
    text: [
      "OpenComms trust card",
      `Display name: ${redactSummaryField(card.display_name)}`,
      `Kind: ${card.kind}`,
      `Agent ID: ${redactSummaryField(card.agent_id)}`,
      `Relay host: ${relayHost(card.relay_url)}`,
      `Key: ${redactSummaryField(card.public_key.kid)} (${keyFingerprint(card)})`,
      `Capabilities: ${card.capabilities.join(", ")}`,
      `Issued: ${card.issued_at}`,
      `Expires: ${card.expires_at ?? "none"}`,
      `Compare code: ${compareCode(card)}`,
      `QR payload: ${trustCardPayload(card, options)}`,
    ].join("\n") + "\n",
  };
}

export async function runPairingCli(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const [command, subcommand, ...rest] = argv;
  if (command === "create-card") {
    const args = [subcommand, ...rest].filter((arg): arg is string => arg !== undefined);
    const unsigned = buildAgentCard({
      agentId: requireValue(args, "--agent-id"),
      displayName: requireValue(args, "--display-name"),
      relayUrl: requireValue(args, "--relay-url"),
      pairingEndpoint: valueAfter(args, "--pairing-endpoint"),
      publicKey: {
        alg: "ed25519",
        kid: requireValue(args, "--public-key-kid"),
        value: requireValue(args, "--public-key"),
      },
      capabilities: parseCsv(valueAfter(args, "--capabilities"), ["chat", "status"]),
      issuedAt: valueAfter(args, "--issued-at"),
      expiresAt: valueAfter(args, "--expires-at"),
    });
    const privateKey = await privateKeyFromArgs(args, env);
    if (!privateKey)
      throw new Error("create-card requires --private-key-file or AGENTCOMMS_CARD_PRIVATE_KEY_PEM");
    const card = signAgentCard(unsigned, privateKey);
    const out = valueAfter(args, "--out");
    if (out) await writeJson(out, card);
    return `${JSON.stringify(card, null, 2)}\n`;
  }

  if (command === "request") {
    const args = [subcommand, ...rest].filter((arg): arg is string => arg !== undefined);
    const capabilities = valueAfter(args, "--capabilities");
    const request = buildPairRequest({
      card: validateAgentCard(await readJson(requireValue(args, "--card"))),
      nonce: requireValue(args, "--nonce"),
      requestedAt: valueAfter(args, "--requested-at"),
      requestedCapabilities: capabilities === undefined ? undefined : parseCsv(capabilities),
    });
    const out = valueAfter(args, "--out");
    if (out) await writeJson(out, request);
    return `${JSON.stringify(request, null, 2)}\n`;
  }

  if (command === "summary") {
    const args = [subcommand, ...rest].filter((arg): arg is string => arg !== undefined);
    const now = valueAfter(args, "--now");
    const cardPath = valueAfter(args, "--card");
    const requestPath = valueAfter(args, "--request");
    const invitePath = valueAfter(args, "--invite");
    if (cardPath) return summarizeAgentCard(await readJson(cardPath), { now });
    if (requestPath) return summarizePairRequest(await readJson(requestPath), { now });
    if (invitePath) return summarizePairingInvite(await readFile(invitePath, "utf8"), { now });
    throw new Error("summary requires --card, --request, or --invite");
  }

  if (command === "trust-card") {
    const args = [subcommand, ...rest].filter((arg): arg is string => arg !== undefined);
    const rendered = renderTrustCard(await readJson(requireValue(args, "--card")), { now: valueAfter(args, "--now") });
    return `${rendered.text}${rendered.uri}\n`;
  }

  if (command === "pairing-runbook") {
    const args = [subcommand, ...rest].filter((arg): arg is string => arg !== undefined);
    return renderPairingRunbook({
      agentId: valueAfter(args, "--agent-id"),
      repoDir: valueAfter(args, "--repo-dir"),
      outputDir: valueAfter(args, "--output-dir"),
    });
  }

  if (command === "approve") {
    const args = [subcommand, ...rest].filter((arg): arg is string => arg !== undefined);
    const contactsPath = valueAfter(args, "--contacts-path") ?? defaultContactsPath(env);
    const store = new ContactStore(contactsPath);
    const requestPath = valueAfter(args, "--request");
    const card = requestPath
      ? validatePairRequest(await readJson(requestPath)).card
      : validateAgentCard(await readJson(requireValue(args, "--card")));
    const contact = buildContactFromAgentCard(card, {
      pairingId: requireValue(args, "--pairing-id"),
      grantedCapabilities: parseCsv(requireValue(args, "--grant")),
      trustLevel: requireValue(args, "--trust-level") as Exclude<TrustLevel, "revoked">,
      now: valueAfter(args, "--now"),
    });
    await store.upsert(contact, { allowUpdate: valueAfter(args, "--allow-update") === "true" });
    return `stored contact ${contact.contact_id}\n`;
  }

  if (command === "contacts") {
    const args = rest;
    const contactsPath = valueAfter(args, "--contacts-path") ?? defaultContactsPath(env);
    const store = new ContactStore(contactsPath);
    if (subcommand === "list") return formatContactsList(await store.list());
    if (subcommand === "import-card") {
      const card = validateAgentCard(
        JSON.parse(await readFile(requireValue(args, "--card"), "utf8")) as unknown,
      );
      const contact = buildContactFromAgentCard(card, {
        pairingId: requireValue(args, "--pairing-id"),
        grantedCapabilities: parseCsv(requireValue(args, "--grant")),
        trustLevel: requireValue(args, "--trust-level") as Exclude<TrustLevel, "revoked">,
        now: valueAfter(args, "--now"),
      });
      await store.upsert(contact, { allowUpdate: valueAfter(args, "--allow-update") === "true" });
      return `stored contact ${contact.contact_id}\n`;
    }
    if (subcommand === "import-invite") {
      const invite = parsePairingInviteLink(await readFile(requireValue(args, "--invite"), "utf8"), { now: valueAfter(args, "--now") });
      if (await hasUsedInvite(store, contactsPath, invite.invite_id, invite.nonce)) {
        throw new Error("Pairing invite already used/consumed");
      }
      const contact = contactFromPairingInvite(invite, {
        trustLevel: (valueAfter(args, "--trust-level") ?? "paired") as Exclude<TrustLevel, "revoked">,
        now: valueAfter(args, "--now"),
      });
      await store.upsert(contact, { allowUpdate: valueAfter(args, "--allow-update") === "true" });
      await markInviteUsed(store, contactsPath, invite.invite_id, invite.nonce, contact.created_at);
      return `stored contact ${contact.contact_id}\n`;
    }
    if (subcommand === "revoke") {
      const contactId = rest[0];
      if (!contactId || contactId.startsWith("--"))
        throw new Error("contacts revoke requires <contact_id>");
      await store.revoke(contactId, valueAfter(args, "--now"));
      return `revoked contact ${contactId}\n`;
    }
  }

  throw new Error(
    "Usage: agentcomms create-card ... | agentcomms trust-card --card <card.json> | agentcomms pairing-runbook --agent-id <id> | agentcomms request ... | agentcomms approve ... | agentcomms summary --card|--request|--invite <file> | agentcomms contacts list|import-card|import-invite|revoke",
  );
}
