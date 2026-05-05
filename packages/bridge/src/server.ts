import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { validateEnvelopeShape } from "@agentcomms/protocol";
import { EchoAdapter } from "./adapters/echo.js";
import { AgentCliAdapter } from "./adapters/agentCli.js";
import { CliAdapter } from "./adapters/cli.js";
import { HermesAdapter } from "./adapters/hermes.js";
import { authorizeRequest } from "./auth.js";
import type { BridgeConfig } from "./config.js";
import { Router } from "./router.js";
import { TranscriptStore } from "./store/transcripts.js";
import { createRecallProvider } from "./recall.js";

function recallEnabled(): boolean {
  return process.env.OPENCOMMS_RECALL_ENABLED !== "false";
}

function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "http://localhost:5173",
    "access-control-allow-headers": "authorization,content-type",
  });
  res.end(JSON.stringify(value));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk as Buffer));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export interface BridgeRuntime {
  close(): Promise<void>;
  url: string;
  router: Router;
}

export async function startBridge(config: BridgeConfig): Promise<BridgeRuntime> {
  const store = new TranscriptStore(config.transcript_path, config.transcripts_enabled);
  const router = new Router(store);
  for (const [id, adapter] of Object.entries(config.adapters)) {
    if (adapter.kind === "echo") router.register(new EchoAdapter(id));
    if (adapter.kind === "hermes_http") {
      router.register(
        new HermesAdapter({
          id,
          baseUrl: adapter.base_url,
          authToken: adapter.auth_token,
          timeoutMs: adapter.timeout_ms,
          path: adapter.path,
          model: adapter.model,
          systemPrompt: adapter.system_prompt,
        }),
      );
    }
    if (adapter.kind === "agent_cli") {
      router.register(
        new AgentCliAdapter({
          id,
          command: adapter.command,
          args: adapter.args,
          messageArg: adapter.message_arg,
          timeoutMs: adapter.timeout_ms,
          promptPrefix: adapter.prompt_prefix,
          env: adapter.env,
          recall:
            id === "hermes" && recallEnabled()
              ? createRecallProvider({
                  bajaCmd: process.env.BAJA_BIN,
                  timeoutMs: envPositiveInt("OPENCOMMS_RECALL_TIMEOUT_MS", 1_500),
                  limit: envPositiveInt("OPENCOMMS_RECALL_LIMIT", 3),
                })
              : undefined,
          recallTimeoutMs: envPositiveInt("OPENCOMMS_RECALL_TIMEOUT_MS", 1_500) + 250,
        }),
      );
    }
    if (adapter.kind === "cli") {
      router.register(
        new CliAdapter({
          id,
          command: adapter.command,
          args: adapter.args,
          timeoutMs: adapter.timeout_ms,
        }),
      );
    }
  }

  const server = createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      sendJson(res, 204, {});
      return;
    }
    if (req.url?.startsWith("/v0/health")) {
      sendJson(res, 200, { ok: true, version: "0.1", recipients: router.recipients() });
      return;
    }

    const auth = authorizeRequest(req, config);
    if (!auth.ok) {
      sendJson(res, auth.status, { error: auth.message });
      return;
    }

    try {
      const url = new URL(req.url ?? "/", `http://${config.bind}:${config.port}`);
      if (req.method === "POST" && url.pathname === "/v0/send") {
        const env = validateEnvelopeShape(await readJson(req));
        const result = await router.route(env);
        sendJson(res, 200, { id: env.id, status: result.status, reply: result.reply });
        return;
      }
      if (req.method === "GET" && url.pathname === "/v0/transcripts") {
        sendJson(res, 200, { rows: store.list(url.searchParams.get("since") ?? undefined) });
        return;
      }
      sendJson(res, 404, { error: "Not found" });
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "Bad request" });
    }
  });

  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();
  wss.on("connection", (socket) => {
    clients.add(socket);
    socket.on("close", () => clients.delete(socket));
    socket.on("message", async (data) => {
      try {
        const env = validateEnvelopeShape(JSON.parse(data.toString()));
        if (env.intent === "system") {
          socket.send(JSON.stringify({ kind: "registered" }));
          return;
        }
        const result = await router.route(env);
        if (result.reply) socket.send(JSON.stringify(result.reply));
      } catch (error) {
        socket.send(JSON.stringify({ error: error instanceof Error ? error.message : "Bad request" }));
      }
    });
  });

  server.on("upgrade", (req, socket, head) => {
    const auth = authorizeRequest(req, config);
    if (!auth.ok) {
      socket.write(`HTTP/1.1 ${auth.status} ${auth.message}\r\n\r\n`);
      socket.destroy();
      return;
    }
    if (!req.url?.startsWith("/ws")) {
      socket.write("HTTP/1.1 404 Not found\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  await new Promise<void>((resolve) => server.listen(config.port, config.bind, resolve));

  return {
    url: `http://${config.bind}:${(server.address() as { port: number }).port}`,
    router,
    async close() {
      for (const client of clients) client.close();
      wss.close();
      await router.close();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}
