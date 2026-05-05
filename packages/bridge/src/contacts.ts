import { existsSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { importRawPublicKey } from "@agentcomms/protocol/node";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type ContactKind = "agent" | "human";
export type TrustLevel = "local_admin_approved" | "paired" | "verified" | "revoked";

export interface ContactPublicKey {
  alg: "ed25519";
  kid: string;
  value: string;
}

export interface ContactRecord {
  contact_id: string;
  agent_id: string;
  display_name: string;
  kind: ContactKind;
  relay_url: string;
  public_key: ContactPublicKey;
  pairing_id: string;
  trust_level: TrustLevel;
  granted_capabilities: string[];
  created_at: string;
  last_seen: string | null;
  last_seen_at: string | null;
  revoked: boolean;
  revoked_at: string | null;
  notes?: string;
  project_id?: string;
  project_name?: string;
  agent_ids?: string[];
  pairing_mode?: "human_to_human" | "own_agent" | "friend_project_agents";
  issuer_id?: string;
  issuer_kind?: "human";
  safety_code?: string;
}

export interface UsedInviteRecord {
  invite_id: string;
  nonce: string;
  consumed_at: string;
}

export interface ContactStoreFile {
  contacts: ContactRecord[];
  used_invites: UsedInviteRecord[];
}

export interface UpsertOptions {
  allowUpdate?: boolean;
}

export interface ListOptions {
  includeRevoked?: boolean;
}

const CONTACT_ID_PATTERN = /^[A-Za-z0-9._~:@/-]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function defaultContactsPath(
  env: Partial<
    Record<"OPENCOMMS_CONTACTS_PATH" | "AGENTCOMMS_CONTACTS_PATH" | "HOME", string>
  > = process.env,
): string {
  return (
    env.OPENCOMMS_CONTACTS_PATH ??
    env.AGENTCOMMS_CONTACTS_PATH ??
    join(env.HOME ?? homedir(), ".agentcomms", "contacts.json")
  );
}

function assertString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Invalid ${name}`);
}

function assertIsoOrNull(value: unknown, name: string): void {
  if (value === null) return;
  assertString(value, name);
  if (Number.isNaN(Date.parse(value))) throw new Error(`Invalid ${name}`);
}

function assertOnlyKeys(
  record: Record<string, unknown>,
  allowed: Set<string>,
  label: string,
): void {
  const unknown = Object.keys(record).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`Unknown ${label} field(s): ${unknown.join(",")}`);
}

function hasPrivateKeyMaterial(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  for (const [key, child] of Object.entries(value)) {
    if (/private[_-]?key|secret/i.test(key)) return true;
    if (hasPrivateKeyMaterial(child)) return true;
  }
  return false;
}

export function validateContactRecord(input: unknown): ContactRecord {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid contact record");
  if (hasPrivateKeyMaterial(input))
    throw new Error("Contacts store must not contain private key material");
  const raw = input as Record<string, unknown>;
  assertOnlyKeys(
    raw,
    new Set([
      "contact_id",
      "agent_id",
      "display_name",
      "kind",
      "relay_url",
      "public_key",
      "pairing_id",
      "trust_level",
      "granted_capabilities",
      "created_at",
      "last_seen",
      "last_seen_at",
      "revoked",
      "revoked_at",
      "notes",
      "project_id",
      "project_name",
      "agent_ids",
      "pairing_mode",
      "issuer_id",
      "issuer_kind",
      "safety_code",
    ]),
    "contact record",
  );
  const record = input as ContactRecord;

  assertString(record.contact_id, "contact_id");
  if (!CONTACT_ID_PATTERN.test(record.contact_id) || record.contact_id.includes(" "))
    throw new Error("Invalid contact_id");
  assertString(record.agent_id, "agent_id");
  assertString(record.display_name, "display_name");
  if (!["agent", "human"].includes(record.kind)) throw new Error("Invalid kind");
  assertString(record.relay_url, "relay_url");
  // URL constructor accepts opencomms: and https:; this store only needs a syntactically valid local handoff URL.
  try {
    new URL(record.relay_url);
  } catch {
    throw new Error("Invalid relay_url");
  }
  if (
    !record.public_key ||
    typeof record.public_key !== "object" ||
    Array.isArray(record.public_key)
  )
    throw new Error("Invalid public_key");
  assertOnlyKeys(
    record.public_key as unknown as Record<string, unknown>,
    new Set(["alg", "kid", "value"]),
    "public_key",
  );
  if (record.public_key.alg !== "ed25519") throw new Error("Invalid public_key");
  assertString(record.public_key.kid, "public_key.kid");
  assertString(record.public_key.value, "public_key.value");
  try {
    importRawPublicKey(record.public_key.value);
  } catch {
    throw new Error("Invalid public_key");
  }
  assertString(record.pairing_id, "pairing_id");
  if (!UUID_PATTERN.test(record.pairing_id)) throw new Error("Invalid pairing_id");
  if (!["local_admin_approved", "paired", "verified", "revoked"].includes(record.trust_level))
    throw new Error("Invalid trust_level");
  if (
    !Array.isArray(record.granted_capabilities) ||
    !record.granted_capabilities.every(
      (capability) => typeof capability === "string" && capability.length > 0,
    )
  ) {
    throw new Error("Invalid granted_capabilities");
  }
  const lastSeen = record.last_seen ?? record.last_seen_at ?? null;
  const revokedAt = record.revoked_at ?? null;
  if (record.revoked !== undefined && typeof record.revoked !== "boolean")
    throw new Error("Invalid revoked");
  const revoked = record.revoked === true || revokedAt !== null || record.trust_level === "revoked";
  assertIsoOrNull(record.created_at, "created_at");
  assertIsoOrNull(lastSeen, "last_seen");
  assertIsoOrNull(record.last_seen_at ?? null, "last_seen_at");
  assertIsoOrNull(revokedAt, "revoked_at");
  if (record.notes !== undefined && typeof record.notes !== "string")
    throw new Error("Invalid notes");
  if (record.project_id !== undefined) assertString(record.project_id, "project_id");
  if (record.project_name !== undefined) assertString(record.project_name, "project_name");
  if (record.agent_ids !== undefined) {
    if (
      !Array.isArray(record.agent_ids) ||
      record.agent_ids.some((agentId) => typeof agentId !== "string" || agentId.length === 0)
    )
      throw new Error("Invalid agent_ids");
  }
  if (
    record.pairing_mode !== undefined &&
    !["human_to_human", "own_agent", "friend_project_agents"].includes(record.pairing_mode)
  )
    throw new Error("Invalid pairing_mode");
  if (record.pairing_mode === "friend_project_agents") {
    assertString(record.project_id, "project_id");
    assertString(record.project_name, "project_name");
    if (
      !Array.isArray(record.agent_ids) ||
      record.agent_ids.length === 0 ||
      record.agent_ids.some((agentId) => typeof agentId !== "string" || agentId.length === 0)
    ) {
      throw new Error("Invalid agent_ids");
    }
  }
  if (record.issuer_id !== undefined) assertString(record.issuer_id, "issuer_id");
  if (record.issuer_kind !== undefined && record.issuer_kind !== "human")
    throw new Error("Invalid issuer_kind");
  if (record.safety_code !== undefined) assertString(record.safety_code, "safety_code");

  const normalized: ContactRecord = {
    contact_id: record.contact_id,
    agent_id: record.agent_id,
    display_name: record.display_name,
    kind: record.kind,
    relay_url: record.relay_url,
    public_key: {
      alg: record.public_key.alg,
      kid: record.public_key.kid,
      value: record.public_key.value,
    },
    pairing_id: record.pairing_id,
    trust_level: record.trust_level,
    granted_capabilities: [...record.granted_capabilities],
    created_at: record.created_at,
    last_seen: lastSeen,
    last_seen_at: lastSeen,
    revoked,
    revoked_at: revokedAt,
  };
  if (record.notes !== undefined) normalized.notes = record.notes;
  if (record.project_id !== undefined) normalized.project_id = record.project_id;
  if (record.project_name !== undefined) normalized.project_name = record.project_name;
  if (record.agent_ids !== undefined) normalized.agent_ids = [...record.agent_ids];
  if (record.pairing_mode !== undefined) normalized.pairing_mode = record.pairing_mode;
  if (record.issuer_id !== undefined) normalized.issuer_id = record.issuer_id;
  if (record.issuer_kind !== undefined) normalized.issuer_kind = record.issuer_kind;
  if (record.safety_code !== undefined) normalized.safety_code = record.safety_code;
  return normalized;
}

export class ContactStore {
  constructor(private readonly path = defaultContactsPath()) {}

  async list(options: ListOptions = {}): Promise<ContactRecord[]> {
    const file = await this.readStore();
    const contacts = options.includeRevoked
      ? file.contacts
      : file.contacts.filter(
          (contact) => !contact.revoked && !contact.revoked_at && contact.trust_level !== "revoked",
        );
    return contacts.map((contact) => ({
      ...contact,
      public_key: { ...contact.public_key },
      granted_capabilities: [...contact.granted_capabilities],
      ...(contact.agent_ids ? { agent_ids: [...contact.agent_ids] } : {}),
    }));
  }

  async get(contactId: string): Promise<ContactRecord | undefined> {
    const file = await this.readStore();
    const contact = file.contacts.find((candidate) => candidate.contact_id === contactId);
    return contact
      ? {
          ...contact,
          public_key: { ...contact.public_key },
          granted_capabilities: [...contact.granted_capabilities],
      ...(contact.agent_ids ? { agent_ids: [...contact.agent_ids] } : {}),
        }
      : undefined;
  }

  async hasUsedInvite(inviteId: string, nonce: string): Promise<boolean> {
    const file = await this.readStore();
    return file.used_invites.some((used) => used.invite_id === inviteId && used.nonce === nonce);
  }

  async markInviteUsed(inviteId: string, nonce: string, consumedAt = new Date().toISOString()): Promise<void> {
    assertString(inviteId, "invite_id");
    if (!UUID_PATTERN.test(inviteId)) throw new Error("Invalid invite_id");
    assertString(nonce, "nonce");
    assertIsoOrNull(consumedAt, "consumed_at");
    const file = await this.readStore();
    if (!file.used_invites.some((used) => used.invite_id === inviteId && used.nonce === nonce)) {
      file.used_invites.push({ invite_id: inviteId, nonce, consumed_at: consumedAt });
      file.used_invites.sort((a, b) => `${a.invite_id}:${a.nonce}`.localeCompare(`${b.invite_id}:${b.nonce}`));
      await this.writeStore(file);
    }
  }

  async upsert(input: ContactRecord, options: UpsertOptions = {}): Promise<ContactRecord> {
    const contact = validateContactRecord(input);
    const file = await this.readStore();
    const index = file.contacts.findIndex(
      (candidate) => candidate.contact_id === contact.contact_id,
    );
    if (index >= 0) {
      const existing = file.contacts[index]!;
      if (
        !options.allowUpdate &&
        !existing.revoked &&
        !existing.revoked_at &&
        existing.trust_level !== "revoked"
      ) {
        throw new Error(
          `Refusing duplicate active contact ${contact.contact_id}; pass allowUpdate to replace`,
        );
      }
      file.contacts[index] = contact;
    } else {
      file.contacts.push(contact);
    }
    file.contacts.sort((a, b) => a.contact_id.localeCompare(b.contact_id));
    await this.writeStore(file);
    return contact;
  }

  async revoke(contactId: string, revokedAt = new Date().toISOString()): Promise<ContactRecord> {
    if (!CONTACT_ID_PATTERN.test(contactId)) throw new Error("Invalid contact_id");
    const file = await this.readStore();
    const index = file.contacts.findIndex((contact) => contact.contact_id === contactId);
    if (index < 0) throw new Error(`Unknown contact ${contactId}`);
    const revoked = validateContactRecord({
      ...file.contacts[index],
      trust_level: "revoked",
      revoked: true,
      revoked_at: revokedAt,
    });
    file.contacts[index] = revoked;
    await this.writeStore(file);
    return revoked;
  }

  private async readStore(): Promise<ContactStoreFile> {
    if (!existsSync(this.path)) return { contacts: [], used_invites: [] };
    const parsed = JSON.parse(await readFile(this.path, "utf8")) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray((parsed as ContactStoreFile).contacts)
    )
      throw new Error("Invalid contacts store");
    const usedInvitesInput = (parsed as Partial<ContactStoreFile>).used_invites ?? [];
    if (!Array.isArray(usedInvitesInput)) throw new Error("Invalid contacts store");
    const used_invites = usedInvitesInput.map((used) => {
      if (!used || typeof used !== "object" || Array.isArray(used)) throw new Error("Invalid used_invites");
      assertOnlyKeys(used as unknown as Record<string, unknown>, new Set(["invite_id", "nonce", "consumed_at"]), "used_invites");
      const record = used as UsedInviteRecord;
      assertString(record.invite_id, "invite_id");
      if (!UUID_PATTERN.test(record.invite_id)) throw new Error("Invalid invite_id");
      assertString(record.nonce, "nonce");
      assertIsoOrNull(record.consumed_at, "consumed_at");
      return { invite_id: record.invite_id, nonce: record.nonce, consumed_at: record.consumed_at };
    });
    return { contacts: (parsed as ContactStoreFile).contacts.map(validateContactRecord), used_invites };
  }

  private async writeStore(file: ContactStoreFile): Promise<void> {
    const contacts = file.contacts.map(validateContactRecord);
    const used_invites = file.used_invites;
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const tempPath = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(tempPath, `${JSON.stringify({ contacts, used_invites }, null, 2)}\n`, { mode: 0o600 });
      await rename(tempPath, this.path);
    } catch (error) {
      await unlink(tempPath).catch(() => undefined);
      throw error;
    }
  }
}
