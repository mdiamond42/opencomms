import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export interface RecallBlock {
  block: string;
  hits: number;
  error?: string;
}

export interface RecallProvider {
  fetch(input: { query: string; sender: string }): Promise<RecallBlock>;
}

export interface RecallOptions {
  bajaCmd?: string;
  dbPath?: string;
  limit?: number;
  maxBlockChars?: number;
  timeoutMs?: number;
  kind?: string;
  status?: string;
  includeProjectContext?: boolean;
}

interface ParsedHit {
  sourcePath: string;
  kind: string;
  status: string;
  lineStart?: number | null;
  lineEnd?: number | null;
  sha256: string;
  excerpt: string;
}

const DEFAULT_TIMEOUT_MS = 1_500;
const DEFAULT_LIMIT = 3;
const DEFAULT_MAX_BLOCK_CHARS = 1_200;
const DEFAULT_BAJA = "baja";

const SECRET_PATTERNS = [
  /\b(?:RELAY_TOKEN|OPENCOMMS_TOKEN|BEARER)\b\s*[:=]\s*\S+/i,
  /\.secrets\//i,
  /\bpassword\b/i,
  /\bpasscode\b/i,
  /\bapi[_-]?key\b\s*[:=]/i,
  /\bauthorization\s*:/i,
  /\b(?:sk|xox[baprs]|ghp|github_pat|glpat|AIza|ya29)[-_A-Za-z0-9]{16,}\b/,
  /-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY-----/,
  /\b(?:token|secret|client_secret|access_token|refresh_token)\b\s*[:=]\s*['"]?[^\s'"]{8,}/i,
];

function secretLike(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

function senderHash(sender: string): string {
  return createHash("sha256").update(sender).digest("hex").slice(0, 8);
}

function logRecall(details: { hits: number; ms: number; sender: string; error?: string }): void {
  const payload: Record<string, unknown> = {
    event: "recall",
    lane: "hermes",
    hits: details.hits,
    ms: details.ms,
    senderHash: senderHash(details.sender),
  };
  if (details.error) payload.error = details.error;
  console.log(JSON.stringify(payload));
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown, fallback = "-"): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function parseBajaJson(stdout: string): ParsedHit[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const results = Array.isArray(obj.results) ? obj.results : Array.isArray(obj.hits) ? obj.hits : null;
  if (!results) return null;
  const hits: ParsedHit[] = [];
  for (const item of results) {
    if (!item || typeof item !== "object") continue;
    const hit = item as Record<string, unknown>;
    const lineStart = asNumber(hit.line_start ?? hit.lineStart);
    const lineEnd = asNumber(hit.line_end ?? hit.lineEnd);
    hits.push({
      sourcePath: asString(hit.source_path ?? hit.sourcePath ?? hit.path),
      kind: asString(hit.kind),
      status: asString(hit.status),
      lineStart,
      lineEnd,
      sha256: asString(hit.sha256 ?? hit.sha ?? hit.chunk_sha),
      excerpt: asString(hit.excerpt ?? hit.text, ""),
    });
  }
  return hits;
}

function safeExcerpt(raw: string, maxChars = 280): string | null {
  const lines = raw.split(/\r?\n/);
  if (lines.some((line) => secretLike(line))) return null;
  const collapsed = lines.join(" ").replace(/\s+/g, " ").trim();
  if (!collapsed || secretLike(collapsed)) return null;
  if (collapsed.length <= maxChars) return collapsed;
  const cut = collapsed.slice(0, maxChars - 1).trimEnd();
  return `${cut}…`;
}

const QUERY_STOPWORDS = new Set([
  "about",
  "across",
  "available",
  "cite",
  "decide",
  "decided",
  "local",
  "lines",
  "path",
  "recall",
  "source",
  "what",
  "when",
  "where",
  "with",
]);

function bajaSearchQuery(query: string): string {
  const terms = Array.from(
    new Set(
      query
        .split(/[^A-Za-z0-9:_-]+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 4)
        .filter((term) => !QUERY_STOPWORDS.has(term.toLowerCase())),
    ),
  ).slice(0, 8);
  return terms.length >= 2 ? terms.join(" OR ") : query;
}

function formatBlock(hits: ParsedHit[], maxBlockChars: number): RecallBlock {
  const lines = ["Relevant local cross-channel recall excerpts (cite source_path:line_start-line_end when used):"];
  let emitted = 0;
  for (const hit of hits) {
    const excerpt = safeExcerpt(hit.excerpt);
    if (!excerpt) continue;
    const lineRange = hit.lineStart != null && hit.lineEnd != null ? `:${hit.lineStart}-${hit.lineEnd}` : "";
    const sha = hit.sha256.slice(0, 12);
    const candidate = [
      `${emitted + 1}. [${hit.status}/${hit.kind}] ${hit.sourcePath}${lineRange} sha=${sha}`,
      `   "${excerpt}"`,
    ];
    const next = [...lines, ...candidate].join("\n");
    if (next.length > maxBlockChars && emitted > 0) break;
    if (next.length > maxBlockChars) continue;
    lines.push(...candidate);
    emitted += 1;
  }
  return emitted === 0 ? { block: "", hits: 0 } : { block: `${lines.join("\n")}\n`, hits: emitted };
}

export function recallExcerpts(input: { query: string; sender?: string } & RecallOptions): Promise<RecallBlock> {
  const started = Date.now();
  const query = input.query.trim();
  const sender = input.sender ?? "-";
  if (!query) {
    const result = { block: "", hits: 0, error: "recall_skip_empty_query" };
    logRecall({ hits: 0, ms: Date.now() - started, sender, error: result.error });
    return Promise.resolve(result);
  }
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const limit = input.limit ?? DEFAULT_LIMIT;
  const maxBlockChars = input.maxBlockChars ?? DEFAULT_MAX_BLOCK_CHARS;
  const bajaCmd = input.bajaCmd ?? process.env.BAJA_BIN ?? (existsSync(DEFAULT_BAJA) ? DEFAULT_BAJA : "baja");
  const args = ["recall", bajaSearchQuery(query), "--json", "--limit", String(limit)];
  if (input.dbPath) args.push("--db", input.dbPath);
  if (input.kind) args.push("--kind", input.kind);
  if (input.status ?? "current") args.push("--status", input.status ?? "current");

  return new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    const finish = (result: RecallBlock) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      logRecall({ hits: result.hits, ms: Date.now() - started, sender, error: result.error });
      resolve(result);
    };
    const child = spawn(bajaCmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 250);
      finish({ block: "", hits: 0, error: "recall_timeout" });
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      finish({ block: "", hits: 0, error: error.code === "ENOENT" ? "recall_missing_cli" : "recall_spawn_error" });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      if (code !== 0) {
        finish({ block: "", hits: 0, error: `recall_exit_${code ?? "signal"}` });
        return;
      }
      const hits = parseBajaJson(stdout);
      if (!hits) {
        finish({ block: "", hits: 0, error: "recall_parse_error" });
        return;
      }
      finish(formatBlock(hits, maxBlockChars));
    });
  });
}

