#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

const VERSION = "export-opencomms-memory.mjs v0.1";
const DEFAULT_INPUTS = [
  "~/.agentcomms/opencomms-hermes-transcripts.jsonl",
  "~/.agentcomms/opencomms-monolith-transcripts.jsonl",
];
const DEFAULT_OUT = "docs/memory/opencomms";
const MAX_BODY_BYTES = 8 * 1024;

const SECRET_PATTERNS = [
  /\b(?:RELAY_TOKEN|OPENCOMMS_TOKEN|BEARER)\b\s*[:=]\s*\S+/i,
  /\.secrets\//i,
  /\bpassword\b/i,
  /\bpasscode\b/i,
  /\bapi[_-]?key\b\s*[:=]/i,
  /\bauthorization\s*:/i,
  /\b(?:sk|xox[baprs]|ghp|github_pat|glpat|AIza|ya29)[-_A-Za-z0-9]{16,}\b/,
  /\b[A-Za-z0-9._%+-]+:[A-Za-z0-9._%+-]{12,}@/,
  /-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY-----/,
  /\b(?:token|secret|client_secret|access_token|refresh_token)\b\s*[:=]\s*['"]?[^\s'"]{8,}/i,
];

function expandHome(path) {
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function usage() {
  return "usage: node scripts/export-opencomms-memory.mjs [--input path ...] [--out dir] [--limit n] [--since iso] [--dry-run]";
}

function parseArgs(argv) {
  const opts = { inputs: [], out: DEFAULT_OUT, limit: 500, since: undefined, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input") {
      const value = argv[++i];
      if (!value) throw new Error("--input requires a path");
      opts.inputs.push(value);
    } else if (arg === "--out") {
      const value = argv[++i];
      if (!value) throw new Error("--out requires a directory");
      opts.out = value;
    } else if (arg === "--limit") {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 0) throw new Error("--limit must be a non-negative integer");
      opts.limit = value;
    } else if (arg === "--since") {
      const value = argv[++i];
      if (!value || Number.isNaN(Date.parse(value))) throw new Error("--since must be an ISO-like date/time");
      opts.since = new Date(value);
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`unknown flag: ${arg}`);
    }
  }
  if (opts.inputs.length === 0) opts.inputs = DEFAULT_INPUTS;
  return opts;
}

function laneFromPath(path) {
  const name = basename(path).toLowerCase();
  if (name.includes("monolith")) return "monolith";
  if (name.includes("hermes")) return "hermes";
  return "opencomms";
}

function isSecretLike(text) {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

function isBinaryish(text) {
  if (!text) return false;
  const bad = (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) ?? []).length;
  return bad > 0 || bad / text.length > 0.02;
}

