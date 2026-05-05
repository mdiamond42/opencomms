import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { ContactStore, defaultContactsPath, validateContactRecord } from "../src/contacts.js";

const VALID_RAW_ED25519_PUBLIC_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const sampleContact = {
  contact_id: "agent:example@kid-123",
  agent_id: "agent:example",
  display_name: "Example Agent",
  kind: "agent" as const,
  relay_url: "https://relay.example.test",
  public_key: { alg: "ed25519" as const, kid: "kid-123", value: VALID_RAW_ED25519_PUBLIC_KEY },
  pairing_id: "123e4567-e89b-12d3-a456-426614174000",
  trust_level: "paired" as const,
  granted_capabilities: ["chat", "status"],
  created_at: "2026-05-04T00:00:00.000Z",
  last_seen: null,
  last_seen_at: null,
  revoked: false,
  revoked_at: null,
};

async function tempStorePath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "agentcomms-contacts-")), "contacts.json");
}

describe("ContactStore", () => {
  it("loads a missing store as empty and uses the local default path", async () => {
    expect(defaultContactsPath({ HOME: "/tmp/test-home" })).toBe(
      "/tmp/test-home/.agentcomms/contacts.json",
    );
    const store = new ContactStore(await tempStorePath());
    await expect(store.list()).resolves.toEqual([]);
  });

  it("upserts and persists a contact with atomic-ish json writes", async () => {
    const path = await tempStorePath();
    const store = new ContactStore(path);
    await store.upsert(sampleContact);

    await expect(new ContactStore(path).get(sampleContact.contact_id)).resolves.toMatchObject({
      contact_id: sampleContact.contact_id,
      last_seen: null,
      revoked: false,
      revoked_at: null,
    });
    await expect(readFile(path, "utf8")).resolves.toContain("agent:example");
  });

  it("rejects duplicate active contacts unless allowUpdate is explicit", async () => {
    const store = new ContactStore(await tempStorePath());
    await store.upsert(sampleContact);
    await expect(store.upsert({ ...sampleContact, display_name: "Renamed" })).rejects.toThrow(
      /duplicate active contact/i,
    );
    await store.upsert({ ...sampleContact, display_name: "Renamed" }, { allowUpdate: true });
    await expect(store.get(sampleContact.contact_id)).resolves.toMatchObject({
      display_name: "Renamed",
    });
  });

  it("revokes contacts without deleting them", async () => {
    const store = new ContactStore(await tempStorePath());
    await store.upsert(sampleContact);
    await store.revoke(sampleContact.contact_id, "2026-05-04T01:00:00.000Z");
    await expect(store.get(sampleContact.contact_id)).resolves.toMatchObject({
      trust_level: "revoked",
      revoked: true,
      revoked_at: "2026-05-04T01:00:00.000Z",
    });
    await expect(store.list({ includeRevoked: true })).resolves.toHaveLength(1);
    await expect(store.list()).resolves.toEqual([]);
  });

  it("validates ids and refuses private key material", async () => {
    const store = new ContactStore(await tempStorePath());
    await expect(store.upsert({ ...sampleContact, contact_id: "bad id" })).rejects.toThrow(
      /contact_id/i,
    );
    await expect(
      store.upsert({ ...sampleContact, private_key: "secret" } as never),
    ).rejects.toThrow(/private key|unknown/i);
  });

  it("strictly rejects unknown fields and malformed public keys", () => {
    expect(() => validateContactRecord({ ...sampleContact, unexpected: true })).toThrow(/unknown/i);
    expect(() =>
      validateContactRecord({
        ...sampleContact,
        public_key: { ...sampleContact.public_key, extra: true },
      }),
    ).toThrow(/public_key/i);
    expect(() =>
      validateContactRecord({
        ...sampleContact,
        public_key: { ...sampleContact.public_key, value: "not-a-raw-ed25519-key" },
      }),
    ).toThrow(/public_key/i);
    expect(() =>
      validateContactRecord({
        ...sampleContact,
        public_key: { ...sampleContact.public_key, value: "PRIVATE_KEY_MARKER\nabc" },
      }),
    ).toThrow(/public_key|private key/i);

    const normalized = validateContactRecord({ ...sampleContact, notes: "ok" });
    expect(normalized).toEqual({ ...sampleContact, notes: "ok" });
    expect(normalized).not.toHaveProperty("unexpected");
  });

  it("validates and persists structured project trust metadata and consumed invites", async () => {
    const projectContact = validateContactRecord({
      ...sampleContact,
      contact_id: "project:reef/agent:example@kid-123",
      project_id: "project:reef",
      project_name: "Reef Ops",
      agent_ids: ["agent:example"],
      pairing_mode: "friend_project_agents",
      issuer_id: "human:operator",
      issuer_kind: "human",
      safety_code: "ABCD-1234",
    });
    expect(projectContact).toMatchObject({
      project_id: "project:reef",
      pairing_mode: "friend_project_agents",
      issuer_kind: "human",
    });

    const path = await tempStorePath();
    const store = new ContactStore(path);
    expect(await store.hasUsedInvite("123e4567-e89b-12d3-a456-426614174000", "nonce-abc")).toBe(false);
    await store.upsert(projectContact);
    await store.markInviteUsed("123e4567-e89b-12d3-a456-426614174000", "nonce-abc");
    expect(await new ContactStore(path).hasUsedInvite("123e4567-e89b-12d3-a456-426614174000", "nonce-abc")).toBe(true);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      used_invites: [{ invite_id: "123e4567-e89b-12d3-a456-426614174000", nonce: "nonce-abc" }],
    });
  });

  it("rejects malformed structured project trust metadata", () => {
    expect(() => validateContactRecord({ ...sampleContact, pairing_mode: "unknown" })).toThrow(/pairing_mode/i);
    expect(() => validateContactRecord({ ...sampleContact, issuer_kind: "agent" })).toThrow(/issuer_kind/i);
    expect(() => validateContactRecord({ ...sampleContact, agent_ids: ["agent:ok", 1] })).toThrow(/agent_ids/i);
    expect(() =>
      validateContactRecord({
        ...sampleContact,
        pairing_mode: "friend_project_agents",
        project_name: "Reef Ops",
        agent_ids: ["agent:example"],
      }),
    ).toThrow(/project_id/i);
    expect(() =>
      validateContactRecord({
        ...sampleContact,
        pairing_mode: "friend_project_agents",
        project_id: "project:reef",
        agent_ids: ["agent:example"],
      }),
    ).toThrow(/project_name/i);
    expect(() =>
      validateContactRecord({
        ...sampleContact,
        pairing_mode: "friend_project_agents",
        project_id: "project:reef",
        project_name: "Reef Ops",
      }),
    ).toThrow(/agent_ids/i);
  });

  it("normalizes legacy last_seen_at and revoked_at fields to spec-required fields", async () => {
    const path = await tempStorePath();
    await writeFile(
      path,
      JSON.stringify({
        contacts: [
          {
            ...sampleContact,
            last_seen: undefined,
            last_seen_at: "2026-05-04T00:30:00.000Z",
            revoked: undefined,
            revoked_at: "2026-05-04T01:00:00.000Z",
          },
        ],
      }),
      "utf8",
    );

    await expect(new ContactStore(path).get(sampleContact.contact_id)).resolves.toMatchObject({
      last_seen: "2026-05-04T00:30:00.000Z",
      last_seen_at: "2026-05-04T00:30:00.000Z",
      revoked: true,
      revoked_at: "2026-05-04T01:00:00.000Z",
    });
  });
});
