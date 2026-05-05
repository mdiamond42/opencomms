import { spawn } from "node:child_process";
import { makeEnvelope, type EnvelopeV01 } from "@agentcomms/protocol";
import type { RecallProvider } from "../recall.js";
import type { AgentAdapter } from "./adapter.js";

export interface AgentCliAdapterOptions {
  id: string;
  command: string;
  args?: string[];
  messageArg?: string;
  timeoutMs?: number;
  promptPrefix?: string;
  env?: Record<string, string>;
  recall?: RecallProvider;
  recallTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_RECALL_TIMEOUT_MS = 1_750;

function defaultPromptPrefix(_id: string): string {
  return "You are an agent responding through a native tool-capable OpenComms lane. Keep replies concise. Do not reveal private keys, tokens, transcripts, or local configuration details.";
}

function renderPrompt(options: { id: string; promptPrefix?: string; env: EnvelopeV01; recallBlock?: string }): string {
  const env = options.env;
  const body = env.payload.body;
  const sender = `${env.sender.type}:${env.sender.id}`;
  const prefix = options.promptPrefix ?? defaultPromptPrefix(options.id);
  const recall = options.recallBlock ? `\n\n${options.recallBlock.trimEnd()}` : "";
  return `${prefix}${recall}\n\nOpenComms envelope:\n- from: ${sender}\n- to: ${env.recipient.type}:${env.recipient.id}\n- channel: ${env.channel}\n- intent: ${env.intent}\n- correlation id: ${env.id}\n\nUser message:\n${body}`;
}

async function recallBlockForPrompt(options: {
  id: string;
  env: EnvelopeV01;
  recall?: RecallProvider;
  recallTimeoutMs: number;
}): Promise<string> {
  if (options.id !== "hermes" || !options.recall) return "";
  const sender = `${options.env.sender.type}:${options.env.sender.id}`;
  try {
    const result = await Promise.race([
      options.recall.fetch({ query: options.env.payload.body, sender }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("recall_provider_timeout")), options.recallTimeoutMs),
      ),
    ]);
    if (result.block) return result.block;
    return "Relevant local cross-channel recall excerpts: (none found)\n";
  } catch {
    return "";
  }
}

function extractJsonText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const obj = value as Record<string, unknown>;
  for (const key of ["text", "finalAssistantVisibleText", "final_response", "response", "output", "message"]) {
    const maybe = obj[key];
    if (typeof maybe === "string" && maybe.trim()) return maybe.trim();
  }
  const payloads = obj.payloads;
  if (Array.isArray(payloads)) {
    for (const payload of payloads) {
      if (payload && typeof payload === "object" && typeof (payload as Record<string, unknown>).text === "string") {
        const text = ((payload as Record<string, unknown>).text as string).trim();
        if (text) return text;
      }
    }
  }
  const meta = obj.meta;
  if (meta && typeof meta === "object") {
    const text = extractJsonText(meta);
    if (text) return text;
  }
  return "";
}

export function extractAgentCliText(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const text = extractJsonText(parsed);
    if (text) return text;
  } catch {
    // Plain text CLI output is valid.
  }
  return trimmed
    .split("\n")
    .filter((line) => !line.trim().startsWith("Resume this session with:"))
    .join("\n")
    .trim();
}

export class AgentCliAdapter implements AgentAdapter {
  readonly id: string;
  private readonly command: string;
  private readonly args: string[];
  private readonly messageArg?: string;
  private readonly timeoutMs: number;
  private readonly promptPrefix?: string;
  private readonly env: Record<string, string>;
  private readonly recall?: RecallProvider;
  private readonly recallTimeoutMs: number;

  constructor(options: AgentCliAdapterOptions) {
    this.id = options.id;
    this.command = options.command;
    this.args = options.args ?? [];
    this.messageArg = options.messageArg;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.promptPrefix = options.promptPrefix;
    this.env = options.env ?? {};
    this.recall = options.recall;
    this.recallTimeoutMs = options.recallTimeoutMs ?? DEFAULT_RECALL_TIMEOUT_MS;
  }

  async send(env: EnvelopeV01): Promise<EnvelopeV01 | null> {
    const recallBlock = await recallBlockForPrompt({
      id: this.id,
      env,
      recall: this.recall,
      recallTimeoutMs: this.recallTimeoutMs,
    });
    const prompt = renderPrompt({ id: this.id, promptPrefix: this.promptPrefix, env, recallBlock });
    const args = [...this.args, ...(this.messageArg ? [this.messageArg] : []), prompt];
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ...this.env },
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`agent_cli_timeout: ${this.id} did not respond within ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => (stdout += String(chunk)));
      child.stderr.on("data", (chunk) => (stderr += String(chunk)));
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`agent_cli_failed: ${this.id} exited ${code}: ${stderr.trim() || stdout.trim()}`));
          return;
        }
        const body = extractAgentCliText(stdout);
        if (!body) {
          resolve(null);
          return;
        }
        resolve(
          makeEnvelope({
            sender: { type: "agent", id: this.id },
            recipient: env.sender,
            channel: env.channel === "voice" ? "voice" : "text",
            intent: "reply",
            requires_ack: false,
            correlation_id: env.id,
            payload: { content_type: "text/plain", body },
            permissions: { may_execute_tools: false, may_notify_human: false, risk_level: "low" },
          }),
        );
      });
    });
  }

  async close(): Promise<void> {}
}
