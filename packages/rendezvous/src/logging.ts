export interface RedactedLogEntry {
  event: string;
  at: string;
  [key: string]: unknown;
}

export interface RendezvousLogger {
  info(entry: RedactedLogEntry): void;
  warn(entry: RedactedLogEntry): void;
}

export class MemoryLogger implements RendezvousLogger {
  readonly entries: RedactedLogEntry[] = [];

  info(entry: RedactedLogEntry): void {
    this.entries.push(entry);
  }

  warn(entry: RedactedLogEntry): void {
    this.entries.push(entry);
  }
}

export class ConsoleJsonLogger implements RendezvousLogger {
  info(entry: RedactedLogEntry): void {
    console.log(JSON.stringify(entry));
  }

  warn(entry: RedactedLogEntry): void {
    console.warn(JSON.stringify(entry));
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
