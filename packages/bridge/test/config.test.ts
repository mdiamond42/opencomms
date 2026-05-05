import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const OLD_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...OLD_ENV };
});

describe("bridge config", () => {
  it("loads hermes_http adapter config from the config file", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentcomms-config-"));
    const path = join(dir, "config.json");
    process.env.AGENTCOMMS_CONFIG = path;
    process.env.AGENTCOMMS_DEV_DEFAULT_TOKEN = "1";
    writeFileSync(
      path,
      JSON.stringify({
        adapters: {
          hermes: {
            kind: "hermes_http",
            base_url: "http://127.0.0.1:8642",
            auth_token: "secret",
            timeout_ms: 1234,
            path: "/v1/chat/completions",
          },
        },
      }),
    );

    const config = loadConfig();

    expect(config.adapters.hermes).toEqual({
      kind: "hermes_http",
      base_url: "http://127.0.0.1:8642",
      auth_token: "secret",
      timeout_ms: 1234,
      path: "/v1/chat/completions",
    });
  });

  it("lets environment override Hermes gateway URL and token", () => {
    process.env.AGENTCOMMS_DEV_DEFAULT_TOKEN = "1";
    process.env.HERMES_GATEWAY_URL = "http://127.0.0.1:9999";
    process.env.HERMES_GATEWAY_TOKEN = "env-secret";

    const config = loadConfig({ adapters: { hermes: { kind: "hermes_http" } } });

    expect(config.adapters.hermes).toMatchObject({
      kind: "hermes_http",
      base_url: "http://127.0.0.1:9999",
      auth_token: "env-secret",
    });
  });

  it("rejects non-loopback Hermes gateway URLs by default", () => {
    process.env.AGENTCOMMS_DEV_DEFAULT_TOKEN="1";

    const remoteUrl = `http${"s"}://${"example.com"}`;

    expect(() => loadConfig({ adapters: { hermes: { kind: "hermes_http", base_url: remoteUrl } } })).toThrow(
      /Hermes gateway URL must be local/,
    );
  });

  it("loads native agent_cli adapter config for tool-capable lanes", () => {
    process.env.AGENTCOMMS_DEV_DEFAULT_TOKEN = "1";

    const config = loadConfig({
      adapters: {
        hermes: {
          kind: "agent_cli",
          command: "hermes",
          args: ["chat", "-Q", "--source", "opencomms"],
          message_arg: "-q",
          timeout_ms: 120000,
          prompt_prefix: "native hermes",
        },
      },
    });

    expect(config.adapters.hermes).toEqual({
      kind: "agent_cli",
      command: "hermes",
      args: ["chat", "-Q", "--source", "opencomms"],
      message_arg: "-q",
      timeout_ms: 120000,
      prompt_prefix: "native hermes",
    });
  });
});
