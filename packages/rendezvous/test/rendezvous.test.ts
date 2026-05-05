import { makeEnvelope } from "@agentcomms/protocol";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryLogger } from "../src/logging.js";
import { type RendezvousRuntime, startRendezvous } from "../src/server.js";

let runtime: RendezvousRuntime | null = null;

afterEach(async () => {
  await runtime?.close();
  runtime = null;
});

function wsUrl(url: string): string {
  return `${url.replace("http" + "://", "ws" + "://")}/v0/ws`;
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl(url), { headers: { authorization: "Bearer test-token" } });
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function connectWithQueryToken(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${wsUrl(url)}?token=test-token`);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function nextJson(socket: WebSocket): Promise<any> {
  return new Promise((resolve) => {
    socket.once("message", (data) => resolve(JSON.parse(data.toString())));
  });
}

describe("rendezvous relay", () => {
  it("registers two users and routes an envelope without logging body text", async () => {
    const logger = new MemoryLogger();
    runtime = await startRendezvous({ bind: "127.0.0.1", port: 0, token: "test-token", logger });
    const alice = await connect(runtime.url);
    const hermes = await connect(runtime.url);

    alice.send(JSON.stringify({ type: "register", user_id: "phone:baja", token: "test-token" }));
    expect(await nextJson(alice)).toMatchObject({ type: "registered", user_id: "phone:baja" });
    hermes.send(JSON.stringify({ type: "register", user_id: "hermes", token: "test-token" }));
    expect(await nextJson(hermes)).toMatchObject({ type: "registered", user_id: "hermes" });

    const incoming = nextJson(hermes);
    const delivery = nextJson(alice);
    alice.send(
      JSON.stringify({
        type: "envelope",
        envelope: makeEnvelope({
          sender: { type: "human", id: "phone:baja" },
          recipient: { type: "agent", id: "hermes" },
          channel: "text",
          intent: "message",
          requires_ack: true,
          correlation_id: null,
          payload: { content_type: "text/plain", body: "SUPER SECRET BODY" },
        }),
      }),
    );

    expect(await incoming).toMatchObject({ type: "envelope", envelope: { recipient: { id: "hermes" }, payload: { body: "SUPER SECRET BODY" } } });
    expect(await delivery).toMatchObject({ type: "delivery", status: "delivered", recipient_id: "hermes" });
    expect(JSON.stringify(logger.entries)).not.toContain("SUPER SECRET BODY");
    expect(logger.entries.some((entry) => entry.event === "delivery_delivered")).toBe(true);

    alice.close();
    hermes.close();
  });

  it("returns offline delivery when recipient is not connected", async () => {
    runtime = await startRendezvous({ bind: "127.0.0.1", port: 0, token: "test-token", logger: new MemoryLogger() });
    const alice = await connect(runtime.url);
    alice.send(JSON.stringify({ type: "register", user_id: "phone:baja", token: "test-token" }));
    await nextJson(alice);

    const delivery = nextJson(alice);
    alice.send(
      JSON.stringify({
        type: "envelope",
        envelope: makeEnvelope({
          sender: { type: "human", id: "phone:baja" },
          recipient: { type: "agent", id: "offline-agent" },
          channel: "text",
          intent: "message",
          requires_ack: true,
          correlation_id: null,
          payload: { content_type: "text/plain", body: "hello" },
        }),
      }),
    );

    expect(await delivery).toMatchObject({ type: "delivery", status: "offline", recipient_id: "offline-agent" });
    alice.close();
  });

  it("exposes health without payload state", async () => {
    runtime = await startRendezvous({ bind: "127.0.0.1", port: 0, token: "test-token", logger: new MemoryLogger() });
    const res = await fetch(`${runtime.url}/v0/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, version: "0.1", users_online: [] });
  });

  it("allows browser websocket auth through a query token", async () => {
    runtime = await startRendezvous({ bind: "127.0.0.1", port: 0, token: "test-token", logger: new MemoryLogger() });
    const socket = await connectWithQueryToken(runtime.url);
    socket.send(JSON.stringify({ type: "register", user_id: "phone:baja", token: "test-token" }));
    expect(await nextJson(socket)).toMatchObject({ type: "registered", user_id: "phone:baja" });
    socket.close();
  });

  it("serves a phone smoke page without embedding the relay token", async () => {
    runtime = await startRendezvous({ bind: "127.0.0.1", port: 0, token: "test-token", logger: new MemoryLogger() });
    const res = await fetch(`${runtime.url}/phone`);
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(body).toContain("OpenComms Phone Smoke");
    expect(body).toContain("/v0/ws");
    expect(body).toContain("recipient");
    expect(body).not.toContain("test-token");
  });
});
