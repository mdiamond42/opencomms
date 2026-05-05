import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildInstallPlan, renderLaunchAgentPlist, writeInstallPlan } from "../src/index.js";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("native connector installer", () => {
  it("builds a Hermes install plan without embedding the rendezvous token in launchd", () => {
    const plan = buildInstallPlan({
      agentId: "hermes",
      repoDir: "/opt/agentcomms",
      homeDir: "/Users/tester",
      tokenFile: "/Users/tester/.agentcomms/opencomms_rendezvous_token.txt",
      configFile: "/Users/tester/.agentcomms/hermes.json",
      relayHost: "opencomms-rendezvous.fly.dev",
      localPort: 8790,
    });

    expect(plan.label).toBe("com.opencomms.bridge.hermes");
    expect(plan.wrapperPath).toBe("/opt/agentcomms/.install/run-opencomms-hermes-connector.sh");
    expect(plan.plistPath).toBe("/Users/tester/Library/LaunchAgents/com.opencomms.bridge.hermes.plist");
    expect(plan.wrapper).toContain("OPENCOMMS_USER_ID=hermes");
    expect(plan.wrapper).toContain("OPENCOMMS_RENDEZVOUS_HOST=\"${OPENCOMMS_RENDEZVOUS_HOST:-opencomms-rendezvous.fly.dev}\"");
    expect(plan.wrapper).toContain("TOKEN_FILE=");
    expect(plan.wrapper).toContain("opencomms_rendezvous_token.txt");
    expect(plan.wrapper).not.toContain("secret-token");
    expect(plan.config.adapters.hermes).toMatchObject({
      kind: "agent_cli",
      command: "hermes",
      message_arg: "-q",
    });
    expect(plan.config.port).toBe(8790);
    expect(plan.runbookPath).toBe("/Users/tester/.agentcomms/opencomms-hermes-pairing-runbook.md");
    expect(plan.runbook).toContain("OpenComms pairing artifact runbook");
    expect(plan.runbook).toContain("npx --yes pnpm@9.15.4 cli trust-card --card /Users/tester/.agentcomms/pairing/hermes-card.json");
    expect(plan.runbook).toContain("opencomms://pair");
    expect(plan.runbook).toContain("qrencode");
    expect(plan.runbook).toContain("Never export private keys, rendezvous tokens");
    expect(plan.runbook).not.toContain("secret-token");
    expect(plan.config.adapters.hermes.prompt_prefix).toContain("opencomms://pair payload");
    expect(plan.config.adapters.hermes.prompt_prefix).toContain(plan.runbookPath);
    expect(plan.config.adapters.hermes.prompt_prefix).toContain("Default response style: terse");
    expect(plan.config.adapters.hermes.prompt_prefix).toContain("same soul, same personality");
  });

  it("builds a Peer Agent native local agent CLI install plan", () => {
    const plan = buildInstallPlan({
      agentId: "monolith",
      repoDir: "/opt/agentcomms",
      homeDir: "/Users/tester",
      tokenFile: "/Users/tester/.agentcomms/opencomms_rendezvous_token.txt",
      configFile: "/Users/tester/.agentcomms/monolith.json",
      localPort: 8791,
    });

    expect(plan.config.adapters.monolith).toMatchObject({
      kind: "agent_cli",
      command: "/Users/tester/.hermes/scripts/local-agent-adapter.py",
      message_arg: "--message",
    });
    expect(plan.config.port).toBe(8791);
    expect(plan.runbookPath).toBe("/Users/tester/.agentcomms/opencomms-monolith-pairing-runbook.md");
    expect(plan.runbook).toContain("Installed agents must use this when asked to generate an OpenComms QR");
    expect(plan.runbook).toContain("monolith-card.json");
    expect(plan.runbook).toContain("monolith-opencomms-pairing.txt");
    expect(plan.runbook).toContain("monolith-opencomms-pairing.png");
    expect(plan.config.adapters.monolith.prompt_prefix).toContain("read /Users/tester/.agentcomms/opencomms-monolith-pairing-runbook.md");
    expect(plan.config.adapters.monolith.prompt_prefix).toContain("trust-card/create-card flow");
  });

  it("renders a launchd plist that runs the generated wrapper and writes logs under ~/.agentcomms/logs", () => {
    const plist = renderLaunchAgentPlist({
      label: "com.opencomms.bridge.monolith",
      wrapperPath: "/opt/agentcomms/.install/run-opencomms-monolith-connector.sh",
      homeDir: "/Users/tester",
    });

    expect(plist).toContain("<string>com.opencomms.bridge.monolith</string>");
    expect(plist).toContain("<string>/opt/agentcomms/.install/run-opencomms-monolith-connector.sh</string>");
    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist).toContain("/Users/tester/.agentcomms/logs/com.opencomms.bridge.monolith.out.log");
    expect(plist).toContain("/Users/tester/.agentcomms/logs/com.opencomms.bridge.monolith.err.log");
  });

  it("writes wrapper and plist while preserving an existing hand-tuned adapter config", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentcomms-install-"));
    tempDirs.push(dir);
    const configFile = join(dir, "config.json");
    writeFileSync(configFile, JSON.stringify({ adapters: { hermes: { kind: "hermes_http", timeout_ms: 90000 } } }));

    const plan = buildInstallPlan({
      agentId: "hermes",
      repoDir: dir,
      homeDir: dir,
      tokenFile: join(dir, "token.txt"),
      configFile,
      localPort: 8790,
    });
    writeInstallPlan(plan);

    expect(existsSync(plan.wrapperPath)).toBe(true);
    expect(existsSync(plan.plistPath)).toBe(true);
    expect(existsSync(plan.runbookPath)).toBe(true);
    expect(readFileSync(plan.runbookPath, "utf8")).toContain("OpenComms pairing artifact runbook");
    expect(readFileSync(plan.runbookPath, "utf8")).toContain("opencomms://pair");
    expect(existsSync(join(dir, ".agentcomms", "logs"))).toBe(true);
    expect(JSON.parse(readFileSync(configFile, "utf8")).adapters.hermes.timeout_ms).toBe(90000);
  });
});
