import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { exportRawPublicKey, signCanonical, verifyCanonical } from "@agentcomms/protocol/node";
import {
  buildAgentCard,
  buildContactFromAgentCard,
  buildHumanCard,
  buildPairRequest,
  buildPairingInvite,
  contactFromPairingInvite,
  formatContactsList,
  pairingInviteLink,
  parsePairingInviteLink,
  parseTrustCardPayload,
  runPairingCli,
  renderTrustCard,
  renderPairingRunbook,
  signedAgentCardPayload,
  signedHumanCardPayload,
  signedPairingInvitePayload,
  signAgentCard,
  signHumanCard,
  signPairingInvite,
  summarizeAgentCard,
  summarizePairingInvite,
  summarizePairRequest,
  trustCardPayload,
  validateAgentCard,
  validateHumanCard,
  validatePairingInvite,
} from "../src/pairing.js";

async function tempPath(name: string): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "agentcomms-pairing-cli-")), name);
}

function makeSignedCard(overrides: Partial<Parameters<typeof buildAgentCard>[0]> = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const card = buildAgentCard({
    agentId: "agent:peer",
    displayName: "Peer Agent",
    relayUrl: "https://relay.example.test",
    publicKey: { alg: "ed25519", kid: "kid-peer", value: exportRawPublicKey(publicKey) },
    capabilities: ["chat", "status"],
    issuedAt: "2026-05-04T00:00:00.000Z",
    ...overrides,
  });
  return signAgentCard(card, privateKey);
}

function makeExactlySignedNoncanonicalCard(capabilities: readonly string[]) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const card = {
    ...buildAgentCard({
      agentId: "agent:noncanonical",
      displayName: "Noncanonical Agent",
      relayUrl: "https://relay.example.test",
      publicKey: {
        alg: "ed25519" as const,
        kid: "kid-noncanonical",
        value: exportRawPublicKey(publicKey),
      },
      capabilities: ["chat", "status"],
      issuedAt: "2026-05-04T00:00:00.000Z",
    }),
    capabilities: [...capabilities],
  };
  return {
    card: { ...card, signature: signCanonical(privateKey, signedAgentCardPayload(card)) },
    publicKey,
  };
}

function makeSignedHumanCard(overrides: Partial<Parameters<typeof buildHumanCard>[0]> = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const card = buildHumanCard({
    humanId: "human:operator",
    displayName: "Operator",
    relayUrl: "https://relay.example.test",
    publicKey: { alg: "ed25519", kid: "human-key-1", value: exportRawPublicKey(publicKey) },
    capabilities: ["chat", "status"],
    issuedAt: "2026-05-04T00:00:00.000Z",
    expiresAt: "2026-05-05T00:00:00.000Z",
    ...overrides,
  });
  return { card: signHumanCard(card, privateKey), publicKey, privateKey };
}

function makeSignedInvite(overrides: Partial<Parameters<typeof buildPairingInvite>[0]> = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const invite = buildPairingInvite({
    inviteId: "123e4567-e89b-12d3-a456-426614174000",
    mode: "human_to_human",
    issuer: { id: "human:operator", kind: "human", display_name: "Operator" },
    subject: { kind: "human", id: "human:friend", display_name: "Friend" },
    relayUrl: "https://relay.example.test",
    publicKey: { alg: "ed25519", kid: "invite-key-1", value: exportRawPublicKey(publicKey) },
    capabilities: ["status", "chat"],
    issuedAt: "2026-05-04T00:00:00.000Z",
    expiresAt: "2026-05-04T00:15:00.000Z",
    nonce: "nonce-abc",
    safetyCode: "ABCD-1234",
    ...overrides,
  });
  return { invite: signPairingInvite(invite, privateKey), publicKey, privateKey };
}

