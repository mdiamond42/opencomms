import { describe, expect, it } from "vitest";
import { exportRawPublicKey, generateAgentKeyPair } from "@agentcomms/protocol/node";
import type { ContactRecord } from "../src/contacts.js";
import {
  AckTracker,
  PresenceTracker,
  buildPresenceFrame,
  createBackoff,
  createObservabilitySnapshot,
  verifyPresenceFrame,
} from "../src/presence.js";

const now = "2026-05-04T12:00:00.000Z";
const later = "2026-05-04T12:00:10.000Z";

function contactFor(agentId: string, publicKey: string, revoked = false): ContactRecord {
  return {
    contact_id: `${agentId}@kid-1`,
    agent_id: agentId,
    display_name: agentId,
    kind: "agent",
    relay_url: "opencomms://local",
    public_key: { alg: "ed25519", kid: "kid-1", value: publicKey },
    pairing_id: "123e4567-e89b-12d3-a456-426614174000",
    trust_level: revoked ? "revoked" : "paired",
    granted_capabilities: ["presence"],
    created_at: "2026-05-04T00:00:00.000Z",
    last_seen: null,
    last_seen_at: null,
    revoked,
    revoked_at: revoked ? "2026-05-04T01:00:00.000Z" : null,
  };
}

describe("signed OpenComms v1 presence frames", () => {
  it("builds and verifies a signed heartbeat frame for a trusted contact", () => {
    const keys = generateAgentKeyPair();
    const contact = contactFor("agent:peer", exportRawPublicKey(keys.publicKey));
    const frame = buildPresenceFrame({
      agentId: "agent:peer",
      privateKey: keys.privateKey,
      keyId: "kid-1",
      status: "heartbeat",
      sequence: 7,
      issuedAt: now,
      expiresAt: "2026-05-04T12:01:00.000Z",
      capabilities: ["chat", "presence"],
      message: "ready",
    });

    expect(frame.type).toBe("opencomms_a2a_presence_v1");
    expect(verifyPresenceFrame(frame, contact, { now: later })).toMatchObject({
      agent_id: "agent:peer",
      sequence: 7,
      status: "heartbeat",
      capabilities: ["chat", "presence"],
      message: "ready",
    });
  });

  it("rejects tampering, unknown fields, expired/future-skewed frames, revoked contacts, mismatched agents, and malformed signatures", () => {
    const keys = generateAgentKeyPair();
    const other = generateAgentKeyPair();
    const contact = contactFor("agent:peer", exportRawPublicKey(keys.publicKey));
    const frame = buildPresenceFrame({
      agentId: "agent:peer",
      privateKey: keys.privateKey,
      keyId: "kid-1",
      status: "online",
      sequence: 1,
      issuedAt: now,
      expiresAt: "2026-05-04T12:01:00.000Z",
    });

    expect(() =>
      verifyPresenceFrame({ ...frame, status: "offline" }, contact, { now: later }),
    ).toThrow(/signature/i);
    expect(() => verifyPresenceFrame({ ...frame, extra: true }, contact, { now: later })).toThrow(
      /unknown/i,
    );
    expect(() => verifyPresenceFrame(frame, contact, { now: "2026-05-04T12:02:00.000Z" })).toThrow(
      /expired/i,
    );
    expect(() => verifyPresenceFrame(frame, contact, { now: "2026-05-04T11:58:00.000Z" })).toThrow(
      /future/i,
    );
    expect(() =>
      verifyPresenceFrame(
        frame,
        contactFor("agent:peer", exportRawPublicKey(keys.publicKey), true),
        { now: later },
      ),
    ).toThrow(/revoked/i);
    expect(() =>
      verifyPresenceFrame(frame, contactFor("agent:other", exportRawPublicKey(keys.publicKey)), {
        now: later,
      }),
    ).toThrow(/agent_id/i);
    expect(() =>
      verifyPresenceFrame(frame, contactFor("agent:peer", exportRawPublicKey(other.publicKey)), {
        now: later,
      }),
    ).toThrow(/signature/i);
    expect(() =>
      verifyPresenceFrame(
        { ...frame, signature: { ...frame.signature, value: "not-base64url" } },
        contact,
        { now: later },
      ),
    ).toThrow(/signature/i);
  });

  it("rejects malformed contact public keys, invalid contact key algs, signature extras, invalid statuses, replay sequences, and malformed dates", () => {
    const keys = generateAgentKeyPair();
    const contact = contactFor("agent:peer", exportRawPublicKey(keys.publicKey));
    const frame = buildPresenceFrame({
      agentId: "agent:peer",
      privateKey: keys.privateKey,
      keyId: "kid-1",
      status: "online",
      sequence: 5,
      issuedAt: now,
      expiresAt: "2026-05-04T12:01:00.000Z",
    });

    expect(() =>
      verifyPresenceFrame(frame, contactFor("agent:peer", "not-a-public-key"), { now: later }),
    ).toThrow(/public key/i);
    expect(() =>
      verifyPresenceFrame(
        frame,
        { ...contact, public_key: { ...contact.public_key, alg: "rsa" as "ed25519" } },
        { now: later },
      ),
    ).toThrow(/public_key|public key|alg/i);
    expect(() =>
      verifyPresenceFrame({ ...frame, signature: { ...frame.signature, extra: true } }, contact, {
        now: later,
      }),
    ).toThrow(/unknown/i);
    expect(() =>
      verifyPresenceFrame({ ...frame, status: "degraded" }, contact, { now: later }),
    ).toThrow(/status/i);
    expect(() =>
      verifyPresenceFrame(frame, contact, { now: later, minSequenceExclusive: 5 }),
    ).toThrow(/replay|sequence/i);
    expect(() =>
      verifyPresenceFrame({ ...frame, issued_at: "not-a-date" }, contact, { now: later }),
    ).toThrow(/issued_at/i);
    expect(() =>
      verifyPresenceFrame({ ...frame, expires_at: now }, contact, { now: later }),
    ).toThrow(/expires_at|expired/i);
  });

  it("rejects lossy optional undefined, hidden/symbol/accessor props, non-string status, and NaN clocks", () => {
    const keys = generateAgentKeyPair();
    const contact = contactFor("agent:peer", exportRawPublicKey(keys.publicKey));
    const frame = buildPresenceFrame({
      agentId: "agent:peer",
      privateKey: keys.privateKey,
      keyId: "kid-1",
      status: "online",
      sequence: 6,
      issuedAt: now,
      expiresAt: "2026-05-04T12:01:00.000Z",
    });

    expect(() =>
      verifyPresenceFrame({ ...frame, capabilities: undefined }, contact, { now: later }),
    ).toThrow(/capabilities|undefined|presence frame/i);
    expect(() =>
      verifyPresenceFrame({ ...frame, message: undefined }, contact, { now: later }),
    ).toThrow(/message|undefined|presence frame/i);
    expect(() => verifyPresenceFrame(frame, contact, { now: Number.NaN })).toThrow(/now/i);
    expect(() =>
      verifyPresenceFrame({ ...frame, status: { toString: () => "online" } }, contact, {
        now: later,
      }),
    ).toThrow(/status/i);

    const withSymbol = { ...frame } as Record<PropertyKey, unknown>;
    withSymbol[Symbol("presence-tamper")] = true;
    expect(() => verifyPresenceFrame(withSymbol, contact, { now: later })).toThrow(
      /symbol|presence frame/i,
    );

    const withHidden = { ...frame };
    Object.defineProperty(withHidden, "hidden", { value: true, enumerable: false });
    expect(() => verifyPresenceFrame(withHidden, contact, { now: later })).toThrow(
      /unknown|non-enumerable|presence frame/i,
    );

    let getterCalls = 0;
    const withAccessor = { ...frame } as Record<string, unknown>;
    Object.defineProperty(withAccessor, "message", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return undefined;
      },
    });
    expect(() => verifyPresenceFrame(withAccessor, contact, { now: later })).toThrow(
      /accessor|presence frame/i,
    );
    expect(getterCalls).toBe(0);

    const signatureWithAccessor = { ...frame.signature } as Record<string, unknown>;
    Object.defineProperty(signatureWithAccessor, "kid", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "kid-1";
      },
    });
    expect(() =>
      verifyPresenceFrame({ ...frame, signature: signatureWithAccessor }, contact, { now: later }),
    ).toThrow(/accessor|signature/i);
    expect(getterCalls).toBe(0);
  });

  it("rejects inherited frame/signature data properties and prototype accessors without invoking getters", () => {
    const keys = generateAgentKeyPair();
    const contact = contactFor("agent:peer", exportRawPublicKey(keys.publicKey));
    const frame = buildPresenceFrame({
      agentId: "agent:peer",
      privateKey: keys.privateKey,
      keyId: "kid-1",
      status: "online",
      sequence: 8,
      issuedAt: now,
      expiresAt: "2026-05-04T12:01:00.000Z",
    });

    const inheritedFrame = Object.create(frame) as typeof frame;
    expect(() => verifyPresenceFrame(inheritedFrame, contact, { now: later })).toThrow(
      /presence frame|own|required/i,
    );

    const inheritedSignature = Object.create({ signature: frame.signature }) as Record<
      string,
      unknown
    >;
    for (const [key, value] of Object.entries(frame)) {
      if (key !== "signature") inheritedSignature[key] = value;
    }
    expect(() => verifyPresenceFrame(inheritedSignature, contact, { now: later })).toThrow(
      /signature|own|required/i,
    );

    let frameGetterCalls = 0;
    const frameAccessorPrototype = Object.create(null, {
      type: {
        enumerable: true,
        get() {
          frameGetterCalls += 1;
          throw new Error("frame prototype getter invoked");
        },
      },
    });
    const inheritedFrameAccessor = Object.create(frameAccessorPrototype) as Record<string, unknown>;
    for (const [key, value] of Object.entries(frame)) {
      if (key !== "type") inheritedFrameAccessor[key] = value;
    }
    expect(() => verifyPresenceFrame(inheritedFrameAccessor, contact, { now: later })).toThrow(
      /presence frame|own|required/i,
    );
    expect(frameGetterCalls).toBe(0);

    let signatureGetterCalls = 0;
    const signatureAccessorPrototype = Object.create(null, {
      kid: {
        enumerable: true,
        get() {
          signatureGetterCalls += 1;
          throw new Error("signature prototype getter invoked");
        },
      },
    });
    const inheritedSignatureAccessor = Object.create(signatureAccessorPrototype) as Record<
      string,
      unknown
    >;
    inheritedSignatureAccessor.alg = frame.signature.alg;
    inheritedSignatureAccessor.value = frame.signature.value;
    expect(() =>
      verifyPresenceFrame({ ...frame, signature: inheritedSignatureAccessor }, contact, {
        now: later,
      }),
    ).toThrow(/signature|own|required/i);
    expect(signatureGetterCalls).toBe(0);
  });

  it("fails closed for non-finite or negative maxFutureSkewMs options", () => {
    const keys = generateAgentKeyPair();
    const contact = contactFor("agent:peer", exportRawPublicKey(keys.publicKey));
    const frame = buildPresenceFrame({
      agentId: "agent:peer",
      privateKey: keys.privateKey,
      keyId: "kid-1",
      status: "online",
      sequence: 9,
      issuedAt: now,
      expiresAt: "2026-05-04T12:01:00.000Z",
    });

    expect(() =>
      verifyPresenceFrame(frame, contact, { now: later, maxFutureSkewMs: Number.NaN }),
    ).toThrow(/maxFutureSkewMs|future skew/i);
    expect(() =>
      verifyPresenceFrame(frame, contact, {
        now: later,
        maxFutureSkewMs: Number.POSITIVE_INFINITY,
      }),
    ).toThrow(/maxFutureSkewMs|future skew/i);
    expect(() => verifyPresenceFrame(frame, contact, { now: later, maxFutureSkewMs: -1 })).toThrow(
      /maxFutureSkewMs|future skew/i,
    );
  });

  it("validates buildPresenceFrame runtime inputs before signing", () => {
    const keys = generateAgentKeyPair();
    const valid = {
      agentId: "agent:peer",
      privateKey: keys.privateKey,
      keyId: "kid-1",
      status: "online" as const,
      sequence: 1,
      issuedAt: now,
      expiresAt: "2026-05-04T12:01:00.000Z",
    };

    expect(() => buildPresenceFrame({ ...valid, agentId: "" })).toThrow(/agent/i);
    expect(() => buildPresenceFrame({ ...valid, keyId: "" })).toThrow(/key|kid/i);
    expect(() =>
      buildPresenceFrame({ ...valid, status: { toString: () => "online" } as never }),
    ).toThrow(/status/i);
    expect(() => buildPresenceFrame({ ...valid, status: "degraded" as never })).toThrow(/status/i);
    expect(() => buildPresenceFrame({ ...valid, sequence: "1" as never })).toThrow(/sequence/i);
    expect(() => buildPresenceFrame({ ...valid, sequence: 1.5 })).toThrow(/sequence/i);
    expect(() => buildPresenceFrame({ ...valid, capabilities: [""] })).toThrow(/capabilities/i);
    expect(() => buildPresenceFrame({ ...valid, message: 1 as never })).toThrow(/message/i);
    expect(() => buildPresenceFrame({ ...valid, expiresAt: now })).toThrow(/expires_at|date/i);
  });

  it("tracks monotonic sequence and online/stale/offline peer status", () => {
    const keys = generateAgentKeyPair();
    const contact = contactFor("agent:peer", exportRawPublicKey(keys.publicKey));
    const tracker = new PresenceTracker({
      staleAfterMs: 30_000,
      offlineAfterMs: 90_000,
      now: () => Date.parse(later),
    });
    const frame = buildPresenceFrame({
      agentId: "agent:peer",
      privateKey: keys.privateKey,
      keyId: "kid-1",
      status: "heartbeat",
      sequence: 10,
      issuedAt: now,
      expiresAt: "2026-05-04T12:05:00.000Z",
    });

    expect(tracker.observe(frame, contact)).toMatchObject({
      agentId: "agent:peer",
      sequence: 10,
      state: "online",
    });
    expect(() => tracker.observe(frame, contact)).toThrow(/replay|sequence/i);
    expect(tracker.status("agent:peer", Date.parse("2026-05-04T12:00:39.000Z"))).toBe("online");
    expect(tracker.status("agent:peer", Date.parse("2026-05-04T12:00:41.000Z"))).toBe("stale");
    expect(tracker.status("agent:peer", Date.parse("2026-05-04T12:01:41.000Z"))).toBe("offline");
  });

  it("marks a peer offline when observing a verified offline frame", () => {
    const keys = generateAgentKeyPair();
    const contact = contactFor("agent:peer", exportRawPublicKey(keys.publicKey));
    const tracker = new PresenceTracker({
      staleAfterMs: 30_000,
      offlineAfterMs: 90_000,
      now: () => Date.parse(later),
    });
    const frame = buildPresenceFrame({
      agentId: "agent:peer",
      privateKey: keys.privateKey,
      keyId: "kid-1",
      status: "offline",
      sequence: 11,
      issuedAt: now,
      expiresAt: "2026-05-04T12:05:00.000Z",
    });

    expect(tracker.observe(frame, contact)).toMatchObject({
      agentId: "agent:peer",
      sequence: 11,
      state: "offline",
    });
    expect(tracker.status("agent:peer")).toBe("offline");
  });
});

