import { describe, expect, it } from "vitest";
import { authorizeRequest, isLoopbackAddress } from "../src/auth.js";
import type { BridgeConfig } from "../src/config.js";

const config: BridgeConfig = {
  bind: "127.0.0.1",
  port: 8787,
  token: "test-token",
  transcript_path: "/tmp/agentcomms-test.jsonl",
  transcripts_enabled: false,
  allow_lan: false,
  adapters: { echo: { kind: "echo" } },
};

function req(remoteAddress: string, token = "test-token") {
  return {
    headers: { authorization: `Bearer ${token}` },
    url: "/v0/send",
    socket: { remoteAddress },
  } as never;
}

describe("auth", () => {
  it("recognizes loopback addresses", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("192.168.1.5")).toBe(false);
  });

  it("rejects non-loopback by default", () => {
    expect(authorizeRequest(req("192.168.1.5"), config)).toMatchObject({ ok: false, status: 403 });
  });

  it("rejects missing or wrong token", () => {
    expect(authorizeRequest(req("127.0.0.1", "wrong"), config)).toMatchObject({
      ok: false,
      status: 401,
    });
  });
});
