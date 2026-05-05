import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type AdapterConfig =
  | { kind: "echo" }
  | { kind: "cli"; command: string; args?: string[]; timeout_ms?: number }
  | {
      kind: "agent_cli";
      command: string;
      args?: string[];
      message_arg?: string;
      timeout_ms?: number;
      prompt_prefix?: string;
      env?: Record<string, string>;
    }
  | {
      kind: "hermes_http";
      base_url?: string;
      auth_token?: string;
      timeout_ms?: number;
      path?: string;
      model?: string;
      system_prompt?: string;
    };

export interface BridgeConfig {
  bind: string;
  port: number;
  token: string;
  transcript_path: string;
  transcripts_enabled: boolean;
  allow_lan: boolean;
  adapters: Record<string, AdapterConfig>;
}

interface ConfigFile {
  bind?: string;
  port?: number;
  token?: string;
  transcript_path?: string;
  transcripts_enabled?: boolean;
  allow_lan?: boolean;
  adapters?: Record<string, AdapterConfig>;
}

function expandHome(path: string): string {
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function assertLocalHermesUrl(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch (error) {
    throw new Error(`Invalid Hermes gateway URL: ${rawUrl}`);
  }
  const host = parsed.hostname.toLowerCase();
  const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  if (!isLoopback && process.env.AGENTCOMMS_ALLOW_REMOTE_HERMES !== "1") {
    throw new Error("Hermes gateway URL must be local loopback unless AGENTCOMMS_ALLOW_REMOTE_HERMES=1 is set");
  }
}

function normalizeAdapterConfig(adapter: AdapterConfig): AdapterConfig {
  if (adapter.kind !== "hermes_http") return adapter;
  const base_url = process.env.HERMES_GATEWAY_URL ?? adapter.base_url ?? "http://127.0.0.1:8642";
  assertLocalHermesUrl(base_url);
  return {
    ...adapter,
    base_url,
    auth_token: process.env.HERMES_GATEWAY_TOKEN ?? adapter.auth_token,
    timeout_ms: adapter.timeout_ms,
    path: adapter.path ?? "/v1/chat/completions",
  };
}

function normalizeAdapters(adapters: Record<string, AdapterConfig>): Record<string, AdapterConfig> {
  return Object.fromEntries(Object.entries(adapters).map(([id, adapter]) => [id, normalizeAdapterConfig(adapter)]));
}

export function configPath(): string {
  return process.env.AGENTCOMMS_CONFIG ?? join(homedir(), ".agentcomms", "config.json");
}

export function loadConfig(overrides: Partial<BridgeConfig> = {}): BridgeConfig {
  const path = configPath();
  const file: ConfigFile = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as ConfigFile) : {};
  const explicitDevToken =
    process.env.AGENTCOMMS_DEV_DEFAULT_TOKEN === "1" ? "agentcomms-local-dev-token" : undefined;
  const token = overrides.token ?? process.env.AGENTCOMMS_TOKEN ?? file.token ?? explicitDevToken;
  if (!token) {
    throw new Error(
      `AgentComms token missing. Set AGENTCOMMS_TOKEN or create ${path}. For local-only dev, set AGENTCOMMS_DEV_DEFAULT_TOKEN=1.`,
    );
  }

  return {
    bind: overrides.bind ?? process.env.AGENTCOMMS_BIND ?? file.bind ?? "127.0.0.1",
    port: overrides.port ?? Number(process.env.AGENTCOMMS_PORT ?? file.port ?? 8787),
    token,
    transcript_path: expandHome(
      overrides.transcript_path ??
        process.env.AGENTCOMMS_TRANSCRIPT_PATH ??
        file.transcript_path ??
        "~/.agentcomms/transcripts.jsonl",
    ),
    transcripts_enabled:
      overrides.transcripts_enabled ?? file.transcripts_enabled ?? process.env.NODE_ENV !== "test",
    allow_lan:
      overrides.allow_lan ??
      file.allow_lan ??
      process.env.AGENTCOMMS_ALLOW_LAN === "1",
    adapters: normalizeAdapters(overrides.adapters ?? file.adapters ?? { echo: { kind: "echo" } }),
  };
}
