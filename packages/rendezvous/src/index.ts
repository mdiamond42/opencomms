#!/usr/bin/env node
import { startRendezvous } from "./server.js";

export * from "./logging.js";
export * from "./server.js";

if (import.meta.url === `file://${process.argv[1]}`) {
  const bind = process.env.OPENCOMMS_RENDEZVOUS_BIND ?? process.env.AGENTCOMMS_RENDEZVOUS_BIND ?? "0.0.0.0";
  const port = Number(process.env.PORT ?? process.env.OPENCOMMS_RENDEZVOUS_PORT ?? process.env.AGENTCOMMS_RENDEZVOUS_PORT ?? "8788");
  const token = process.env.OPENCOMMS_RENDEZVOUS_TOKEN ?? process.env.AGENTCOMMS_RENDEZVOUS_TOKEN;
  const runtime = await startRendezvous({ bind, port, token });
  console.log(JSON.stringify({ event: "ready", url: runtime.url }));

  const shutdown = async () => {
    await runtime.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
