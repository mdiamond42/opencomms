import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decode,
  encode,
  exportRawPublicKey,
  fingerprintPublicKey,
  generateAgentKeyPair,
  importRawPublicKey,
  signCanonical,
  verifyCanonical,
} from "../src/node.js";

describe("base64url", () => {
  it("round trips byte inputs of important Ed25519 sizes", () => {
    for (const size of [0, 1, 31, 32, 64]) {
      const input = randomBytes(size);
      const encoded = encode(input);

      expect(encoded).not.toContain("+");
      expect(encoded).not.toContain("/");
      expect(encoded).not.toContain("=");
      expect(decode(encoded)).toEqual(input);
    }
  });

  it("rejects malformed base64url strings", () => {
    for (const value of ["=", "abc=", "a+b", "a/b", "abc$", "abc\n"] as const) {
      expect(() => decode(value)).toThrow();
    }
  });
});

describe("Ed25519 key helpers", () => {
  it("generates a key pair and verifies a canonical signature round trip", () => {
    const { publicKey, privateKey } = generateAgentKeyPair();
    const payload = { b: 2, a: 1, nested: { z: true, m: null } };
    const signature = signCanonical(privateKey, payload);

    expect(verifyCanonical(publicKey, { a: 1, b: 2, nested: { m: null, z: true } }, signature)).toBe(true);
  });

  it("fails verification for a tampered payload", () => {
    const { publicKey, privateKey } = generateAgentKeyPair();
    const signature = signCanonical(privateKey, { message: "hello", count: 1 });

    expect(verifyCanonical(publicKey, { message: "hello", count: 2 }, signature)).toBe(false);
  });

  it("fails verification for a tampered signature", () => {
    const { publicKey, privateKey } = generateAgentKeyPair();
    const signature = signCanonical(privateKey, { message: "hello" });
    const bytes = decode(signature);
    bytes[0] = bytes[0] ^ 0xff;

    expect(verifyCanonical(publicKey, { message: "hello" }, encode(bytes))).toBe(false);
  });

  it("computes a stable fingerprint for the same raw public key", () => {
    const { publicKey } = generateAgentKeyPair();
    const raw = exportRawPublicKey(publicKey);

    expect(fingerprintPublicKey(raw)).toBe(fingerprintPublicKey(raw));
    expect(decode(fingerprintPublicKey(raw))).toHaveLength(16);
  });

  it("exports raw Ed25519 public keys as 32 bytes", () => {
    const { publicKey } = generateAgentKeyPair();

    expect(decode(exportRawPublicKey(publicKey))).toHaveLength(32);
  });

  it("imports an exported public key and verifies signatures", () => {
    const { publicKey, privateKey } = generateAgentKeyPair();
    const imported = importRawPublicKey(exportRawPublicKey(publicKey));
    const payload = { action: "pair", nonce: "abc123" };
    const signature = signCanonical(privateKey, payload);

    expect(verifyCanonical(imported, payload, signature)).toBe(true);
  });

  it("rejects malformed raw public key lengths", () => {
    expect(() => importRawPublicKey(encode(randomBytes(31)))).toThrow();
    expect(() => importRawPublicKey(encode(randomBytes(33)))).toThrow();
  });
});