describe("pairing cli helpers", () => {
  it("signs and verifies human cards and rejects tampering or unknown fields", () => {
    const { card, publicKey } = makeSignedHumanCard();
    expect(card).toMatchObject({ type: "opencomms_human_card_v1", human_id: "human:operator", kind: "human" });
    expect(verifyCanonical(publicKey, signedHumanCardPayload(card), card.signature)).toBe(true);
    expect(() => validateHumanCard({ ...card, unexpected: true })).toThrow(/unknown/i);
    expect(() => validateHumanCard({ ...card, display_name: "Mallory" })).toThrow(/signature/i);
  });

  it("signs and verifies pairing invites for human, own-agent, and friend project modes", () => {
    const human = makeSignedInvite().invite;
    const ownAgent = makeSignedInvite({
      mode: "own_agent",
      subject: { kind: "agent", id: "agent:researcher", display_name: "Researcher" },
    }).invite;
    const project = makeSignedInvite({
      mode: "friend_project_agents",
      subject: { kind: "agent", id: "agent:researcher", display_name: "Researcher" },
      projectId: "project:reef",
      projectName: "Reef Ops",
      agentIds: ["agent:researcher"],
    }).invite;
    const projectHumanAdmin = makeSignedInvite({
      mode: "friend_project_agents",
      subject: { kind: "human", id: "human:admin", display_name: "Admin" },
      projectId: "project:reef",
      projectName: "Reef Ops",
      agentIds: ["agent:researcher"],
    }).invite;

    for (const invite of [human, ownAgent, project, projectHumanAdmin]) {
      expect(validatePairingInvite(invite, { now: "2026-05-04T00:10:00.000Z" }).signature).toBe(invite.signature);
      expect(() => validatePairingInvite({ ...invite, nonce: "changed" }, { now: "2026-05-04T00:10:00.000Z" })).toThrow(/signature/i);
    }
  });

  it("round-trips pairing invite links for app and web fallback transports", () => {
    const { invite } = makeSignedInvite();
    const appLink = pairingInviteLink(invite);
    const webLink = pairingInviteLink(invite, { webFallback: true });
    expect(appLink).toMatch(/^opencomms:\/\/pair\?invite=/);
    expect(webLink).toMatch(/^https:\/\/opencomms\.local\/pair#invite=/);
    expect(parsePairingInviteLink(appLink, { now: "2026-05-04T00:10:00.000Z" }).invite_id).toBe(invite.invite_id);
    expect(parsePairingInviteLink(webLink, { now: "2026-05-04T00:10:00.000Z" }).invite_id).toBe(invite.invite_id);
  });

  it("rejects expired invites at parse, import, and summary boundaries", () => {
    const { invite } = makeSignedInvite({ expiresAt: "2026-05-04T00:01:00.000Z" });
    const link = pairingInviteLink(invite);
    expect(() => parsePairingInviteLink(link, { now: "2026-05-04T00:02:00.000Z" })).toThrow(/expired/i);
    expect(() => summarizePairingInvite(link, { now: "2026-05-04T00:02:00.000Z" })).toThrow(/expired/i);
    expect(() => contactFromPairingInvite(invite, { now: "2026-05-04T00:02:00.000Z", trustLevel: "paired" })).toThrow(/expired/i);
  });

  it("requires project metadata for friend project invites and rejects unsafe capabilities", () => {
    expect(() => makeSignedInvite({ mode: "friend_project_agents", projectId: "project:reef", projectName: undefined, agentIds: ["agent:researcher"] })).toThrow(/project/i);
    expect(() => makeSignedInvite({ mode: "friend_project_agents", projectId: "project:reef", projectName: "Reef Ops", agentIds: [] })).toThrow(/agent_ids/i);
    expect(() => makeSignedInvite({ capabilities: ["chat", "tool_execute"] })).toThrow(/capabilities|restricted/i);
  });

  it("strictly validates pairing invite shape and signature metadata", () => {
    const { invite, privateKey } = makeSignedInvite();
    for (const bad of [
      { ...invite, signature: undefined },
      { ...invite, public_key: undefined },
      { ...invite, nonce: undefined },
      { ...invite, invite_id: "not-a-uuid" },
      { ...invite, issuer: { ...invite.issuer, kind: "agent" } },
      { ...invite, safety_code: 123 },
      { ...invite, capabilities: ["status", "chat"] },
    ]) {
      expect(() => validatePairingInvite(bad, { now: "2026-05-04T00:10:00.000Z" })).toThrow();
    }

    const humanWithProject = { ...invite, project_id: "project:reef" };
    expect(() =>
      validatePairingInvite(
        { ...humanWithProject, signature: signCanonical(privateKey, signedPairingInvitePayload(humanWithProject)) },
        { now: "2026-05-04T00:10:00.000Z" },
      ),
    ).toThrow(/human_to_human|project/i);

    const humanWithNullProjectFields = { ...invite, project_id: null, project_name: null, agent_ids: null };
    expect(
      validatePairingInvite(
        { ...humanWithNullProjectFields, signature: signCanonical(privateKey, signedPairingInvitePayload(humanWithNullProjectFields)) },
        { now: "2026-05-04T00:10:00.000Z" },
      ).invite_id,
    ).toBe(invite.invite_id);

    const ownAgentBase = buildPairingInvite({
      inviteId: "123e4567-e89b-12d3-a456-426614174001",
      mode: "own_agent",
      issuer: { id: "human:operator", kind: "human", display_name: "Operator" },
      subject: { kind: "agent", id: "agent:researcher", display_name: "Researcher" },
      relayUrl: "https://relay.example.test",
      publicKey: invite.public_key,
      capabilities: ["chat", "status"],
      issuedAt: "2026-05-04T00:00:00.000Z",
      expiresAt: "2026-05-04T00:15:00.000Z",
      nonce: "nonce-own-agent",
      safetyCode: "ABCD-1234",
    });
    const ownAgentWithProject = { ...ownAgentBase, project_id: "project:reef", project_name: "Reef Ops", agent_ids: ["agent:researcher"] };
    expect(() =>
      validatePairingInvite(
        { ...ownAgentWithProject, signature: signCanonical(privateKey, signedPairingInvitePayload(ownAgentWithProject)) },
        { now: "2026-05-04T00:10:00.000Z" },
      ),
    ).toThrow(/own_agent|project/i);

    const project = makeSignedInvite({
      mode: "friend_project_agents",
      subject: { kind: "agent", id: "agent:researcher", display_name: "Researcher" },
      projectId: "project:reef",
      projectName: "Reef Ops",
      agentIds: ["agent:a", "agent:b"],
    });
    const noncanonicalAgentIds = { ...project.invite, agent_ids: ["agent:b", "agent:a"] };
    expect(() =>
      validatePairingInvite(
        { ...noncanonicalAgentIds, signature: signCanonical(project.privateKey, noncanonicalAgentIds) },
        { now: "2026-05-04T00:10:00.000Z" },
      ),
    ).toThrow(/agent_ids/i);
  });

  it("summarizes invite text without leaking keys, signatures, bearer tokens, or transcripts", () => {
    const { invite } = makeSignedInvite({
      issuer: { id: "human:operator?token=REAL_TOKEN", kind: "human", display_name: "Bearer REAL_BEARER transcript: private notes" },
      subject: { kind: "human", id: "human:friend", display_name: "Friend" },
    });
    const summary = summarizePairingInvite(pairingInviteLink(invite), { now: "2026-05-04T00:10:00.000Z" });
    expect(summary).toContain("Safety code: ABCD-1234");
    expect(summary).not.toContain(invite.public_key.value);
    expect(summary).not.toContain(invite.signature);
    expect(summary).not.toMatch(/REAL_TOKEN|REAL_BEARER|private notes/i);
    expect(summary).toMatch(/\[REDACTED\]/);
  });

  it("builds contact-like records from human and project pairing invites", () => {
    const human = contactFromPairingInvite(makeSignedInvite().invite, { now: "2026-05-04T00:10:00.000Z", trustLevel: "paired" });
    const project = contactFromPairingInvite(makeSignedInvite({ mode: "friend_project_agents", subject: { kind: "agent", id: "agent:researcher", display_name: "Researcher" }, projectId: "project:reef", projectName: "Reef Ops", agentIds: ["agent:researcher"] }).invite, { now: "2026-05-04T00:10:00.000Z", trustLevel: "local_admin_approved" });
    expect(human).toMatchObject({ contact_id: "human:friend@invite-key-1", kind: "human" });
    expect(project).toMatchObject({
      contact_id: "project:reef/agent:researcher@invite-key-1",
      project_id: "project:reef",
      project_name: "Reef Ops",
      agent_ids: ["agent:researcher"],
      pairing_mode: "friend_project_agents",
      issuer_id: "human:operator",
      issuer_kind: "human",
      safety_code: "ABCD-1234",
    });
  });

  it("CLI import-invite consumes invite_id and nonce once, even after revocation", async () => {
    const contactsPath = await tempPath("contacts.json");
    const invitePath = await tempPath("invite.txt");
    const { invite } = makeSignedInvite();
    await writeFile(invitePath, pairingInviteLink(invite), "utf8");

    await expect(runPairingCli(["contacts", "import-invite", "--invite", invitePath, "--contacts-path", contactsPath, "--now", "2026-05-04T00:10:00.000Z"])).resolves.toBe("stored contact human:friend@invite-key-1\n");
    await expect(runPairingCli(["contacts", "import-invite", "--invite", invitePath, "--contacts-path", contactsPath, "--now", "2026-05-04T00:10:00.000Z", "--allow-update", "true"])).rejects.toThrow(/already used|consumed/i);
    await expect(runPairingCli(["contacts", "revoke", "human:friend@invite-key-1", "--contacts-path", contactsPath, "--now", "2026-05-04T00:11:00.000Z"])).resolves.toContain("revoked");
    await expect(runPairingCli(["contacts", "import-invite", "--invite", invitePath, "--contacts-path", contactsPath, "--now", "2026-05-04T00:12:00.000Z", "--allow-update", "true"])).rejects.toThrow(/already used|consumed/i);
  });

  it("creates deterministic signed v1 agent cards with pairing_endpoint and without secrets", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const card = buildAgentCard({
      agentId: "agent:local",
      displayName: "Local Agent",
      relayUrl: "https://relay.example.test",
      pairingEndpoint: "https://relay.example.test/pair",
      publicKey: { alg: "ed25519", kid: "kid-local", value: exportRawPublicKey(publicKey) },
      capabilities: ["status", "chat"],
      issuedAt: "2026-05-04T00:00:00.000Z",
      expiresAt: "2026-06-04T00:00:00.000Z",
    });
    const signed = signAgentCard(card, privateKey);

    expect(signed).toEqual({
      type: "opencomms_agent_card_v1",
      agent_id: "agent:local",
      display_name: "Local Agent",
      kind: "agent",
      relay_url: "https://relay.example.test",
      pairing_endpoint: "https://relay.example.test/pair",
      public_key: { alg: "ed25519", kid: "kid-local", value: exportRawPublicKey(publicKey) },
      capabilities: ["chat", "status"],
      issued_at: "2026-05-04T00:00:00.000Z",
      expires_at: "2026-06-04T00:00:00.000Z",
      signature: expect.any(String),
    });
    expect(verifyCanonical(publicKey, signedAgentCardPayload(signed), signed.signature)).toBe(true);
    expect(JSON.stringify(signed)).not.toMatch(/private|secret/i);
  });

  it("strictly rejects malformed cards and unknown top-level fields", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const card = signAgentCard(
      buildAgentCard({
        agentId: "agent:strict",
        displayName: "Strict Agent",
        relayUrl: "https://relay.example.test",
        publicKey: { alg: "ed25519", kid: "kid-strict", value: exportRawPublicKey(publicKey) },
        issuedAt: "2026-05-04T00:00:00.000Z",
      }),
      privateKey,
    );

    expect(() => validateAgentCard({ ...card, unexpected: true })).toThrow(/unknown/i);
    expect(() =>
      validateAgentCard({ ...card, public_key: { ...card.public_key, extra: true } }),
    ).toThrow(/public_key/i);
    expect(() => validateAgentCard({ ...card, pairing_endpoint: "not-a-url" })).toThrow(
      /pairing_endpoint/i,
    );
    expect(() => validateAgentCard({ ...card, signature: "" })).toThrow(/signature/i);
    expect(() =>
      validateAgentCard({
        ...card,
        public_key: { ...card.public_key, value: "not-a-raw-ed25519-key" },
      }),
    ).toThrow(/public_key/i);
    expect(() =>
      validateAgentCard({
        ...card,
        public_key: { ...card.public_key, value: "-----BEGIN PUBLIC KEY-----\nabc" },
      }),
    ).toThrow(/public_key/i);
  });

  it("cryptographically rejects bogus signatures and tampered signed card payloads", () => {
    const card = makeSignedCard();

    expect(() => validateAgentCard({ ...card, signature: "bogus" })).toThrow(/signature/i);
    expect(() => validateAgentCard({ ...card, display_name: "Mallory" })).toThrow(/signature/i);
    expect(() => validateAgentCard({ ...card, capabilities: ["chat"] })).toThrow(/signature/i);
  });

  it("rejects normalization-equivalent signed card capability tampering", () => {
    const card = makeSignedCard();
    const reordered = { ...card, capabilities: ["status", "chat"] };
    const duplicated = { ...card, capabilities: ["chat", "status", "status"] };

    for (const tampered of [reordered, duplicated]) {
      expect(() => validateAgentCard(tampered)).toThrow(/capabilities/i);
      expect(() => buildPairRequest({ card: tampered, nonce: "nonce-1" })).toThrow(/capabilities/i);
      expect(() =>
        buildContactFromAgentCard(tampered, {
          pairingId: "123e4567-e89b-12d3-a456-426614174000",
          grantedCapabilities: ["chat"],
          trustLevel: "local_admin_approved",
        }),
      ).toThrow(/capabilities/i);
    }
  });

  it("rejects exactly-signed noncanonical agent-card capabilities before normalization", () => {
    for (const capabilities of [
      ["status", "chat"],
      ["chat", "status", "status"],
    ]) {
      const { card, publicKey } = makeExactlySignedNoncanonicalCard(capabilities);
      expect(verifyCanonical(publicKey, signedAgentCardPayload(card), card.signature)).toBe(true);
      expect(() => validateAgentCard(card)).toThrow(/capabilities/i);
    }
  });

  it("imports a card into a contact record for explicit local approval", () => {
    const contact = buildContactFromAgentCard(makeSignedCard(), {
      pairingId: "123e4567-e89b-12d3-a456-426614174000",
      grantedCapabilities: ["status", "chat"],
      trustLevel: "local_admin_approved",
      now: "2026-05-04T01:00:00.000Z",
    });

    expect(contact).toMatchObject({
      contact_id: "agent:peer@kid-peer",
      agent_id: "agent:peer",
      granted_capabilities: ["chat", "status"],
      trust_level: "local_admin_approved",
      last_seen: null,
      revoked: false,
      revoked_at: null,
    });
  });

  it("builds deterministic local pair-request frames", () => {
    const card = makeSignedCard({ capabilities: undefined });

    expect(
      buildPairRequest({
        card,
        nonce: "nonce-1",
        requestedAt: "2026-05-04T03:00:00.000Z",
        requestedCapabilities: ["status", "chat"],
      }),
    ).toMatchObject({
      type: "opencomms_pair_request_v1",
      nonce: "nonce-1",
      requested_at: "2026-05-04T03:00:00.000Z",
      requested_capabilities: ["chat", "status"],
      card,
    });
  });

  it("buildPairRequest rejects expired signed cards at request time", () => {
    const expired = makeSignedCard({ expiresAt: "2026-05-04T02:59:59.999Z" });

    expect(() =>
      buildPairRequest({
        card: expired,
        nonce: "nonce-expired-request",
        requestedAt: "2026-05-04T03:00:00.000Z",
        requestedCapabilities: ["chat"],
      }),
    ).toThrow(/expired/i);
  });

  it("CLI request rejects expired signed cards", async () => {
    const cardPath = await tempPath("expired-request-card.json");
    await writeFile(
      cardPath,
      `${JSON.stringify(makeSignedCard({ expiresAt: "2026-05-04T02:59:59.999Z" }))}\n`,
      "utf8",
    );

    await expect(
      runPairingCli([
        "request",
        "--card",
        cardPath,
        "--nonce",
        "nonce-expired-cli-request",
        "--requested-at",
        "2026-05-04T03:00:00.000Z",
      ]),
    ).rejects.toThrow(/expired/i);
  });

  it("runs create-card, request, approve, contacts list/revoke against a temp contacts path", async () => {
    const cardPath = await tempPath("card.json");
    const requestPath = await tempPath("request.json");
    const contactsPath = await tempPath("contacts.json");
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const privateKeyPath = await tempPath("private.pem");
    await writeFile(
      privateKeyPath,
      privateKey.export({ type: "pkcs8", format: "pem" }) as string,
      "utf8",
    );

    await expect(
      runPairingCli([
        "create-card",
        "--agent-id",
        "agent:peer",
        "--display-name",
        "Peer Agent",
        "--relay-url",
        "https://relay.example.test",
        "--pairing-endpoint",
        "https://relay.example.test/pair",
        "--public-key-kid",
        "kid-peer",
        "--public-key",
        exportRawPublicKey(publicKey),
        "--capabilities",
        "status,chat",
        "--issued-at",
        "2026-05-04T00:00:00.000Z",
        "--private-key-file",
        privateKeyPath,
        "--out",
        cardPath,
      ]),
    ).resolves.toContain("opencomms_agent_card_v1");
    const storedCard = JSON.parse(await readFile(cardPath, "utf8"));
    expect(storedCard).toMatchObject({
      agent_id: "agent:peer",
      pairing_endpoint: "https://relay.example.test/pair",
      signature: expect.any(String),
    });
    expect(
      verifyCanonical(publicKey, signedAgentCardPayload(storedCard), storedCard.signature),
    ).toBe(true);

    await expect(
      runPairingCli([
        "request",
        "--card",
        cardPath,
        "--nonce",
        "nonce-cli-1",
        "--requested-at",
        "2026-05-04T00:30:00.000Z",
        "--capabilities",
        "status,chat",
        "--out",
        requestPath,
      ]),
    ).resolves.toContain("opencomms_pair_request_v1");
    await expect(readFile(requestPath, "utf8")).resolves.toContain("nonce-cli-1");

    await expect(
      runPairingCli([
        "approve",
        "--request",
        requestPath,
        "--contacts-path",
        contactsPath,
        "--pairing-id",
        "123e4567-e89b-12d3-a456-426614174000",
        "--grant",
        "chat,status",
        "--trust-level",
        "local_admin_approved",
        "--now",
        "2026-05-04T01:00:00.000Z",
      ]),
    ).resolves.toBe("stored contact agent:peer@kid-peer\n");

    await expect(
      runPairingCli(["contacts", "list", "--contacts-path", contactsPath]),
    ).resolves.toBe(
      "agent:peer@kid-peer\tagent:peer\tPeer Agent\tlocal_admin_approved\tchat,status\thttps://relay.example.test\n",
    );
    await expect(
      runPairingCli([
        "contacts",
        "revoke",
        "agent:peer@kid-peer",
        "--contacts-path",
        contactsPath,
        "--now",
        "2026-05-04T02:00:00.000Z",
      ]),
    ).resolves.toBe("revoked contact agent:peer@kid-peer\n");
    await expect(
      runPairingCli(["contacts", "list", "--contacts-path", contactsPath]),
    ).resolves.toBe("");
  });

  it("CLI request, approve, and contacts import-card reject forged or tampered cards", async () => {
    const contactsPath = await tempPath("contacts.json");
    const cardPath = await tempPath("forged-card.json");
    const requestPath = await tempPath("forged-request.json");
    const forged = { ...makeSignedCard(), display_name: "Forged Peer" };
    await writeFile(cardPath, `${JSON.stringify(forged)}\n`, "utf8");
    await writeFile(
      requestPath,
      `${JSON.stringify({
        type: "opencomms_pair_request_v1",
        card: forged,
        nonce: "nonce-forged",
        requested_at: "2026-05-04T00:30:00.000Z",
        requested_capabilities: ["chat"],
      })}\n`,
      "utf8",
    );

    await expect(
      runPairingCli(["request", "--card", cardPath, "--nonce", "nonce-1"]),
    ).rejects.toThrow(/signature/i);
    await expect(
      runPairingCli([
        "approve",
        "--request",
        requestPath,
        "--contacts-path",
        contactsPath,
        "--pairing-id",
        "123e4567-e89b-12d3-a456-426614174000",
        "--grant",
        "chat",
        "--trust-level",
        "local_admin_approved",
      ]),
    ).rejects.toThrow(/signature/i);
    await expect(
      runPairingCli([
        "contacts",
        "import-card",
        "--card",
        cardPath,
        "--contacts-path",
        contactsPath,
        "--pairing-id",
        "123e4567-e89b-12d3-a456-426614174000",
        "--grant",
        "chat",
        "--trust-level",
        "local_admin_approved",
      ]),
    ).rejects.toThrow(/signature/i);
  });

  it("CLI request, approve, and contacts import-card reject normalization-equivalent card tampering", async () => {
    const contactsPath = await tempPath("contacts.json");
    const card = makeSignedCard();

    for (const [name, tampered] of [
      ["reordered", { ...card, capabilities: ["status", "chat"] }],
      ["duplicated", { ...card, capabilities: ["chat", "status", "status"] }],
    ] as const) {
      const cardPath = await tempPath(`${name}-card.json`);
      const requestPath = await tempPath(`${name}-request.json`);
      await writeFile(cardPath, `${JSON.stringify(tampered)}\n`, "utf8");
      await writeFile(
        requestPath,
        `${JSON.stringify({
          type: "opencomms_pair_request_v1",
          card: tampered,
          nonce: `nonce-${name}`,
          requested_at: "2026-05-04T00:30:00.000Z",
          requested_capabilities: ["chat"],
        })}\n`,
        "utf8",
      );

      await expect(
        runPairingCli(["request", "--card", cardPath, "--nonce", `nonce-request-${name}`]),
      ).rejects.toThrow(/capabilities/i);
      await expect(
        runPairingCli([
          "approve",
          "--request",
          requestPath,
          "--contacts-path",
          contactsPath,
          "--pairing-id",
          "123e4567-e89b-12d3-a456-426614174000",
          "--grant",
          "chat",
          "--trust-level",
          "local_admin_approved",
        ]),
      ).rejects.toThrow(/capabilities/i);
      await expect(
        runPairingCli([
          "contacts",
          "import-card",
          "--card",
          cardPath,
          "--contacts-path",
          contactsPath,
          "--pairing-id",
          "123e4567-e89b-12d3-a456-426614174000",
          "--grant",
          "chat",
          "--trust-level",
          "local_admin_approved",
        ]),
      ).rejects.toThrow(/capabilities/i);
    }
  });

  it("CLI request rejects exactly-signed noncanonical agent-card capabilities", async () => {
    for (const [name, capabilities] of [
      ["reordered", ["status", "chat"]],
      ["duplicated", ["chat", "status", "status"]],
    ] as const) {
      const cardPath = await tempPath(`${name}-exact-card.json`);
      const { card, publicKey } = makeExactlySignedNoncanonicalCard(capabilities);
      expect(verifyCanonical(publicKey, signedAgentCardPayload(card), card.signature)).toBe(true);
      await writeFile(cardPath, `${JSON.stringify(card)}\n`, "utf8");

      await expect(
        runPairingCli(["request", "--card", cardPath, "--nonce", `nonce-exact-${name}`]),
      ).rejects.toThrow(/capabilities/i);
    }
  });

  it("CLI approve rejects pair requests with unknown top-level fields", async () => {
    const contactsPath = await tempPath("contacts.json");
    const requestPath = await tempPath("request-with-extra.json");
    await writeFile(
      requestPath,
      `${JSON.stringify({
        type: "opencomms_pair_request_v1",
        card: makeSignedCard(),
        nonce: "nonce-extra",
        requested_at: "2026-05-04T00:30:00.000Z",
        requested_capabilities: ["chat"],
        extra: true,
      })}\n`,
      "utf8",
    );

    await expect(
      runPairingCli([
        "approve",
        "--request",
        requestPath,
        "--contacts-path",
        contactsPath,
        "--pairing-id",
        "123e4567-e89b-12d3-a456-426614174000",
        "--grant",
        "chat",
        "--trust-level",
        "local_admin_approved",
      ]),
    ).rejects.toThrow(/unknown pair request/i);
  });

  it("create-card rejects malformed public keys before output", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const privateKeyPath = await tempPath("private.pem");
    await writeFile(
      privateKeyPath,
      privateKey.export({ type: "pkcs8", format: "pem" }) as string,
      "utf8",
    );

    await expect(
      runPairingCli([
        "create-card",
        "--agent-id",
        "agent:bad",
        "--display-name",
        "Bad Agent",
        "--relay-url",
        "https://relay.example.test",
        "--public-key-kid",
        "kid-bad",
        "--public-key",
        "not-a-raw-ed25519-key",
        "--private-key-file",
        privateKeyPath,
      ]),
    ).rejects.toThrow(/public_key/i);
  });

  it("formats empty contacts lists deterministically", () => {
    expect(formatContactsList([])).toBe("");
  });

  it("summarizes signed agent cards and pair requests without leaking secrets", () => {
    const card = makeSignedCard({ expiresAt: "2026-06-04T00:00:00.000Z" });
    const request = buildPairRequest({
      card,
      nonce: "nonce-summary",
      requestedAt: "2026-05-04T03:00:00.000Z",
      requestedCapabilities: ["chat"],
    });

    const cardSummary = summarizeAgentCard(card, { now: "2026-05-04T04:00:00.000Z" });
    const requestSummary = summarizePairRequest(request, { now: "2026-05-04T04:00:00.000Z" });

    expect(cardSummary).toContain("OpenComms pairing summary");
    expect(cardSummary).toContain("Display name: Peer Agent");
    expect(cardSummary).toContain("Agent ID: agent:peer");
    expect(cardSummary).toContain("Relay host: relay.example.test");
    expect(cardSummary).toContain("Key: kid-peer");
    expect(cardSummary).toContain("Capabilities: chat, status");
    expect(cardSummary).toContain("Valid: yes");
    expect(requestSummary).toContain("Kind: pair request");
    expect(requestSummary).toContain("Requested capabilities: chat");
    for (const output of [cardSummary, requestSummary]) {
      expect(output).not.toMatch(/private|secret|bearer|token|BEGIN PRIVATE KEY|transcript/i);
      expect(output).not.toContain(card.public_key.value);
      expect(output).not.toContain(card.signature);
    }
  });

  it("redacts token-like signed identity fields from summaries", () => {
    const card = makeSignedCard({
      displayName: "Peer Agent Bearer REAL_BEARER_TOKEN transcript: private meeting notes",
      agentId: "agent:peer?token=REAL_AGENT_TOKEN",
      expiresAt: "2026-06-04T00:00:00.000Z",
    });

    const summary = summarizeAgentCard(card, { now: "2026-05-04T04:00:00.000Z" });

    expect(summary).toContain("Display name:");
    expect(summary).toContain("Agent ID:");
    expect(summary).not.toContain("REAL_BEARER_TOKEN");
    expect(summary).not.toContain("REAL_AGENT_TOKEN");
    expect(summary).not.toContain("private meeting notes");
    expect(summary).not.toMatch(/bearer\s+REAL|token=REAL|transcript:\s*private/i);
    expect(summary).toMatch(/\[REDACTED\]/);
  });

  it("fails closed for trust-card export/import when signed fields can carry bearer tokens or transcripts", () => {
    const unsafeDisplay = makeSignedCard({
      displayName: "Bearer REAL_BEARER_TOKEN transcript: private room log",
      expiresAt: "2026-06-04T00:00:00.000Z",
    });
    const unsafeRelay = makeSignedCard({
      relayUrl: "https://relay.example.test/path?token=REAL_RELAY_TOKEN#private-fragment",
      expiresAt: "2026-06-04T00:00:00.000Z",
    });

    for (const card of [unsafeDisplay, unsafeRelay]) {
      expect(() => trustCardPayload(card, { now: "2026-05-04T04:00:00.000Z" })).toThrow(/unsafe|secret|query|fragment|transcript|token|bearer/i);
      expect(() => renderTrustCard(card, { now: "2026-05-04T04:00:00.000Z" })).toThrow(/unsafe|secret|query|fragment|transcript|token|bearer/i);
    }

    const safe = makeSignedCard({ expiresAt: "2026-06-04T00:00:00.000Z" });
    const decoded = JSON.parse(
      Buffer.from(
        new URL(trustCardPayload(safe, { now: "2026-05-04T04:00:00.000Z" })).searchParams.get("card")!,
        "base64url",
      ).toString("utf8"),
    );
    expect(JSON.stringify(decoded)).not.toMatch(/token|bearer|transcript|private/i);

    const injected = new URL(trustCardPayload(safe, { now: "2026-05-04T04:00:00.000Z" }));
    injected.searchParams.set("card", Buffer.from(JSON.stringify(unsafeRelay), "utf8").toString("base64url"));
    expect(() => parseTrustCardPayload(injected.toString(), { now: "2026-05-04T04:00:00.000Z" })).toThrow(/unsafe|secret|query|fragment|token/i);
  });

  it("rejects expired signed cards at contact build, approve, and contacts import-card boundaries", async () => {
    const expired = makeSignedCard({ expiresAt: "2026-05-01T00:00:00.000Z" });
    expect(() =>
      buildContactFromAgentCard(expired, {
        pairingId: "123e4567-e89b-12d3-a456-426614174000",
        grantedCapabilities: ["chat"],
        trustLevel: "local_admin_approved",
        now: "2026-05-04T04:00:00.000Z",
      }),
    ).toThrow(/expired/i);

    const contactsPath = await tempPath("contacts.json");
    const cardPath = await tempPath("expired-card.json");
    const requestPath = await tempPath("expired-request.json");
    await writeFile(cardPath, `${JSON.stringify(expired)}\n`, "utf8");
    await writeFile(
      requestPath,
      `${JSON.stringify({
        type: "opencomms_pair_request_v1",
        card: expired,
        nonce: "nonce-expired",
        requested_at: "2026-05-04T00:30:00.000Z",
        requested_capabilities: ["chat"],
      })}\n`,
      "utf8",
    );

    for (const args of [
      ["approve", "--card", cardPath],
      ["approve", "--request", requestPath],
      ["contacts", "import-card", "--card", cardPath],
    ]) {
      await expect(
        runPairingCli([
          ...args,
          "--contacts-path",
          contactsPath,
          "--pairing-id",
          "123e4567-e89b-12d3-a456-426614174000",
          "--grant",
          "chat",
          "--trust-level",
          "local_admin_approved",
          "--now",
          "2026-05-04T04:00:00.000Z",
        ]),
      ).rejects.toThrow(/expired/i);
    }
  });

  it("returns actionable manual import errors for expired, wrong kind, malformed, unsafe, and tampered payloads", () => {
    const importNow = "2026-05-04T04:00:00.000Z";
    const expired = makeSignedCard({ expiresAt: "2026-05-01T00:00:00.000Z" });
    expect(() => summarizeAgentCard(expired, { now: importNow })).toThrow(/expired/i);
    expect(() => summarizeAgentCard({ ...makeSignedCard(), kind: "human" }, { now: importNow })).toThrow(/wrong kind|kind/i);
    expect(() => summarizePairRequest("{" as unknown, { now: importNow })).toThrow(/malformed|invalid pair request/i);
    expect(() =>
      summarizePairRequest(
        { ...buildPairRequest({ card: makeSignedCard(), nonce: "n" }), requested_capabilities: ["tool_execute"] },
        { now: importNow },
      ),
    ).toThrow(/unsafe|restricted|capabilities/i);
    expect(() => summarizeAgentCard({ ...makeSignedCard(), display_name: "Tampered" }, { now: importNow })).toThrow(
      /signature|tamper/i,
    );
  });

  it("renders an installed-agent runbook for QR/contact artifact generation", () => {
    const runbook = renderPairingRunbook({
      agentId: "monolith",
      repoDir: "/opt/agentcomms",
      outputDir: "/Users/tester/.agentcomms/pairing",
    });

    expect(runbook).toContain("OpenComms installed-agent pairing runbook");
    expect(runbook).toContain("cd /opt/agentcomms");
    expect(runbook).toContain("monolith-card.json");
    expect(runbook).toContain("agentcomms trust-card --card /Users/tester/.agentcomms/pairing/monolith-card.json");
    expect(runbook).toContain("opencomms://pair");
    expect(runbook).toContain("qrencode");
    expect(runbook).toContain("If key material/card is missing, say exactly what is missing");
    expect(runbook).not.toMatch(/BEGIN PRIVATE KEY|Bearer [A-Za-z0-9._-]+|Authorization:|token=/i);
  });

  it("exposes the QR/contact runbook through the pairing CLI", async () => {
    const output = await runPairingCli([
      "pairing-runbook",
      "--agent-id",
      "monolith",
      "--repo-dir",
      "/opt/agentcomms",
      "--output-dir",
      "/Users/tester/.agentcomms/pairing",
    ]);

    expect(output).toContain("OpenComms installed-agent pairing runbook");
    expect(output).toContain("monolith-opencomms-pairing.txt");
    expect(output).toContain("opencomms://pair");
    expect(output).toContain("qrencode");
  });

  it("renders and parses versioned QR-ready trust cards and rejects tampering", () => {
    const card = makeSignedCard({ expiresAt: "2026-06-04T00:00:00.000Z" });
    const rendered = renderTrustCard(card, { now: "2026-05-04T04:00:00.000Z" });

    expect(rendered.text).toContain("OpenComms trust card");
    expect(rendered.text).toContain("Kind: agent");
    expect(rendered.text).toContain("Compare code:");
    expect(rendered.uri).toMatch(/^opencomms:\/\/pair\?v=1&card=/);
    expect(JSON.stringify(rendered)).not.toMatch(/private|secret|bearer|token|BEGIN PRIVATE KEY/i);
    expect(JSON.stringify(rendered)).not.toContain(card.public_key.value);
    expect(JSON.stringify(rendered)).not.toContain(card.signature);

    const parsed = parseTrustCardPayload(rendered.uri, { now: "2026-05-04T04:00:00.000Z" });
    expect(parsed.card.agent_id).toBe("agent:peer");
    expect(parsed.compareCode).toBe(rendered.compareCode);
    expect(trustCardPayload(card, { now: "2026-05-04T04:00:00.000Z" })).toBe(rendered.uri);

    const url = new URL(rendered.uri);
    url.searchParams.set("v", "99");
    expect(() => parseTrustCardPayload(url.toString(), { now: "2026-05-04T04:00:00.000Z" })).toThrow(/version/i);
    expect(() => parseTrustCardPayload("opencomms://pair?v=1&card=not-json", { now: "2026-05-04T04:00:00.000Z" })).toThrow(/malformed/i);
    const tampered = new URL(rendered.uri);
    const payload = JSON.parse(Buffer.from(tampered.searchParams.get("card")!, "base64url").toString("utf8"));
    payload.display_name = "Mallory";
    tampered.searchParams.set("card", Buffer.from(JSON.stringify(payload), "utf8").toString("base64url"));
    expect(() => parseTrustCardPayload(tampered.toString(), { now: "2026-05-04T04:00:00.000Z" })).toThrow(/signature|tamper/i);
  });
});
