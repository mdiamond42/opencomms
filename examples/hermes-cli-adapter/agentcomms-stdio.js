#!/usr/bin/env node
let input = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  try {
    const env = JSON.parse(input);
    const now = new Date();
    const reply = {
      version: "0.1",
      id: crypto.randomUUID(),
      idempotency_key: `hermes_${crypto.randomUUID()}`,
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 60_000).toISOString(),
      sender: { type: "agent", id: "hermes" },
      recipient: env.sender,
      channel: "text",
      intent: "reply",
      requires_ack: false,
      correlation_id: env.id,
      payload: {
        content_type: "text/plain",
        body: `Hermes placeholder: ${env.payload.body}`,
        summary: "placeholder Hermes CLI reply",
      },
      permissions: {
        may_execute_tools: false,
        may_notify_human: true,
        risk_level: "low",
      },
    };
    process.stdout.write(`${JSON.stringify(reply)}\n`);
  } catch (error) {
    process.stderr.write(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
});
