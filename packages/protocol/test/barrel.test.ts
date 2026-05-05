import { describe, expect, it } from "vitest";
import * as protocol from "../src/index.js";

describe("browser-facing protocol barrel", () => {
  it("does not export Node crypto key helpers", () => {
    expect(protocol).not.toHaveProperty("generateAgentKeyPair");
    expect(protocol).not.toHaveProperty("signCanonical");
    expect(protocol).not.toHaveProperty("verifyCanonical");
  });
});
