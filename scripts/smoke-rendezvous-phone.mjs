import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

export function smokeWsUrl(relayUrl) {
  return relayUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:').replace(/\/$/, '') + '/v0/ws';
}

function boolEnabled(value) {
  return value === '1' || value === 'true' || value === 'yes';
}

function positiveInt(value, fallback, label) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`Invalid ${label}`);
  return parsed;
}

export function buildSmokeConfig(env = process.env) {
  const relayUrl = env.OPENCOMMS_RENDEZVOUS_URL ?? 'http://127.0.0.1:8799';
  const healthUrl = env.OPENCOMMS_SMOKE_HEALTH_URL ?? (boolEnabled(env.OPENCOMMS_SMOKE_HEALTH) ? relayUrl.replace(/\/$/, '') + '/healthz' : undefined);
  return {
    relayUrl,
    wsUrl: smokeWsUrl(relayUrl),
    token: env.OPENCOMMS_RENDEZVOUS_TOKEN ?? 'test-token',
    recipient: env.OPENCOMMS_SMOKE_RECIPIENT ?? 'echo',
    sender: env.OPENCOMMS_SMOKE_SENDER ?? 'phone:baja',
    body: env.OPENCOMMS_SMOKE_BODY ?? 'OPENCOMMS_RENDEZVOUS_SMOKE',
    expectedReply: env.OPENCOMMS_SMOKE_EXPECT_REPLY,
    timeoutMs: positiveInt(env.OPENCOMMS_SMOKE_TIMEOUT_MS, 30_000, 'OPENCOMMS_SMOKE_TIMEOUT_MS'),
    healthUrl,
    healthEnabled: Boolean(healthUrl),
  };
}

function iso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

export function buildSmokeEnvelope(config, id = crypto.randomUUID()) {
  return {
    version: '0.1',
    id,
    idempotency_key: crypto.randomUUID(),
    created_at: iso(),
    expires_at: iso(5 * 60 * 1000),
    sender: { type: 'human', id: config.sender },
    recipient: { type: 'agent', id: config.recipient },
    channel: 'text',
    intent: 'message',
    requires_ack: true,
    correlation_id: null,
    payload: { content_type: 'text/plain', body: config.body },
    permissions: { may_execute_tools: false, may_notify_human: true, risk_level: 'low' },
  };
}

export function redactSmokeSecrets(value, secrets = []) {
  let output = String(value);
  output = output.replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer [REDACTED]');
  output = output.replace(/(token=)[^\s"'}]+/gi, '$1[REDACTED]');
  for (const secret of secrets) {
    if (secret && secret !== 'test-token') output = output.split(secret).join('[REDACTED]');
  }
  return output;
}

export async function relayHealthCheck(config, fetchImpl = globalThis.fetch) {
  if (!config.healthEnabled || !config.healthUrl) return { checked: false };
  if (typeof fetchImpl !== 'function') throw new Error('Health check unavailable: fetch missing');
  const response = await fetchImpl(config.healthUrl, { headers: { authorization: `Bearer ${config.token}` } });
  if (!response?.ok) throw new Error(`Relay health check failed: ${response?.status ?? 'unknown'}`);
  return { checked: true, status: response.status };
}

function normalize(raw) {
  try {
    return JSON.parse(raw.toString());
  } catch {
    throw new Error('Malformed JSON from relay');
  }
}

export function handleSmokeFrame(raw, config) {
  const msg = normalize(raw);
  if (msg.type === 'registered') return { action: 'send' };
  if (msg.type === 'register_error' || msg.type === 'registration_error') {
    throw new Error(`Registration failure: ${msg.error ?? msg.reason ?? 'unknown'}`);
  }
  if (msg.type === 'error') throw new Error(`Relay error: ${msg.error ?? msg.reason ?? 'unknown'}`);
  if (msg.type === 'delivery' && msg.status === 'offline') throw new Error('Offline delivery reported by relay');
  if (msg.type === 'envelope') {
    const reply = msg.envelope?.payload?.body;
    if (typeof reply !== 'string') throw new Error('Malformed envelope reply');
    if (config.expectedReply !== undefined && reply !== config.expectedReply) {
      throw new Error(`Expected reply mismatch: expected ${config.expectedReply}`);
    }
    return { action: 'ok', result: { ok: true, reply, from: msg.envelope?.sender?.id, to: msg.envelope?.recipient?.id } };
  }
  return { action: 'ignore' };
}

export async function runSmoke(config = buildSmokeConfig(), deps = {}) {
  const WebSocketImpl = deps.WebSocketImpl ?? WebSocket;
  await relayHealthCheck(config, deps.fetchImpl);
  return await new Promise((resolve, reject) => {
    const ws = new WebSocketImpl(config.wsUrl, { headers: { authorization: `Bearer ${config.token}` } });
    const timeout = setTimeout(() => {
      try { ws.close?.(); } catch {}
      reject(new Error('SMOKE_TIMEOUT'));
    }, config.timeoutMs);
    const finish = (fn, value) => {
      clearTimeout(timeout);
      try { ws.close?.(); } catch {}
      fn(value);
    };
    const send = (value) => ws.send(JSON.stringify(value));
    ws.on('open', () => send({ type: 'register', user_id: config.sender, token: config.token }));
    ws.on('message', (raw) => {
      try {
        const decision = handleSmokeFrame(raw, config);
        if (decision.action === 'send') send({ type: 'envelope', envelope: buildSmokeEnvelope(config) });
        if (decision.action === 'ok') finish(resolve, decision.result);
      } catch (error) {
        finish(reject, error);
      }
    });
    ws.on('error', (err) => finish(reject, err));
  });
}

async function main() {
  const config = buildSmokeConfig();
  try {
    const result = await runSmoke(config);
    console.log(redactSmokeSecrets(JSON.stringify(result, null, 2), [config.token]));
  } catch (error) {
    console.error(redactSmokeSecrets(error?.message ?? error, [config.token]));
    const message = String(error?.message ?? error);
    process.exit(message.includes('TIMEOUT') ? 2 : message.match(/offline/i) ? 3 : 1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
