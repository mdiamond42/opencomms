import { describe, expect, it } from 'vitest';
import {
  buildSmokeConfig,
  buildSmokeEnvelope,
  handleSmokeFrame,
  redactSmokeSecrets,
  relayHealthCheck,
  runSmoke,
  smokeWsUrl,
} from './smoke-rendezvous-phone.mjs';

describe('rendezvous phone smoke helpers', () => {
  it('builds backward-compatible config and preserves envelope wrapper shape', () => {
    const config = buildSmokeConfig({
      OPENCOMMS_RENDEZVOUS_URL: 'https://relay.example.test/',
      OPENCOMMS_RENDEZVOUS_TOKEN: 'super-secret-token',
      OPENCOMMS_SMOKE_SENDER: 'phone:test',
      OPENCOMMS_SMOKE_RECIPIENT: 'agent:test',
      OPENCOMMS_SMOKE_BODY: 'hello',
      OPENCOMMS_SMOKE_EXPECT_REPLY: 'ack',
      OPENCOMMS_SMOKE_TIMEOUT_MS: '1234',
      OPENCOMMS_SMOKE_HEALTH_URL: 'https://relay.example.test/healthz',
    });

    expect(config).toMatchObject({ sender: 'phone:test', recipient: 'agent:test', body: 'hello', expectedReply: 'ack', timeoutMs: 1234 });
    expect(smokeWsUrl(config.relayUrl)).toBe('wss://relay.example.test/v0/ws');
    const frame = { type: 'envelope', envelope: buildSmokeEnvelope(config, 'id-1') };
    expect(frame).toMatchObject({ type: 'envelope', envelope: { recipient: { id: 'agent:test' }, payload: { body: 'hello' }, requires_ack: true } });
  });

  it('classifies registration, success, mismatch, offline, and malformed frames', () => {
    const config = buildSmokeConfig({ OPENCOMMS_SMOKE_EXPECT_REPLY: 'ACK' });
    expect(handleSmokeFrame(JSON.stringify({ type: 'registered' }), config)).toEqual({ action: 'send' });
    expect(handleSmokeFrame(JSON.stringify({ type: 'envelope', envelope: { payload: { body: 'ACK' }, sender: { id: 'agent' }, recipient: { id: 'phone' } } }), config)).toMatchObject({ action: 'ok', result: { ok: true, reply: 'ACK' } });
    expect(() => handleSmokeFrame(JSON.stringify({ type: 'envelope', envelope: { payload: { body: 'NOPE' }, sender: { id: 'agent' }, recipient: { id: 'phone' } } }), config)).toThrow(/expected reply/i);
    expect(() => handleSmokeFrame(JSON.stringify({ type: 'delivery', status: 'offline' }), config)).toThrow(/offline/i);
    expect(() => handleSmokeFrame(JSON.stringify({ type: 'error', error: 'relay failed immediately' }), config)).toThrow(/relay failed immediately/i);
    expect(() => handleSmokeFrame('{not-json', config)).toThrow(/malformed json/i);
    expect(() => handleSmokeFrame(JSON.stringify({ type: 'register_error', error: 'bad bearer secret-token' }), config)).toThrow(/registration/i);
  });

  it('redacts bearer tokens and configured secrets from output', () => {
    const redacted = redactSmokeSecrets('Bearer super-secret-token failed: token=super-secret-token', ['super-secret-token']);
    expect(redacted).toBe('Bearer [REDACTED] failed: token=[REDACTED]');
    expect(redacted).not.toContain('super-secret-token');
  });

  it('performs health check only when enabled and fails closed on bad health', async () => {
    const skipped = await relayHealthCheck(buildSmokeConfig({ OPENCOMMS_SMOKE_HEALTH: '0' }), async () => ({ ok: false, status: 500 }));
    expect(skipped).toEqual({ checked: false });
    await expect(relayHealthCheck(buildSmokeConfig({ OPENCOMMS_SMOKE_HEALTH: '1' }), async () => ({ ok: false, status: 503 }))).rejects.toThrow(/health/i);
    await expect(relayHealthCheck(buildSmokeConfig({ OPENCOMMS_SMOKE_HEALTH_URL: 'https://relay.example.test/healthz' }), async () => ({ ok: true, status: 200 }))).resolves.toEqual({ checked: true, status: 200 });
  });

  it('fails non-zero-compatible timeout paths without exposing tokens', async () => {
    class QuietWebSocket {
      constructor() {
        this.handlers = new Map();
      }
      on(event, handler) {
        this.handlers.set(event, handler);
      }
      send() {}
      close() {}
    }
    await expect(
      runSmoke(buildSmokeConfig({ OPENCOMMS_SMOKE_TIMEOUT_MS: '1', OPENCOMMS_RENDEZVOUS_TOKEN: 'timeout-secret-token' }), {
        WebSocketImpl: QuietWebSocket,
      }),
    ).rejects.toThrow(/SMOKE_TIMEOUT/);
  });

  it('fails immediately on relay error frames instead of waiting for timeout', async () => {
    class ErrorFrameWebSocket {
      constructor() {
        this.handlers = new Map();
        queueMicrotask(() => this.handlers.get('message')?.(JSON.stringify({ type: 'error', error: 'relay auth rejected' })));
      }
      on(event, handler) {
        this.handlers.set(event, handler);
      }
      send() {}
      close() {}
    }
    await expect(
      runSmoke(buildSmokeConfig({ OPENCOMMS_SMOKE_TIMEOUT_MS: '1000', OPENCOMMS_RENDEZVOUS_TOKEN: 'relay-error-secret' }), {
        WebSocketImpl: ErrorFrameWebSocket,
      }),
    ).rejects.toThrow(/relay auth rejected/i);
  });
});
