import { ProtocolError } from "./errors.js";

const BASE64URL_RE = /^[A-Za-z0-9_-]*$/;

export function encode(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString("base64url");
}

export function decode(s: string): Buffer {
  if (!BASE64URL_RE.test(s) || s.length % 4 === 1) {
    throw new ProtocolError("Invalid base64url string", ["Invalid base64url string"]);
  }

  const decoded = Buffer.from(s, "base64url");
  if (encode(decoded) !== s) {
    throw new ProtocolError("Invalid base64url string", ["Invalid base64url string"]);
  }

  return decoded;
}