function valueAt(obj, path) {
  let cur = obj;
  for (const part of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return cur;
}

function firstString(obj, paths, fallback = "-") {
  for (const path of paths) {
    const value = valueAt(obj, path);
    if (typeof value === "string" && value.length > 0) return value;
  }
  return fallback;
}

function normalize(raw, sourcePath, lineNo) {
  const envelope = raw.envelope && typeof raw.envelope === "object" ? raw.envelope : raw;
  const payload = envelope.payload && typeof envelope.payload === "object" ? envelope.payload : raw.payload;
  const body = typeof payload?.body === "string" ? payload.body : typeof raw.payload_body === "string" ? raw.payload_body : "";
  const storedAt = firstString(raw, [["stored_at"], ["storedAt"], ["created_at"], ["createdAt"], ["envelope", "created_at"], ["envelope", "createdAt"]], new Date(0).toISOString());
  return {
    sourcePath,
    lineNo,
    storedAt,
    date: Number.isNaN(Date.parse(storedAt)) ? "unknown-date" : storedAt.slice(0, 10),
    direction: firstString(raw, [["direction"], ["message", "direction"]]),
    intent: firstString(raw, [["intent"], ["envelope", "intent"]]),
    id: firstString(raw, [["id"], ["envelope", "id"], ["envelope_id"]]),
    correlationId: firstString(raw, [["correlation_id"], ["envelope", "correlation_id"]]),
    senderId: firstString(raw, [["sender", "id"], ["envelope", "sender", "id"], ["sender_id"], ["envelope", "sender_id"]]),
    recipientId: firstString(raw, [["recipient", "id"], ["envelope", "recipient", "id"], ["recipient_id"], ["envelope", "recipient_id"]]),
    risk: firstString(raw, [["permissions", "risk_level"], ["envelope", "permissions", "risk_level"], ["risk_level"]]),
    body,
  };
}

function escapeYaml(value) {
  return JSON.stringify(String(value));
}

function escapeMarkdownLine(value) {
  return String(value).replace(/[\r\n]+/g, " ").trim() || "-";
}

function renderEntry(entry) {
  const body = entry.body.trim().replace(/```/g, "``\u200b`");
  return [
    `## ${escapeMarkdownLine(entry.storedAt)} · ${escapeMarkdownLine(entry.direction)} · ${escapeMarkdownLine(entry.intent)}`,
    `- envelope: ${escapeMarkdownLine(entry.id)}`,
    `- correlation: ${escapeMarkdownLine(entry.correlationId)}`,
    `- from: ${escapeMarkdownLine(entry.senderId)}`,
    `- to: ${escapeMarkdownLine(entry.recipientId)}`,
    `- risk: ${escapeMarkdownLine(entry.risk)}`,
    "",
    "```text",
    body,
    "```",
    "",
  ].join("\n");
}

function writeDayFile(outDir, lane, source, date, entries, dryRun) {
  const file = join(outDir, `${lane}-${date}.md`);
  const header = [
    "---",
    `source: ${escapeYaml(lane)}`,
    `lane: ${escapeYaml(lane)}`,
    `date: ${escapeYaml(date)}`,
    `entries: ${entries.length}`,
    `generated_at: ${escapeYaml(new Date().toISOString())}`,
    `generator: ${escapeYaml(VERSION)}`,
    "---",
    "",
    `# OpenComms ${lane} memory — ${date}`,
    "",
  ].join("\n");
  const content = header + entries.map(renderEntry).join("\n");
  if (isSecretLike(content)) throw new Error("refusing to write generated memory containing secret-like content");
  if (dryRun) return { file, entries: entries.length };
  mkdirSync(outDir, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, file);
  return { file, entries: entries.length };
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`export-opencomms-memory: ${error.message}`);
    console.error(usage());
    process.exit(2);
  }

  const outDir = resolve(expandHome(opts.out));
  const grouped = new Map();
  const stats = { files: 0, entries: 0, written: 0, dropped: 0, malformed: 0, missing: 0 };

  try {
    for (const input of opts.inputs) {
      const path = resolve(expandHome(input));
      if (!existsSync(path)) {
        stats.missing += 1;
        console.error(`export-opencomms-memory: input missing, skipped (${basename(path)})`);
        continue;
      }
      stats.files += 1;
      const lane = laneFromPath(path);
      const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
      const selected = (opts.limit > 0 ? lines.slice(-opts.limit) : lines).map((line, index) => ({ line, lineNo: lines.length - (opts.limit > 0 ? selectedStart(lines.length, opts.limit) : lines.length) + index + 1 }));
      for (const { line, lineNo } of selected) {
        let raw;
        try {
          raw = JSON.parse(line);
        } catch {
          stats.malformed += 1;
          continue;
        }
        const entry = normalize(raw, path, lineNo);
        stats.entries += 1;
        const when = Date.parse(entry.storedAt);
        if (opts.since && !Number.isNaN(when) && when < opts.since.getTime()) continue;
        if (!entry.body.trim() || Buffer.byteLength(entry.body, "utf8") > MAX_BODY_BYTES || isBinaryish(entry.body) || isSecretLike(entry.body)) {
          stats.dropped += 1;
          continue;
        }
        const key = `${lane}\u0000${entry.date}`;
        const bucket = grouped.get(key) ?? { lane, date: entry.date, source: lane, entries: [] };
        bucket.entries.push(entry);
        grouped.set(key, bucket);
      }
    }
    for (const bucket of [...grouped.values()].sort((a, b) => `${a.lane}-${a.date}`.localeCompare(`${b.lane}-${b.date}`))) {
      const result = writeDayFile(outDir, bucket.lane, bucket.source, bucket.date, bucket.entries, opts.dryRun);
      stats.written += result.entries;
      console.error(`${opts.dryRun ? "would write" : "wrote"} ${basename(result.file)} entries=${result.entries}`);
    }
    console.error(`export-opencomms-memory: files=${stats.files} entries=${stats.entries} written=${stats.written} dropped=${stats.dropped} malformed=${stats.malformed} missing=${stats.missing}`);
    if (opts.dryRun) console.log(JSON.stringify({ dry_run: true, out: outDir, ...stats }));
  } catch (error) {
    console.error(`export-opencomms-memory: ${error.message}`);
    process.exit(1);
  }
}

function selectedStart(length, limit) {
  return Math.max(0, length - limit);
}

main();