export function projectContext(input: RecallOptions = {}): Promise<RecallBlock> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBlockChars = input.maxBlockChars ?? DEFAULT_MAX_BLOCK_CHARS;
  const bajaCmd = input.bajaCmd ?? process.env.BAJA_BIN ?? (existsSync(DEFAULT_BAJA) ? DEFAULT_BAJA : "baja");
  const args = ["context", "--json", "--limit", String(input.limit ?? DEFAULT_LIMIT)];
  if (input.dbPath) args.push("--db", input.dbPath);
  return new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    const finish = (result: RecallBlock) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      resolve(result);
    };
    const child = spawn(bajaCmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 250);
      finish({ block: "", hits: 0, error: "project_context_timeout" });
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      finish({ block: "", hits: 0, error: error.code === "ENOENT" ? "project_context_missing_cli" : "project_context_spawn_error" });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      if (code !== 0) {
        finish({ block: "", hits: 0, error: `project_context_exit_${code ?? "signal"}` });
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as { prompt?: unknown };
        const prompt = typeof parsed.prompt === "string" ? parsed.prompt.trim() : "";
        if (!prompt || secretLike(prompt)) {
          finish({ block: "", hits: 0 });
          return;
        }
        const clipped = prompt.length > maxBlockChars ? `${prompt.slice(0, maxBlockChars - 1).trimEnd()}…` : prompt;
        finish({ block: `${clipped}\n`, hits: 1 });
      } catch {
        finish({ block: "", hits: 0, error: "project_context_parse_error" });
      }
    });
  });
}

export function createRecallProvider(opts: RecallOptions = {}): RecallProvider {
  return {
    async fetch(input) {
      const recall = await recallExcerpts({ ...opts, query: input.query, sender: input.sender });
      if (opts.includeProjectContext === false) return recall;
      const context = await projectContext(opts);
      const block = `${context.block || ""}${recall.block || ""}`;
      return { block, hits: context.hits + recall.hits, error: recall.error ?? context.error };
    },
  };
}
