#!/usr/bin/env node
import { loadCliConfig } from "./config.js";
import { runPairingCli } from "./pairing.js";
import { buildSendEnvelope, sendEnvelope } from "./send.js";
import { fetchTail, formatTail } from "./tail.js";

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;

  if (command === "send") {
    const config = loadCliConfig();
    const to = valueAfter(args, "--to");
    if (!to) throw new Error("send requires --to <recipient>");
    const response = await sendEnvelope(
      config,
      buildSendEnvelope({
        to,
        text: valueAfter(args, "--text"),
        file: valueAfter(args, "--file"),
        from: valueAfter(args, "--from"),
      }),
    );
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (command === "tail") {
    const config = loadCliConfig();
    console.log(formatTail(await fetchTail(config)));
    return;
  }

  if (
    command === "create-card" ||
    command === "request" ||
    command === "summary" ||
    command === "trust-card" ||
    command === "pairing-runbook" ||
    command === "approve" ||
    command === "contacts"
  ) {
    process.stdout.write(await runPairingCli([command, ...args]));
    return;
  }

  throw new Error(
    "Usage: agentcomms send --to echo --text hello | agentcomms tail | agentcomms create-card ... | agentcomms trust-card --card <card.json> | agentcomms pairing-runbook --agent-id <id> | agentcomms request ... | agentcomms approve ... | agentcomms summary --card|--request|--invite <file> | agentcomms contacts list|import-card|import-invite|revoke",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

export * from "./send.js";
export * from "./tail.js";
export * from "./pairing.js";
