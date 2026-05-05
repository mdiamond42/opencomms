import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { recallExcerpts, createRecallProvider, projectContext } from "../src/recall.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function script(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "recall-test-"));
  tempDirs.push(dir);
  const path = join(dir, "baja.sh");
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
  return path;
}

function bajaJson(results: unknown[]): string {
  return JSON.stringify({ query: "unified memory", results, warnings: [] });
}

const hit = {
  record_type: "chunk",
  id: 1,
  source_path: "docs/memory/opencomms/hermes-2026-05-04.md",
  kind: "note",
  status: "current",
  score: 9.1,
  line_start: 10,
  line_end: 18,
  sha256: "abcdef1234567890",
  excerpt: "Unified memory should use cited local OpenComms excerpts.",
};

describe("recallExcerpts", () => {
  it("formats successful local recall store JSON recall results with citations", async () => {
    const agent = script(`#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(bajaJson([hit, { ...hit, id: 2, line_start: 20, line_end: 22, sha256: "fedcba9876543210", excerpt: "Second cited excerpt." }]))}\n`);

    const result = await recallExcerpts({ query: "unified memory", sender: "human:phone", bajaCmd: agent, timeoutMs: 1_000 });

    expect(result.error).toBeUndefined();
    expect(result.hits).toBe(2);
    expect(result.block).toContain("Relevant local cross-channel recall excerpts");
    expect(result.block).toContain("[current/note]");
    expect(result.block).toContain("docs/memory/opencomms/hermes-2026-05-04.md:10-18 sha=abcdef123456");
    expect(result.block).toContain("Unified memory should use cited local OpenComms excerpts.");
  });

  it("broadens natural language questions into OR keyword queries", async () => {
    const agent = script(`#!/bin/sh\ncase "$2" in *"unified OR memory OR Telegram OR OpenComms"*) printf '%s\\n' ${JSON.stringify(bajaJson([hit]))} ;; *) printf '%s\\n' ${JSON.stringify(JSON.stringify({ query: "x", results: [], warnings: [] }))} ;; esac\n`);

    const result = await recallExcerpts({
      query: "What did we decide about unified memory across Telegram and OpenComms? Use local recall.",
      sender: "human:phone",
      bajaCmd: agent,
      timeoutMs: 1_000,
    });

    expect(result.hits).toBe(1);
    expect(result.block).toContain("Unified memory should use cited local OpenComms excerpts.");
  });

  it("times out and fails closed", async () => {
    const agent = script("#!/bin/sh\nsleep 2\nprintf '{\"results\":[]}'\n");
    const started = Date.now();

    const result = await recallExcerpts({ query: "x", sender: "human:phone", bajaCmd: agent, timeoutMs: 50 });

    expect(Date.now() - started).toBeLessThan(800);
    expect(result).toMatchObject({ block: "", hits: 0, error: "recall_timeout" });
  });

  it("maps non-zero exits", async () => {
    const agent = script("#!/bin/sh\nexit 7\n");
    await expect(recallExcerpts({ query: "x", bajaCmd: agent, timeoutMs: 1_000 })).resolves.toMatchObject({
      block: "",
      hits: 0,
      error: "recall_exit_7",
    });
  });

  it("maps a missing CLI", async () => {
    const result = await recallExcerpts({ query: "x", bajaCmd: "/definitely/missing/baja", timeoutMs: 1_000 });
    expect(result).toMatchObject({ block: "", hits: 0, error: "recall_missing_cli" });
  });

  it("maps malformed JSON", async () => {
    const agent = script("#!/bin/sh\nprintf 'not json'\n");
    const result = await recallExcerpts({ query: "x", bajaCmd: agent, timeoutMs: 1_000 });
    expect(result).toMatchObject({ block: "", hits: 0, error: "recall_parse_error" });
  });

  it("returns empty for empty results", async () => {
    const agent = script(`#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(JSON.stringify({ query: "x", results: [], warnings: [] }))}\n`);
    const result = await recallExcerpts({ query: "x", bajaCmd: agent, timeoutMs: 1_000 });
    expect(result).toEqual({ block: "", hits: 0 });
  });

  it("drops secret-looking hits before formatting", async () => {
    const secretHit = { ...hit, excerpt: "contains TOKEN_MARKERAAAAAAAAAAAAAAAAAAAAAAAA and should drop" };
    const agent = script(`#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(bajaJson([secretHit, hit]))}\n`);

    const result = await recallExcerpts({ query: "x", bajaCmd: agent, timeoutMs: 1_000 });

    expect(result.hits).toBe(1);
    expect(result.block).not.toContain("TOKEN_MARKER");
    expect(result.block).toContain("Unified memory should use cited local OpenComms excerpts.");
  });

  it("honors the max block size by dropping later hits", async () => {
    const hits = Array.from({ length: 10 }, (_, index) => ({ ...hit, id: index + 1, sha256: `abcdef12345${index}`, excerpt: `excerpt number ${index} with enough words to consume block budget` }));
    const agent = script(`#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(bajaJson(hits))}\n`);

    const result = await recallExcerpts({ query: "x", bajaCmd: agent, timeoutMs: 1_000, maxBlockChars: 260 });

    expect(result.block.length).toBeLessThanOrEqual(260);
    expect(result.hits).toBeGreaterThan(0);
    expect(result.block).toContain("excerpt number 0");
  });

  it("formats project context from local recall store context JSON", async () => {
    const prompt = "# local recall store Project Context\nCurrent focus: OpenComms [active/project]\nNext: test voice handoff";
    const agent = script(`#!/bin/sh\nif [ "$1" = "context" ]; then printf '%s\\n' ${JSON.stringify(JSON.stringify({ prompt }))}; else printf '%s\\n' ${JSON.stringify(bajaJson([]))}; fi\n`);

    const result = await projectContext({ bajaCmd: agent, timeoutMs: 1_000 });

    expect(result).toMatchObject({ hits: 1 });
    expect(result.block).toContain("Current focus: OpenComms");
    expect(result.block).toContain("Next: test voice handoff");
  });

  it("prepends project context in the default recall provider", async () => {
    const prompt = "# local recall store Project Context\nCurrent focus: OpenComms [active/project]\nNext: build ledger";
    const agent = script(`#!/bin/sh\ncase "$1" in context) printf '%s\\n' ${JSON.stringify(JSON.stringify({ prompt }))} ;; recall) printf '%s\\n' ${JSON.stringify(bajaJson([hit]))} ;; esac\n`);
    const provider = createRecallProvider({ bajaCmd: agent, timeoutMs: 1_000 });

    const result = await provider.fetch({ query: "unified memory", sender: "human:phone" });

    expect(result.hits).toBe(2);
    expect(result.block.indexOf("local recall store Project Context")).toBeLessThan(result.block.indexOf("Relevant local cross-channel recall excerpts"));
    expect(result.block).toContain("Unified memory should use cited local OpenComms excerpts.");
  });
});
