import type { IncomingMessage } from "node:http";
import type { BridgeConfig } from "./config.js";

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

export function tokenFromRequest(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice("Bearer ".length);
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  return url.searchParams.get("token");
}

export function authorizeRequest(req: IncomingMessage, config: BridgeConfig): { ok: true } | { ok: false; status: number; message: string } {
  const remote = req.socket.remoteAddress;
  if (!config.allow_lan && !isLoopbackAddress(remote)) {
    return { ok: false, status: 403, message: "Non-loopback connections require AGENTCOMMS_ALLOW_LAN=1" };
  }
  if (tokenFromRequest(req) !== config.token) {
    return { ok: false, status: 401, message: "Unauthorized" };
  }
  return { ok: true };
}
