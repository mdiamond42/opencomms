#!/usr/bin/env node
import { homedir } from "node:os";
import { resolve } from "node:path";
import { buildInstallPlan, writeInstallPlan } from "./index.js";

function arg(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

const agentId = arg("agent", "hermes")!;
const homeDir = arg("home", homedir())!;
const repoDir = resolve(arg("repo", process.cwd())!);
const configFile = arg("config", `${repoDir}/.secrets/opencomms-${agentId}-config.json`)!;
const tokenFile = arg("token-file", `${repoDir}/.secrets/opencomms_rendezvous_token.txt`)!;
const localPort = Number(arg("port", agentId === "monolith" ? "8791" : "8790"));
const adapterKind = arg("adapter", "agent_cli") as "agent_cli" | "cli" | "hermes_http" | "echo";
const cliCommand = arg("cli-command", undefined);

const plan = buildInstallPlan({ agentId, homeDir, repoDir, configFile, tokenFile, localPort, adapterKind, cliCommand });
writeInstallPlan(plan);
console.log(JSON.stringify({ ok: true, label: plan.label, wrapper: plan.wrapperPath, plist: plan.plistPath, config: plan.configPath, runbook: plan.runbookPath }, null, 2));
