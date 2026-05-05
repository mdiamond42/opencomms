import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { validateEnvelopeShape, type EnvelopeV01 } from "@agentcomms/protocol";
import { ConsoleJsonLogger, nowIso, type RendezvousLogger } from "./logging.js";

export interface RendezvousConfig {
  bind: string;
  port: number;
  token?: string;
  logger?: RendezvousLogger;
}

export interface RendezvousRuntime {
  url: string;
  close(): Promise<void>;
  presence(): string[];
}

type ClientInfo = {
  userId: string;
  deviceId?: string;
  capabilities?: unknown;
  socket: WebSocket;
  connectedAt: string;
  lastSeenAt: string;
};

type ClientMessage =
  | { type: "register"; user_id: string; token?: string; device_id?: string; capabilities?: unknown }
  | { type: "envelope"; envelope: unknown }
  | { type: "ping" };

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

function sendHtml(res: ServerResponse, status: number, value: string): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(value);
}

function phoneSmokePage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>OpenComms Phone Smoke</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;margin:0;padding:20px;background:#080b10;color:#eef3ff}main{max-width:720px;margin:0 auto}label{display:block;margin:12px 0 4px}input,textarea,button{box-sizing:border-box;width:100%;font:inherit;border-radius:10px;border:1px solid #2d3748;background:#111827;color:#eef3ff;padding:12px}textarea{min-height:120px}button{margin-top:14px;background:#2563eb;border:0;font-weight:700}pre{white-space:pre-wrap;background:#05070a;border:1px solid #1f2937;border-radius:10px;padding:12px;min-height:120px}.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media(max-width:640px){.row{grid-template-columns:1fr}}
</style>
</head>
<body>
<main>
<h1>OpenComms Phone Smoke</h1>
<p>Connect this phone to the dumb rendezvous relay. Token stays in your browser; the relay does not embed it in this page.</p>
<div class="row"><label>Sender<input id="sender" value="phone:baja" /></label><label>Recipient<input id="recipient" value="hermes" /></label></div>
<label>Relay token<input id="token" type="password" autocomplete="off" placeholder="paste rendezvous token" /></label>
<label>Message<textarea id="body">Reply exactly: PHONE_HERMES_READY</textarea></label>
<button id="send">Connect + Send</button>
<pre id="log">idle</pre>
</main>
<script>
const log = (line) => { document.querySelector('#log').textContent += '\\n' + line; };
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
const iso = (ms = 0) => new Date(Date.now() + ms).toISOString();
function envelope(sender, recipient, body) { return { version:'0.1', id:uuid(), idempotency_key:uuid(), created_at:iso(), expires_at:iso(300000), sender:{type:'human', id:sender}, recipient:{type:'agent', id:recipient}, channel:'text', intent:'message', requires_ack:true, correlation_id:null, payload:{content_type:'text/plain', body}, permissions:{may_execute_tools:false, may_notify_human:true, risk_level:'low'} }; }
document.querySelector('#send').addEventListener('click', () => {
  const token = document.querySelector('#token').value.trim();
  const sender = document.querySelector('#sender').value.trim() || 'phone:baja';
  const recipient = document.querySelector('#recipient').value.trim() || 'hermes';
  const body = document.querySelector('#body').value;
  document.querySelector('#log').textContent = 'connecting';
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(proto + '//' + location.host + '/v0/ws?token=' + encodeURIComponent(token));
  const timer = setTimeout(() => { log('timeout'); ws.close(); }, 90000);
  ws.addEventListener('open', () => { log('socket open'); ws.send(JSON.stringify({type:'register', user_id:sender, token})); });
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'registered') { log('registered as ' + msg.user_id); ws.send(JSON.stringify({type:'envelope', envelope:envelope(sender, recipient, body)})); }
    else if (msg.type === 'delivery') log('delivery: ' + msg.status + ' to ' + msg.recipient_id);
    else if (msg.type === 'envelope') { clearTimeout(timer); log(msg.envelope.sender.id + ': ' + msg.envelope.payload.body); ws.close(); }
    else if (msg.type === 'error') log('error: ' + msg.error);
    else log(JSON.stringify(msg));
  });
  ws.addEventListener('error', () => log('socket error'));
  ws.addEventListener('close', () => log('socket closed'));
});
</script>
</body>
</html>`;
}

function authorizeRequest(req: IncomingMessage, token?: string): boolean {
  if (!token) return true;
  const auth = req.headers.authorization;
  if (auth === `Bearer ${token}`) return true;
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  return url.searchParams.get("token") === token;
}

function safeParseMessage(raw: Buffer): ClientMessage {
  const parsed = JSON.parse(raw.toString("utf8")) as ClientMessage;
  if (!parsed || typeof parsed !== "object" || typeof parsed.type !== "string") {
    throw new Error("Invalid rendezvous message");
  }
  return parsed;
}

function envelopeMeta(envelope: EnvelopeV01): Record<string, unknown> {
  return {
    envelope_id: envelope.id,
    sender_id: envelope.sender.id,
    recipient_id: envelope.recipient.id,
    intent: envelope.intent,
    channel: envelope.channel,
    content_type: envelope.payload.content_type,
    body_bytes: Buffer.byteLength(envelope.payload.body, "utf8"),
    expires_at: envelope.expires_at,
  };
}

export async function startRendezvous(config: RendezvousConfig): Promise<RendezvousRuntime> {
  const logger = config.logger ?? new ConsoleJsonLogger();
  const clientsByUser = new Map<string, Set<ClientInfo>>();
  const clientBySocket = new Map<WebSocket, ClientInfo>();

  const server = createServer((req, res) => {
    if (req.url?.startsWith("/v0/health")) {
      sendJson(res, 200, { ok: true, version: "0.1", users_online: [...clientsByUser.keys()].sort() });
      return;
    }
    if (req.url === "/phone" || req.url === "/phone/") {
      sendHtml(res, 200, phoneSmokePage());
      return;
    }
    sendJson(res, 404, { error: "not_found" });
  });

  const wss = new WebSocketServer({ noServer: true });

  function removeClient(socket: WebSocket): void {
    const info = clientBySocket.get(socket);
    if (!info) return;
    clientBySocket.delete(socket);
    const set = clientsByUser.get(info.userId);
    if (set) {
      set.delete(info);
      if (set.size === 0) clientsByUser.delete(info.userId);
    }
    logger.info({ event: "disconnect", at: nowIso(), user_id: info.userId, device_id: info.deviceId });
  }

  function register(socket: WebSocket, msg: Extract<ClientMessage, { type: "register" }>): void {
    if (config.token && msg.token !== config.token) {
      socket.send(JSON.stringify({ type: "error", error: "unauthorized" }));
      socket.close(1008, "unauthorized");
      return;
    }
    if (!msg.user_id || typeof msg.user_id !== "string") {
      throw new Error("register.user_id required");
    }
    removeClient(socket);
    const info: ClientInfo = {
      userId: msg.user_id,
      deviceId: msg.device_id,
      capabilities: msg.capabilities,
      socket,
      connectedAt: nowIso(),
      lastSeenAt: nowIso(),
    };
    clientBySocket.set(socket, info);
    const set = clientsByUser.get(info.userId) ?? new Set<ClientInfo>();
    set.add(info);
    clientsByUser.set(info.userId, set);
    socket.send(JSON.stringify({ type: "registered", user_id: info.userId, users_online: [...clientsByUser.keys()].sort() }));
    logger.info({ event: "register", at: nowIso(), user_id: info.userId, device_id: info.deviceId });
  }

  function routeEnvelope(socket: WebSocket, rawEnvelope: unknown): void {
    const sender = clientBySocket.get(socket);
    if (!sender) {
      socket.send(JSON.stringify({ type: "error", error: "not_registered" }));
      return;
    }
    sender.lastSeenAt = nowIso();
    const envelope = validateEnvelopeShape(rawEnvelope);
    const recipients = clientsByUser.get(envelope.recipient.id);
    if (!recipients || recipients.size === 0) {
      socket.send(JSON.stringify({ type: "delivery", status: "offline", envelope_id: envelope.id, recipient_id: envelope.recipient.id }));
      logger.info({ event: "delivery_offline", at: nowIso(), ...envelopeMeta(envelope) });
      return;
    }
    const payload = JSON.stringify({ type: "envelope", envelope });
    for (const recipient of recipients) recipient.socket.send(payload);
    socket.send(JSON.stringify({ type: "delivery", status: "delivered", envelope_id: envelope.id, recipient_id: envelope.recipient.id, recipient_socket_count: recipients.size }));
    logger.info({ event: "delivery_delivered", at: nowIso(), recipient_socket_count: recipients.size, ...envelopeMeta(envelope) });
  }

  wss.on("connection", (socket) => {
    socket.on("message", (data) => {
      try {
        const raw = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer);
        const msg = safeParseMessage(raw);
        if (msg.type === "register") register(socket, msg);
        else if (msg.type === "envelope") routeEnvelope(socket, msg.envelope);
        else if (msg.type === "ping") socket.send(JSON.stringify({ type: "pong", at: nowIso() }));
        else socket.send(JSON.stringify({ type: "error", error: "unsupported_type" }));
      } catch (error) {
        socket.send(JSON.stringify({ type: "error", error: error instanceof Error ? error.message : "bad_message" }));
      }
    });
    socket.on("close", () => removeClient(socket));
  });

  server.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/v0/ws")) {
      socket.write("HTTP/1.1 404 Not found\r\n\r\n");
      socket.destroy();
      return;
    }
    if (!authorizeRequest(req, config.token)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  await new Promise<void>((resolve) => server.listen(config.port, config.bind, resolve));
  const address = server.address() as { port: number };
  logger.info({ event: "start", at: nowIso(), bind: config.bind, port: address.port });

  return {
    url: `http://${config.bind}:${address.port}`,
    presence: () => [...clientsByUser.keys()].sort(),
    async close() {
      for (const socket of clientBySocket.keys()) socket.close();
      wss.close();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}
