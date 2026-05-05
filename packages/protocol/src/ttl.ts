const DEFAULT_TTL_MS = 60_000;

export function isoNow(date = new Date()): string {
  return date.toISOString();
}

export function expiresIn(ms = DEFAULT_TTL_MS, from = new Date()): string {
  return new Date(from.getTime() + ms).toISOString();
}

export function isExpired(expiresAt: string, now = new Date()): boolean {
  const expires = Date.parse(expiresAt);
  if (Number.isNaN(expires)) {
    return true;
  }
  return expires <= now.getTime();
}
