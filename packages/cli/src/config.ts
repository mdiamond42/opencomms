import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CliConfig {
  bridge_url: string;
  token: string;
}

export function loadCliConfig(): CliConfig {
  const path = process.env.AGENTCOMMS_CONFIG ?? join(homedir(), ".agentcomms", "config.json");
  const file = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>) : {};
  const token =
    process.env.AGENTCOMMS_TOKEN ??
    (typeof file.token === "string" ? file.token : undefined) ??
    (process.env.AGENTCOMMS_DEV_DEFAULT_TOKEN === "1" ? "agentcomms-local-dev-token" : undefined);
  if (!token) {
    throw new Error("Missing AgentComms token. Set AGENTCOMMS_TOKEN or create ~/.agentcomms/config.json.");
  }
  return {
    bridge_url:
      process.env.AGENTCOMMS_BRIDGE_URL ??
      (typeof file.bridge_url === "string" ? file.bridge_url : undefined) ??
      "http://127.0.0.1:8787",
    token,
  };
}