describe("reconnect backoff", () => {
  it("uses deterministic capped exponential delays, optional jitter, and reset", () => {
    const backoff = createBackoff({
      initialMs: 100,
      factor: 2,
      maxMs: 500,
      jitter: (delay, attempt) => delay + attempt,
    });
    expect(backoff.next()).toBe(100);
    expect(backoff.next()).toBe(201);
    expect(backoff.next()).toBe(402);
    expect(backoff.next()).toBe(500);
    backoff.reset();
    expect(backoff.next()).toBe(100);
  });

  it("caps the final jittered delay at maxMs", () => {
    const backoff = createBackoff({ initialMs: 100, factor: 10, maxMs: 250, jitter: () => 10_000 });

    expect(backoff.next()).toBe(250);
  });
});

describe("delivery ACK tracking", () => {
  it("accepts ACKs only from the intended peer and moves pending messages through retry and dead-letter", () => {
    const tracker = new AckTracker({ ackTimeoutMs: 1_000, maxAttempts: 3, now: () => 1_000 });
    tracker.track({ messageId: "msg-1", correlationId: "corr-1", peerAgentId: "agent:peer" });

    expect(() =>
      tracker.ack({ messageId: "msg-1", correlationId: "corr-wrong", fromAgentId: "agent:peer" }),
    ).toThrow(/correlation/i);
    expect(() =>
      tracker.ack({ messageId: "msg-1", correlationId: "corr-1", fromAgentId: "agent:wrong" }),
    ).toThrow(/wrong peer/i);
    expect(tracker.retryable(1_999)).toEqual([]);
    expect(tracker.retryable(2_000).map((item) => item.messageId)).toEqual(["msg-1"]);
    tracker.markAttempt("msg-1", 2_000);
    tracker.markAttempt("msg-1", 3_000);
    expect(tracker.deadLetters().map((item) => item.messageId)).toEqual(["msg-1"]);

    tracker.track({ messageId: "msg-2", correlationId: "corr-2", peerAgentId: "agent:peer" });
    expect(
      tracker.ack({ messageId: "msg-2", correlationId: "corr-2", fromAgentId: "agent:peer" }),
    ).toMatchObject({ state: "acked" });
  });

  it("ignores ACKs for terminal dead-letter records", () => {
    const tracker = new AckTracker({ ackTimeoutMs: 1_000, maxAttempts: 2, now: () => 1_000 });
    tracker.track({ messageId: "msg-1", correlationId: "corr-1", peerAgentId: "agent:peer" });
    expect(tracker.markAttempt("msg-1", 2_000)).toMatchObject({ state: "dead_letter" });

    expect(
      tracker.ack({ messageId: "msg-1", correlationId: "corr-1", fromAgentId: "agent:peer" }),
    ).toBe(false);
    expect(tracker.get("msg-1")).toMatchObject({ state: "dead_letter" });
  });

  it("does not overwrite or revive ACKed messages on duplicate track", () => {
    const tracker = new AckTracker({ ackTimeoutMs: 1_000, maxAttempts: 3, now: () => 1_000 });
    expect(
      tracker.track({ messageId: "msg-1", correlationId: "corr-1", peerAgentId: "agent:peer" }),
    ).toMatchObject({
      state: "pending",
      correlationId: "corr-1",
    });
    expect(
      tracker.ack({ messageId: "msg-1", correlationId: "corr-1", fromAgentId: "agent:peer" }),
    ).toMatchObject({ state: "acked", correlationId: "corr-1" });

    expect(
      tracker.track({ messageId: "msg-1", correlationId: "corr-evil", peerAgentId: "agent:peer" }),
    ).toBe(false);
    expect(tracker.get("msg-1")).toMatchObject({ state: "acked", correlationId: "corr-1" });
    expect(
      tracker.ack({ messageId: "msg-1", correlationId: "corr-evil", fromAgentId: "agent:peer" }),
    ).toBe(false);
  });

  it("does not overwrite or revive dead-letter messages on duplicate track", () => {
    const tracker = new AckTracker({ ackTimeoutMs: 1_000, maxAttempts: 2, now: () => 1_000 });
    tracker.track({ messageId: "msg-1", correlationId: "corr-1", peerAgentId: "agent:peer" });
    expect(tracker.markAttempt("msg-1", 2_000)).toMatchObject({ state: "dead_letter" });

    expect(
      tracker.track({ messageId: "msg-1", correlationId: "corr-evil", peerAgentId: "agent:peer" }),
    ).toBe(false);
    expect(tracker.get("msg-1")).toMatchObject({ state: "dead_letter", correlationId: "corr-1" });
    expect(
      tracker.ack({ messageId: "msg-1", correlationId: "corr-evil", fromAgentId: "agent:peer" }),
    ).toBe(false);
  });
});

