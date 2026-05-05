import WebSocket from "ws";
import type { EnvelopeV01 } from "@agentcomms/protocol";
import type { Router } from "./router.js";

export interface RendezvousBridgeOptions {
  relayUrl: string;
  userId: string;
  token?: string;
  router: Router;
  reconnectMs?: number;
}

export interface RendezvousBridgeRuntime {
  close(): void;
}

type RelayMessage =
  | { type: "registered"; user_id: string }
  | { type: "envelope"; envelope: EnvelopeV01 }
  | { type: "delivery"; status: string; envelope_id: string }
  | { type: "error"; error: string }
  | { type: "pong"; at: string };

function relayWsUrl(relayUrl: string): string {
  const url = new URL(relayUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/v0/ws";
  return url.toString();
}

export function startRendezvousBridge(options: RendezvousBridgeOptions): RendezvousBridgeRuntime {
  let closed = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  const reconnectMs = options.reconnectMs ?? 3000;

  const connect = () => {
    if (closed) return;
    socket = new WebSocket(relayWsUrl(options.relayUrl), {
      headers: options.token ? { authorization: `Bearer ${options.token}` } : undefined,
    });

    socket.on("open", () => {
      socket?.send(JSON.stringify({ type: "register", user_id: options.userId, token: options.token, capabilities: { bridge: true } }));
    });

    socket.on("message", (raw) => {
      void (async () => {
        const msg = JSON.parse(raw.toString()) as RelayMessage;
        if (msg.type !== "envelope") return;
        const result = await options.router.route(msg.envelope);
        if (result.reply && socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "envelope", envelope: result.reply }));
        }
      })().catch((error) => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "error", error: error instanceof Error ? error.message : "bridge_route_failed" }));
        }
      });
    });

    socket.on("close", () => {
      socket = null;
      if (!closed) reconnectTimer = setTimeout(connect, reconnectMs);
    });

    socket.on("error", () => {
      socket?.close();
    });
  };

  connect();

  return {
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    },
  };
}
