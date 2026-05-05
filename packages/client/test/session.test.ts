import { describe, expect, it } from "vitest";
import { transition, type Session } from "../src/state/session.js";

describe("session state", () => {
  it("walks the typed loop states", () => {
    let session: Session = { state: "idle", error: null };
    session = transition(session, "connect");
    expect(session.state).toBe("connecting");
    session = transition(session, "ready");
    expect(session.state).toBe("ready");
    session = transition(session, "send");
    expect(session.state).toBe("sending");
    session = transition(session, "reply");
    expect(session.state).toBe("speaking");
  });
});
