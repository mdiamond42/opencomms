import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeEnvelope } from "@agentcomms/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { AgentCliAdapter } from "../src/adapters/agentCli.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function inputEnvelope(body = "send me a Telegram DM") {
  return makeEnvelope({
    sender: { type: "human", id: "phone:baja", device_id: "android" },
    recipient: { type: "agent", id: "hermes" },
    channel: "text",
    intent: "message",
    requires_ack: true,
    correlation_id: null,
    payload: { content_type: "text/plain", body },
    permissions: { may_execute_tools: true, may_notify_human: true, risk_level: "low" },
  });
}

function script(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-cli-adapter-"));
  tempDirs.push(dir);
  const path = join(dir, "adapter.sh");
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
  return path;
}

describe("AgentCliAdapter", () => {
  it("passes an OpenComms prompt to a tool-capable CLI and wraps plain text output as a reply envelope", async () => {
    const capture = join(mkdtempSync(join(tmpdir(), "agent-cli-capture-")), "prompt.txt");
    tempDirs.push(capture.replace(/\/prompt\.txt$/, ""));
    const command = script(`#!/bin/sh\nprintf '%s' "$1" > ${JSON.stringify(capture)}\nprintf 'Sent Telegram via Hermes tool lane.\\n'\n`);
    const env = inputEnvelope();
    const adapter = new AgentCliAdapter({ id: "hermes", command, timeoutMs: 2_000 });

    const reply = await adapter.send(env);

    expect(reply?.sender).toEqual({ type: "agent", id: "hermes" });
    expect(reply?.recipient).toMatchObject({ type: "human", id: "phone:baja" });
    expect(reply?.intent).toBe("reply");
    expect(reply?.correlation_id).toBe(env.id);
    expect(reply?.payload.body).toBe("Sent Telegram via Hermes tool lane.");
    expect(await import("node:fs").then((fs) => fs.readFileSync(capture, "utf8"))).toContain("send me a Telegram DM");
  });

  it("supports CLIs that require a message flag before the rendered prompt", async () => {
    const command = script(`#!/bin/sh\nif [ "$1" != "--message" ]; then echo "missing message flag" >&2; exit 2; fi\nprintf '{"text":"MONOLITH_TOOL_ACK"}'\n`);
    const adapter = new AgentCliAdapter({ id: "monolith", command, messageArg: "--message", timeoutMs: 2_000 });

    const reply = await adapter.send(inputEnvelope("hello monolith"));

    expect(reply?.sender).toEqual({ type: "agent", id: "monolith" });
    expect(reply?.payload.body).toBe("MONOLITH_TOOL_ACK");
  });

  it("maps non-zero CLI exits to agent_cli_failed with stderr", async () => {
    const command = script(`#!/bin/sh\necho 'boom' >&2\nexit 7\n`);
    const adapter = new AgentCliAdapter({ id: "hermes", command, timeoutMs: 2_000 });

    await expect(adapter.send(inputEnvelope())).rejects.toThrow(/agent_cli_failed.*boom/);
  });

  it("injects cited recall blocks for Hermes when a provider returns hits", async () => {
    const capture = join(mkdtempSync(join(tmpdir(), "agent-cli-capture-")), "prompt.txt");
    tempDirs.push(capture.replace(/\/prompt\.txt$/, ""));
    const command = script(`#!/bin/sh\nprintf '%s' "$1" > ${JSON.stringify(capture)}\nprintf 'ok\\n'\n`);
    const adapter = new AgentCliAdapter({
      id: "hermes",
      command,
      timeoutMs: 2_000,
      recall: {
        async fetch() {
          return {
            hits: 1,
            block:
              'Relevant local cross-channel recall excerpts (cite when used):\n1. [current/note] docs/memory/opencomms/hermes-2026-05-04.md:10-18 sha=abcdef123456\n   "Unified memory cited excerpt."\n',
          };
        },
      },
    });

    await adapter.send(inputEnvelope("what did we discuss about unified memory?"));

    const prompt = await import("node:fs").then((fs) => fs.readFileSync(capture, "utf8"));
    expect(prompt).toContain("Relevant local cross-channel recall excerpts");
    expect(prompt).toContain("docs/memory/opencomms/hermes-2026-05-04.md:10-18 sha=abcdef123456");
    expect(prompt).toMatch(/Unified memory cited excerpt[\s\S]*OpenComms envelope:/);
  });

  it("keeps prompt unchanged when a Hermes recall provider throws", async () => {
    const baselineCapture = join(mkdtempSync(join(tmpdir(), "agent-cli-baseline-")), "prompt.txt");
    tempDirs.push(baselineCapture.replace(/\/prompt\.txt$/, ""));
    const throwingCapture = join(mkdtempSync(join(tmpdir(), "agent-cli-throwing-")), "prompt.txt");
    tempDirs.push(throwingCapture.replace(/\/prompt\.txt$/, ""));
    const baselineCommand = script(`#!/bin/sh\nprintf '%s' "$1" > ${JSON.stringify(baselineCapture)}\nprintf 'ok\\n'\n`);
    const throwingCommand = script(`#!/bin/sh\nprintf '%s' "$1" > ${JSON.stringify(throwingCapture)}\nprintf 'ok\\n'\n`);
    const env = inputEnvelope("same prompt body");

    await new AgentCliAdapter({ id: "hermes", command: baselineCommand, timeoutMs: 2_000 }).send(env);
    await new AgentCliAdapter({
      id: "hermes",
      command: throwingCommand,
      timeoutMs: 2_000,
      recall: { async fetch() { throw new Error("boom"); } },
    }).send(env);

    const fs = await import("node:fs");
    expect(fs.readFileSync(throwingCapture, "utf8")).toBe(fs.readFileSync(baselineCapture, "utf8"));
  });

  it("does not call recall providers for monolith", async () => {
    const command = script(`#!/bin/sh\nprintf 'ok\\n'\n`);
    let calls = 0;
    const adapter = new AgentCliAdapter({
      id: "monolith",
      command,
      timeoutMs: 2_000,
      recall: { async fetch() { calls += 1; return { hits: 1, block: "Relevant local cross-channel recall excerpts: bad" }; } },
    });

    await adapter.send(inputEnvelope("hello monolith"));

    expect(calls).toBe(0);
  });

  it("injects a none-found marker when enabled Hermes recall returns no hits", async () => {
    const capture = join(mkdtempSync(join(tmpdir(), "agent-cli-empty-recall-")), "prompt.txt");
    tempDirs.push(capture.replace(/\/prompt\.txt$/, ""));
    const command = script(`#!/bin/sh\nprintf '%s' "$1" > ${JSON.stringify(capture)}\nprintf 'ok\\n'\n`);
    const adapter = new AgentCliAdapter({
      id: "hermes",
      command,
      timeoutMs: 2_000,
      recall: { async fetch() { return { hits: 0, block: "" }; } },
    });

    await adapter.send(inputEnvelope("no recall here"));

    expect(await import("node:fs").then((fs) => fs.readFileSync(capture, "utf8"))).toContain(
      "Relevant local cross-channel recall excerpts: (none found)",
    );
  });
});
