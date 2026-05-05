import * as crypto from "node:crypto";
import type { JsonWebKey, KeyObject } from "node:crypto";
import { decode, encode } from "./base64url.js";
import { canonicalize } from "./canonical.js";
import { ProtocolError } from "./errors.js";

const ED25519_PUBLIC_KEY_BYTES = 32;
const FINGERPRINT_BYTES = 16;

export function generateAgentKeyPair(): { publicKey: KeyObject; privateKey: KeyObject } {
  return crypto.generateKeyPairSync("ed25519");
}

export function signCanonical(privateKey: KeyObject, value: unknown): string {
  const bytes = Buffer.from(canonicalize(value), "utf8");
  return encode(crypto.sign(null, bytes, privateKey));
}

export function verifyCanonical(publicKey: KeyObject, value: unknown, signature: string): boolean {
  try {
    const bytes = Buffer.from(canonicalize(value), "utf8");
    return crypto.verify(null, bytes, publicKey, decode(signature));
  } catch {
    return false;
  }
}

function decodeRawPublicKey(base64Url: string): Buffer {
  const raw = decode(base64Url);
  if (raw.length !== ED25519_PUBLIC_KEY_BYTES) {
    throw new ProtocolError("Malformed Ed25519 public key length", [
      `Expected ${ED25519_PUBLIC_KEY_BYTES} bytes, received ${raw.length}`,
    ]);
  }
  return raw;
}

export function fingerprintPublicKey(rawPublicKeyBase64Url: string): string {
  const raw = decodeRawPublicKey(rawPublicKeyBase64Url);
  return encode(crypto.createHash("sha256").update(raw).digest().subarray(0, FINGERPRINT_BYTES));
}

export function exportRawPublicKey(publicKey: KeyObject): string {
  const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.x !== "string") {
    throw new ProtocolError("Expected an Ed25519 public key", ["Expected an Ed25519 public key"]);
  }

  const raw = decodeRawPublicKey(jwk.x);
  return encode(raw);
}

export function importRawPublicKey(base64Url: string): KeyObject {
  const raw = decodeRawPublicKey(base64Url);
  return crypto.createPublicKey({
    key: {
      kty: "OKP",
      crv: "Ed25519",
      x: encode(raw),
    },
    format: "jwk",
  });
}

export type { KeyObject } from "node:crypto";
