import { ProtocolError, RoutingError, validateEnvelope, type EnvelopeV01 } from "@agentcomms/protocol";
import type { AgentAdapter } from "./adapters/adapter.js";
import type { TranscriptStore } from "./store/transcripts.js";

export interface RouteResult {
  status: "delivered" | "expired" | "duplicate";
  reply: EnvelopeV01 | null;
}

export class Router {
  private readonly adapters = new Map<string, AgentAdapter>();
  private readonly idempotency = new Map<string, RouteResult>();

  constructor(private readonly store: TranscriptStore) {}

  register(adapter: AgentAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  recipients(): string[] {
    return [...this.adapters.keys()].sort();
  }

  async route(input: EnvelopeV01): Promise<RouteResult> {
    let env: EnvelopeV01;
    try {
      env = validateEnvelope(input);
    } catch (error) {
      if (error instanceof ProtocolError && error.message === "Envelope expired") {
        return { status: "expired", reply: null };
      }
      throw error;
    }

    const cached = this.idempotency.get(env.idempotency_key);
    if (cached) {
      return { ...cached, status: "duplicate" };
    }

    const adapter = this.adapters.get(env.recipient.id);
    if (!adapter) {
      throw new RoutingError(`Unknown recipient: ${env.recipient.id}`);
    }

    this.store.insert("inbound", env);
    const reply = await adapter.send(env);
    if (reply) {
      this.store.insert("outbound", reply);
    }
    const result: RouteResult = { status: "delivered", reply };
    this.idempotency.set(env.idempotency_key, result);
    if (this.idempotency.size > 1024) {
      const first = this.idempotency.keys().next().value as string | undefined;
      if (first) this.idempotency.delete(first);
    }
    return result;
  }

  async close(): Promise<void> {
    await Promise.all([...this.adapters.values()].map((adapter) => adapter.close()));
  }
}