describe("local observability snapshots", () => {
  it("reports peer health counts and retry/dead-letter/backoff diagnostics without message bodies", () => {
    const snapshot = createObservabilitySnapshot({
      now: 10_000,
      peers: [
        { agentId: "agent:online", sequence: 1, lastSeenAt: "2026-05-04T12:00:10.000Z", expiresAt: "2026-05-04T12:05:00.000Z", state: "online", message: "transcript secret body" },
        { agentId: "agent:stale", sequence: 2, lastSeenAt: "2026-05-04T12:00:00.000Z", expiresAt: "2026-05-04T12:05:00.000Z", state: "stale" },
        { agentId: "agent:offline", sequence: 3, lastSeenAt: "2026-05-04T11:59:00.000Z", expiresAt: "2026-05-04T12:00:00.000Z", state: "offline" },
      ],
      deliveries: [
        { messageId: "msg-1", correlationId: "corr-safe", peerAgentId: "agent:online", state: "pending", attempts: 2, lastAttemptAt: 8_000 },
        { messageId: "msg-2", correlationId: "corr-dead", peerAgentId: "agent:offline", state: "dead_letter", attempts: 3, lastAttemptAt: 6_000 },
        { messageId: "msg-3", correlationId: "corr-ack", peerAgentId: "agent:online", state: "acked", attempts: 1, lastAttemptAt: 1_000, ackedAt: 2_000 },
      ],
      ackTimeoutMs: 5_000,
      nextBackoffMs: 4_000,
    });

    expect(snapshot.summary).toEqual({ online: 1, stale: 1, offline: 1 });
    expect(snapshot.delivery).toMatchObject({ retryQueueCount: 1, deadLetterCount: 1, nextRetryInMs: 3_000, nextBackoffMs: 4_000 });
    expect(snapshot.delivery.retryQueue[0]).toMatchObject({ messageId: "msg-1", correlationId: "corr-safe", peerAgentId: "agent:online", attempts: 2, nextRetryAt: 13_000 });
    expect(snapshot.delivery.deadLetters[0]).toMatchObject({ messageId: "msg-2", correlationId: "corr-dead" });
    expect(JSON.stringify(snapshot)).not.toMatch(/transcript|secret body|bearer|private[_ -]?key|token/i);
  });

  it("deterministically redacts secret-like peer and delivery identifiers", () => {
    const snapshot = createObservabilitySnapshot({
      now: 10_000,
      peers: [
        {
          agentId: "agent:peer Bearer REAL_AGENT_BEARER transcript: private room notes",
          sequence: 1,
          lastSeenAt: "2026-05-04T12:00:10.000Z",
          expiresAt: "2026-05-04T12:05:00.000Z",
          state: "online",
        },
      ],
      deliveries: [
        {
          messageId: "msg-token=REAL_MESSAGE_TOKEN",
          correlationId: "corrPRIVATE_KEY_MARKERREAL_CORR_KEY",
          peerAgentId: "agent:peer Bearer REAL_PEER_BEARER transcript: private peer notes",
          state: "pending",
          attempts: 1,
          lastAttemptAt: 8_000,
        },
        {
          messageId: "dead-token=REAL_DEAD_TOKEN",
          correlationId: "dead Bearer REAL_DEAD_BEARER",
          peerAgentId: "dead transcript: private dead-letter notes",
          state: "dead_letter",
          attempts: 3,
          lastAttemptAt: 6_000,
        },
        {
          messageId: "ack-token=REAL_ACK_TOKEN",
          correlationId: "ack Bearer REAL_ACK_BEARER",
          peerAgentId: "ack transcript: private ack notes",
          state: "acked",
          attempts: 1,
          lastAttemptAt: 1_000,
          ackedAt: 2_000,
        },
      ],
      ackTimeoutMs: 5_000,
    });

    const output = JSON.stringify(snapshot);
    expect(output).not.toMatch(
      /REAL_AGENT_BEARER|REAL_MESSAGE_TOKEN|REAL_CORR_KEY|REAL_PEER_BEARER|REAL_DEAD_TOKEN|REAL_DEAD_BEARER|private peer notes|private dead-letter notes|REAL_ACK_TOKEN|REAL_ACK_BEARER|private ack notes/i,
    );
    expect(output).not.toMatch(/bearer\s+REAL|token=REAL|BEGIN PRIVATE KEY|transcript:\s*private/i);
    expect(snapshot.peers[0]?.agentId).toMatch(/^redacted:/);
    expect(snapshot.delivery.retryQueue[0]?.messageId).toMatch(/^redacted:/);
    expect(snapshot.delivery.retryQueue[0]?.correlationId).toMatch(/^redacted:/);
    expect(snapshot.delivery.retryQueue[0]?.peerAgentId).toMatch(/^redacted:/);
    expect(snapshot.delivery.deadLetters[0]?.messageId).toMatch(/^redacted:/);
    expect(snapshot.delivery.lastAck?.messageId).toMatch(/^redacted:/);
  });

  it("fails closed for invalid or NaN timing inputs", () => {
    expect(() => createObservabilitySnapshot({ now: Number.NaN, peers: [], deliveries: [] })).toThrow(/now/i);
    expect(() =>
      createObservabilitySnapshot({ now: 1_000, peers: [], deliveries: [], ackTimeoutMs: Number.NaN }),
    ).toThrow(/ackTimeoutMs/i);
    expect(() =>
      createObservabilitySnapshot({
        now: 1_000,
        peers: [],
        deliveries: [{ messageId: "m", correlationId: "c", peerAgentId: "p", state: "pending", attempts: 1, lastAttemptAt: Number.NaN }],
      }),
    ).toThrow(/lastAttemptAt/i);
  });
});
