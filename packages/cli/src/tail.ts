import type { CliConfig } from "./config.js";

export interface TailRow {
  stored_at: string;
  direction: string;
  envelope: {
    intent: string;
    sender_id: string;
    recipient_id: string;
  };
  payload_body: string;
}

export async function fetchTail(config: CliConfig): Promise<TailRow[]> {
  const res = await fetch(`${config.bridge_url}/v0/transcripts`, {
    headers: { authorization: `Bearer ${config.token}` },
  });
  const body = (await res.json()) as { rows?: TailRow[]; error?: string };
  if (!res.ok) {
    throw new Error(body.error ?? "tail failed");
  }
  return body.rows ?? [];
}

export function formatTail(rows: TailRow[]): string {
  return rows
    .map(
      (row) =>
        `${row.stored_at} ${row.direction} ${row.envelope.sender_id} -> ${row.envelope.recipient_id} ${row.envelope.intent}: ${row.payload_body}`,
    )
    .join("\n");
}
