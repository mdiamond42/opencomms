import { spawn } from "node:child_process";
import { validateEnvelope, type EnvelopeV01 } from "@agentcomms/protocol";
import type { AgentAdapter } from "./adapter.js";

export interface CliAdapterOptions {
  id: string;
  command: string;
  args?: string[];
  timeoutMs?: number;
}

export class CliAdapter implements AgentAdapter {
  readonly id: string;
  private readonly command: string;
  private readonly args: string[];
  private readonly timeoutMs: number;

  constructor(options: CliAdapterOptions) {
    this.id = options.id;
    this.command = options.command;
    this.args = options.args ?? [];
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  send(env: EnvelopeV01): Promise<EnvelopeV01 | null> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, this.args, { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`CLI adapter ${this.id} timed out`));
      }, this.timeoutMs);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`CLI adapter ${this.id} exited ${code}: ${stderr.trim()}`));
          return;
        }
        const trimmed = stdout.trim();
        if (!trimmed) {
          resolve(null);
          return;
        }
        try {
          resolve(validateEnvelope(JSON.parse(trimmed)));
        } catch (error) {
          reject(error);
        }
      });
      child.stdin.end(`${JSON.stringify(env)}\n`);
    });
  }

  async close(): Promise<void> {}
}
