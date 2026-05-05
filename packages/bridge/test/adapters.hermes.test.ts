import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { makeEnvelope } from "@agentcomms/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { HermesAdapter, type HermesAdapterOptions } from "../src/adapters/hermes.js";

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk as Buffer));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function startHermesStub(
  handler: (req: IncomingMessage, res: ServerResponse, body: unknown) => void | Promise<void>,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    const body = req.method === "POST" ? await readBody(req) : null;
    await handler(req, res, body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("stub did not bind to a TCP port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

function inputEnvelope() {
  return makeEnvelope({
    sender: { type: "human", id: "user:baja" },
    recipient: { type: "agent", id: "hermes" },
    channel: "text",
    intent: "message",
    requires_ack: true,
    correlation_id: null,
    payload: { content_type: "text/plain", body: "hello hermes" },
  });
}

interface HermesStub {
  url: string;
  close: () => Promise<void>;
}

let stub: HermesStub | null = null;

afterEach(async () => {
  await stub?.close();
  stub = null;
});

describe("HermesAdapter", () => {
  it("calls Hermes chat completions and returns the assistant content as an AgentComms reply", async () => {
    let seenAuth = "";
    let seenPath = "";
    let seenBody: unknown;
    stub = await startHermesStub((req, res, body) => {
      seenAuth = req.headers.authorization ?? "";
      seenPath = req.url ?? "";
      seenBody = body;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion",
          choices: [{ index: 0, message: { role: "assistant", content: "Hermes says hi" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    });

    const adapter = new HermesAdapter({ id: "hermes", baseUrl: stub.url, authToken: "secret" });
    const env = inputEnvelope();

    const reply = await adapter.send(env);

    expect(seenPath).toBe("/v1/chat/completions");
    expect(seenAuth).toBe("Bearer secret");
    expect(seenBody).toMatchObject({
      model: "hermes-agent",
      stream: false,
      messages: expect.arrayContaining([expect.objectContaining({ role: "user", content: "hello hermes" })]),
    });
    expect(reply?.sender).toEqual({ type: "agent", id: "hermes" });
    expect(reply?.recipient).toEqual(env.sender);
    expect(reply?.intent).toBe("reply");
    expect(reply?.correlation_id).toBe(env.id);
    expect(reply?.payload.body).toBe("Hermes says hi");
  });

  it("maps 401 responses to hermes_unauthorized", async () => {
    stub = await startHermesStub((_req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Invalid API key" } }));
    });
    const adapter = new HermesAdapter({ id: "hermes", baseUrl: stub.url });

    await expect(adapter.send(inputEnvelope())).rejects.toThrow(/hermes_unauthorized/);
  });

  it("maps 401 responses with non-JSON bodies to hermes_unauthorized", async () => {
    stub = await startHermesStub((_req, res) => {
      res.writeHead(401, { "content-type": "text/plain" });
      res.end("nope");
    });
    const adapter = new HermesAdapter({ id: "hermes", baseUrl: stub.url });

    await expect(adapter.send(inputEnvelope())).rejects.toThrow(/hermes_unauthorized/);
  });

  it("maps malformed success payloads to hermes_malformed", async () => {
    stub = await startHermesStub((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: {} }] }));
    });
    const adapter = new HermesAdapter({ id: "hermes", baseUrl: stub.url });

    await expect(adapter.send(inputEnvelope())).rejects.toThrow(/hermes_malformed/);
  });

  it("maps aborted slow requests to hermes_timeout", async () => {
    stub = await startHermesStub(async (_req, res) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "late" } }] }));
    });
    const options: HermesAdapterOptions = { id: "hermes", baseUrl: stub.url, timeoutMs: 5 };
    const adapter = new HermesAdapter(options);

    await expect(adapter.send(inputEnvelope())).rejects.toThrow(/hermes_timeout/);
  });
});
