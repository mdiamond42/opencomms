import { existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";

export type AgentKind = "hermes" | "monolith" | string;

export interface InstallPlanOptions {
  agentId: AgentKind;
  repoDir: string;
  homeDir: string;
  tokenFile: string;
  configFile: string;
  relayHost?: string;
  relayScheme?: "https" | "http";
  localPort: number;
  adapterKind?: "agent_cli" | "hermes_http" | "cli" | "echo";
  cliCommand?: string;
  cliArgs?: string[];
  messageArg?: string;
  promptPrefix?: string;
  hermesBaseUrl?: string;
}

export interface BridgeConfigJson {
  bind: string;
  port: number;
  token: string;
  transcript_path: string;
  transcripts_enabled: boolean;
  adapters: Record<string, { kind: string; [key: string]: unknown }>;
}

export interface InstallPlan {
  agentId: string;
  label: string;
  wrapperPath: string;
  plistPath: string;
  configPath: string;
  runbookPath: string;
  wrapper: string;
  plist: string;
  runbook: string;
  config: BridgeConfigJson;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderLaunchAgentPlist(options: { label: string; wrapperPath: string; homeDir: string }): string {
  const logDir = `${options.homeDir}/.agentcomms/logs`;
  const plistDtd = "http" + "://www.apple.com/DTDs/PropertyList-1.0.dtd";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "${plistDtd}">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(options.label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(options.wrapperPath)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(`${logDir}/${options.label}.out.log`)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(`${logDir}/${options.label}.err.log`)}</string>
</dict>
</plist>
`;
}

function pairingRunbook(options: InstallPlanOptions): string {
  const pairingDir = `${options.homeDir}/.agentcomms/pairing`;
  const cardPath = `${pairingDir}/${options.agentId}-card.json`;
  const outputPath = `${pairingDir}/${options.agentId}-opencomms-pairing.txt`;
  const qrPath = `${pairingDir}/${options.agentId}-opencomms-pairing.png`;
  return [
    "# OpenComms pairing artifact runbook",
    "",
    "Installed agents must use this when asked to generate an OpenComms QR, contact card, or pairing artifact.",
    "",
    "## Safe default flow",
    `1. Work from the repo: \`cd ${options.repoDir}\``,
    `2. Prefer an existing signed card at \`${cardPath}\`.`,
    "3. If no signed card exists, create one only with real Ed25519 key material supplied by the operator or local secure storage:",
    "",
    "```bash",
    `mkdir -p ${pairingDir}`,
    `npx --yes pnpm@9.15.4 cli create-card --agent-id ${options.agentId} --display-name "${options.agentId}" --relay-url "$OPENCOMMS_RENDEZVOUS_URL" --public-key-kid <key-id> --public-key <base64url-public-key> --private-key-file <ed25519-private-key.pem> --out ${cardPath}`,
    "```",
    "",
    "4. Generate the pasteable/QR payload text:",
    "",
    "```bash",
    `npx --yes pnpm@9.15.4 cli trust-card --card ${cardPath} > ${outputPath}`,
    "```",
    "",
    "5. Share the file path and the line beginning `opencomms://pair?...`. The Android app can paste it; a QR tool can encode that exact line.",
    "6. If `qrencode` is installed, generate a PNG:",
    "",
    "```bash",
    `grep '^opencomms://pair' ${outputPath} | qrencode -o ${qrPath}`,
    "```",
    "",
    "## Safety rules",
    "- Never export private keys, rendezvous tokens, Authorization headers, transcript contents, or raw secrets.",
    "- Do not invent keys. If key material/card is missing, say exactly what is missing.",
    "- The QR/paste artifact must be the trust-card output or the `opencomms://pair?...` line only.",
    "",
  ].join("\n");
}

function promptPairingInstruction(options: InstallPlanOptions): string {
  const runbookPath = join(options.homeDir, ".agentcomms", `opencomms-${options.agentId}-pairing-runbook.md`);
  return ` If asked to generate/share an OpenComms QR, contact card, trust card, pairing link, or connect artifact, read ${runbookPath} and run the documented agentcomms trust-card/create-card flow. Output the artifact path plus the opencomms://pair payload; never output private keys, rendezvous tokens, transcripts, or secrets.`;
}

function defaultAdapterConfig(options: InstallPlanOptions): BridgeConfigJson["adapters"][string] {
  if (options.adapterKind === "cli") {
    return { kind: "cli", command: options.cliCommand ?? "python3", args: options.cliArgs ?? [] };
  }
  if (options.adapterKind === "echo") return { kind: "echo" };
  if (options.adapterKind === "hermes_http") {
    return {
      kind: "hermes_http",
      base_url: options.hermesBaseUrl ?? "http://127.0.0.1:8642",
      timeout_ms: 30000,
    };
  }
  if (options.agentId === "monolith") {
    return {
      kind: "agent_cli",
      command: options.cliCommand ?? `${options.homeDir}/.hermes/scripts/local-agent-adapter.py`,
      args: options.cliArgs ?? ["--timeout", "55", "--json"],
      message_arg: options.messageArg ?? "--message",
      timeout_ms: 70000,
      prompt_prefix:
        options.promptPrefix ??
        `You are a local OpenComms agent. Use available tools for safe user-requested actions and keep replies concise.${promptPairingInstruction(options)}`,
    };
  }
  return {
    kind: "agent_cli",
    command: options.cliCommand ?? "agent-cli",
    args: options.cliArgs ?? [],
    message_arg: options.messageArg ?? "--message",
    timeout_ms: 120000,
    prompt_prefix:
      options.promptPrefix ??
      `You are a concise local assistant responding through native OpenComms. Do not expose private keys, rendezvous tokens, transcripts, or local configuration details.${promptPairingInstruction(options)}`,
  };
}

export function buildInstallPlan(options: InstallPlanOptions): InstallPlan {
  const relayHost = options.relayHost ?? "opencomms-rendezvous.fly.dev";
  const relayScheme = options.relayScheme ?? "https";
  const label = `com.opencomms.bridge.${options.agentId}`;
  const wrapperPath = join(options.repoDir, ".install", `run-opencomms-${options.agentId}-connector.sh`);
  const plistPath = join(options.homeDir, "Library", "LaunchAgents", `${label}.plist`);
  const runbookPath = join(options.homeDir, ".agentcomms", `opencomms-${options.agentId}-pairing-runbook.md`);
  const transcriptPath = join(options.homeDir, ".agentcomms", `transcripts-${options.agentId}.jsonl`);
  const config: BridgeConfigJson = {
    bind: "127.0.0.1",
    port: options.localPort,
    token: "agentcomms-local-connector-token",
    transcript_path: transcriptPath,
    transcripts_enabled: true,
    adapters: {
      [options.agentId]: defaultAdapterConfig(options),
    },
  };
  const wrapper = `#!/bin/bash
set -euo pipefail
export HOME=${shellQuote(options.homeDir)}
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/Library/pnpm:$HOME/.local/bin
cd ${shellQuote(options.repoDir)}
TOKEN_FILE=${JSON.stringify(options.tokenFile)}
if [ ! -r "$TOKEN_FILE" ]; then
  echo "missing token file: $TOKEN_FILE" >&2
  exit 1
fi
OPENCOMMS_RENDEZVOUS_SCHEME="\${OPENCOMMS_RENDEZVOUS_SCHEME:-${relayScheme}}"
OPENCOMMS_RENDEZVOUS_HOST="\${OPENCOMMS_RENDEZVOUS_HOST:-${relayHost}}"
export OPENCOMMS_RENDEZVOUS_URL="\${OPENCOMMS_RENDEZVOUS_URL:-\${OPENCOMMS_RENDEZVOUS_SCHEME}://\${OPENCOMMS_RENDEZVOUS_HOST}}"
export OPENCOMMS_RENDEZVOUS_TOKEN="$(tr -d '\\r\\n' < "$TOKEN_FILE")"
export OPENCOMMS_USER_ID=${options.agentId}
export AGENTCOMMS_CONFIG=${shellQuote(options.configFile)}
exec npx pnpm --filter @agentcomms/bridge dev:rendezvous
`;
  const plist = renderLaunchAgentPlist({ label, wrapperPath, homeDir: options.homeDir });
  const runbook = pairingRunbook(options);
  return { agentId: options.agentId, label, wrapperPath, plistPath, configPath: options.configFile, runbookPath, wrapper, plist, runbook, config };
}

export function writeInstallPlan(plan: InstallPlan): void {
  mkdirSync(dirname(plan.wrapperPath), { recursive: true });
  mkdirSync(dirname(plan.plistPath), { recursive: true });
  mkdirSync(dirname(plan.configPath), { recursive: true });
  mkdirSync(dirname(plan.runbookPath), { recursive: true });
  mkdirSync(dirname(plan.config.transcript_path), { recursive: true });
  mkdirSync(join(plan.plistPath.startsWith("/") ? dirname(dirname(dirname(plan.plistPath))) : ".", ".agentcomms", "logs"), { recursive: true });
  writeFileSync(plan.wrapperPath, plan.wrapper, { mode: 0o755 });
  chmodSync(plan.wrapperPath, 0o755);
  writeFileSync(plan.plistPath, plan.plist);
  writeFileSync(plan.runbookPath, plan.runbook);
  if (!existsSync(plan.configPath)) {
    writeFileSync(plan.configPath, `${JSON.stringify(plan.config, null, 2)}\n`);
  }
}
