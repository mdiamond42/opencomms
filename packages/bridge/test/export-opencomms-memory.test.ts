import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const scriptPath = join(repoRoot, "scripts/export-opencomms-memory.mjs");
const fixturePath = join(repoRoot, "packages/bridge/test/fixtures/opencomms-transcripts.sample.jsonl");
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "opencomms-export-"));
  tempDirs.push(dir);
  return dir;
}

function run(args: string[]) {
  return spawnSync(process.execPath, [scriptPath, ...args], { cwd: repoRoot, encoding: "utf8" });
}

describe("export-opencomms-memory.mjs", () => {
  it("exports sanitized Markdown grouped by day with citation metadata", () => {
    const out = tempDir();

    const first = run(["--input", fixturePath, "--out", out, "--limit", "20"]);
    expect(first.status).toBe(0);
    const second = run(["--input", fixturePath, "--out", out, "--limit", "20"]);
    expect(second.status).toBe(0);

    const files = readdirSync(out).filter((name) => name.endsWith(".md")).sort();
    expect(files).toEqual(["opencomms-2026-05-04.md", "opencomms-2026-05-05.md"]);
    const content = files.map((name) => readFileSync(join(out, name), "utf8")).join("\n");
    expect(content).toContain("generator: \"export-opencomms-memory.mjs v0.1\"");
    expect(content).toContain("## 2026-05-04T10:00:00.000Z · inbound · message");
    expect(content).toContain("- envelope: env-unified-1");
    expect(content).toContain("- from: phone:baja");
    expect(content).toContain("- to: hermes");
    expect(content).toContain("sanitized OpenComms transcript chunks into local recall store");
    expect(content).not.toContain("RELAY_TOKEN");
    expect(content).not.toContain("sk-AAAAAAAA");
    expect(content).not.toContain(".secrets/");
    expect(content).not.toContain("env-empty");
  });

  it("supports dry-run without writing files", () => {
    const out = tempDir();
    const result = run(["--input", fixturePath, "--out", out, "--dry-run"]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ dry_run: true });
    expect(readdirSync(out)).toEqual([]);
  });

  it("skips missing input files gracefully", () => {
    const out = tempDir();
    const missing = join(out, "missing.jsonl");

    const result = run(["--input", missing, "--out", out]);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("input missing");
    expect(readdirSync(out).filter((name) => name.endsWith(".md"))).toEqual([]);
  });
});
