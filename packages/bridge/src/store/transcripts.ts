import { mkdirSync, readFileSync, appendFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { EnvelopeV01 } from "@agentcomms/protocol";
import { safeEnvelopeLog } from "../logging.js";

export interface TranscriptRow {
  stored_at: string;
  direction: "inbound" | "outbound";
  envelope: ReturnType<typeof safeEnvelopeLog>;
  payload_body: string;
}

export class TranscriptStore {
  constructor(
    private readonly path: string,
    private readonly enabled: boolean,
  ) {}

  insert(direction: "inbound" | "outbound", envelope: EnvelopeV01): void {
    if (!this.enabled) return;
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const row: TranscriptRow = {
      stored_at: new Date().toISOString(),
      direction,
      envelope: safeEnvelopeLog(envelope),
      payload_body: envelope.payload.body,
    };
    appendFileSync(this.path, `${JSON.stringify(row)}\n`, { mode: 0o600 });
  }

  list(since?: string): TranscriptRow[] {
    if (!this.enabled || !existsSync(this.path)) return [];
    const sinceMs = since ? Date.parse(since) : 0;
    return readFileSync(this.path, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as TranscriptRow)
      .filter((row) => Date.parse(row.stored_at) >= sinceMs);
  }
}
