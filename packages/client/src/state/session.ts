export type SessionState = "idle" | "connecting" | "ready" | "sending" | "speaking" | "error";

export interface Session {
  state: SessionState;
  error: string | null;
}

export function transition(session: Session, event: "connect" | "ready" | "send" | "reply" | "error"): Session {
  if (event === "connect") return { state: "connecting", error: null };
  if (event === "ready") return { state: "ready", error: null };
  if (event === "send") return { state: "sending", error: null };
  if (event === "reply") return { state: "speaking", error: null };
  return { state: "error", error: "Connection error" };
}
