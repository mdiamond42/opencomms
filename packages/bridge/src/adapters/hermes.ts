import { makeEnvelope, type EnvelopeV01 } from "@agentcomms/protocol";
import type { AgentAdapter } from "./adapter.js";

export interface HermesAdapterOptions {
  id: string;
  baseUrl?: string;
  authToken?: string;
  timeoutMs?: number;
  path?: string;
  model?: string;
  systemPrompt?: string;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
  error?: { message?: string; code?: string; type?: string };
}

const DEFAULT_BASE_URL = "http://127.0.0.1:8642";
const DEFAULT_PATH = "/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MODEL = "hermes-agent";
const DEFAULT_SYSTEM_PROMPT = "You are Hermes responding through AgentComms. Keep replies concise.";

export class HermesAdapter implements AgentAdapter {
  readonly id: string;
  private readonly baseUrl: string;
  private readonly authToken?: string;
  private readonly timeoutMs: number;
  private readonly path: string;
  private readonly model: string;
  private readonly systemPrompt: string;

  constructor(options: HermesAdapterOptions) {
    this.id = options.id;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.authToken = options.authToken;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.path = options.path ?? DEFAULT_PATH;
    this.model = options.model ?? DEFAULT_MODEL;
    this.systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  }

  async send(env: EnvelopeV01): Promise<EnvelopeV01> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${this.path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.authToken ? { authorization: `Bearer ${this.authToken}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          messages: [
            { role: "system", content: this.systemPrompt },
            { role: "user", content: env.payload.body },
          ],
        }),
        signal: controller.signal,
      });

      const text = await res.text();
      let data: ChatCompletionResponse = {};
      if (text) {
        try {
          data = JSON.parse(text) as ChatCompletionResponse;
        } catch (error) {
          if (res.status === 401 || res.status === 403) {
            throw new Error(`hermes_unauthorized: ${res.statusText || "unauthorized"}`);
          }
          if (!res.ok) {
            throw new Error(`hermes_upstream: HTTP ${res.status} ${res.statusText || "upstream error"}`);
          }
          throw new Error(`hermes_malformed: non-JSON response from Hermes (${error instanceof Error ? error.message : "parse failed"})`);
        }
      }

      if (res.status === 401 || res.status === 403) {
        throw new Error(`hermes_unauthorized: ${data.error?.message ?? res.statusText}`);
      }
      if (!res.ok) {
        throw new Error(`hermes_upstream: HTTP ${res.status} ${data.error?.message ?? res.statusText}`);
      }

      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new Error("hermes_malformed: missing choices[0].message.content string");
      }

      return makeEnvelope({
        sender: { type: "agent", id: this.id },
        recipient: env.sender,
        channel: env.channel === "voice" ? "voice" : "text",
        intent: "reply",
        requires_ack: false,
        correlation_id: env.id,
        payload: {
          content_type: "text/plain",
          body: content,
          summary: "Hermes reply",
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`hermes_timeout: Hermes did not respond within ${this.timeoutMs}ms`);
      }
      if (error instanceof Error && error.message.startsWith("hermes_")) {
        throw error;
      }
      throw new Error(`hermes_unreachable: ${error instanceof Error ? error.message : "request failed"}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async close(): Promise<void> {}
}
