import { jsonBody, makeEnvelope, type EnvelopeV01 } from "@agentcomms/protocol";
import type { ClientConfig } from "../config.js";

export type MessageHandler = (env: EnvelopeV01) => void;

export class BridgeClient {
  private socket: WebSocket | null = null;
  private readonly handlers = new Set<MessageHandler>();

  constructor(
    private readonly config: ClientConfig,
    private readonly senderId = "user:baja",
  ) {}

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  connect(): Promise<void> {
    const wsUrl = new URL(this.config.bridgeUrl);
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    wsUrl.pathname = "/ws";
    wsUrl.searchParams.set("token", this.config.token);

    return new Promise((resolve, reject) => {
      const socket = new WebSocket(wsUrl);
      this.socket = socket;
      socket.addEventListener("open", () => {
        socket.send(
          JSON.stringify(
            makeEnvelope({
              sender: { type: "human", id: this.senderId, device_id: "browser" },
              recipient: { type: "service", id: "bridge" },
              channel: "system",
              intent: "system",
              requires_ack: false,
              correlation_id: null,
              payload: {
                content_type: "application/json",
                body: jsonBody({ kind: "register", as: { type: "human", id: this.senderId } }),
              },
            }),
          ),
        );
        resolve();
      });
      socket.addEventListener("message", (event) => {
        const parsed = JSON.parse(String(event.data)) as EnvelopeV01 | { error?: string };
        if ("error" in parsed) {
          throw new Error(parsed.error);
        }
        if ("version" in parsed) {
          for (const handler of this.handlers) handler(parsed);
        }
      });
      socket.addEventListener("error", () => reject(new Error("WebSocket connection failed")));
    });
  }

  sendText(text: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Bridge is not connected");
    }
    this.socket.send(
      JSON.stringify(
        makeEnvelope({
          sender: { type: "human", id: this.senderId, device_id: "browser" },
          recipient: { type: "agent", id: this.config.recipient },
          channel: "text",
          intent: "message",
          requires_ack: true,
          correlation_id: null,
          payload: { content_type: "text/plain", body: text },
        }),
      ),
    );
  }

  close(): void {
    this.socket?.close();
  }
}

export async function fetchTranscripts(config: ClientConfig): Promise<unknown[]> {
  const res = await fetch(`${config.bridgeUrl}/v0/transcripts`, {
    headers: { authorization: `Bearer ${config.token}` },
  });
  const body = (await res.json()) as { rows?: unknown[] };
  return body.rows ?? [];
}
