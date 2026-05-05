#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { startBridge } from "./server.js";

const runtime = await startBridge(loadConfig());
console.log(`AgentComms bridge listening on ${runtime.url}`);

process.on("SIGINT", () => {
  void runtime.close().then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void runtime.close().then(() => process.exit(0));
});

export * from "./server.js";
export * from "./config.js";
export * from "./router.js";
export * from "./rendezvousClient.js";
export * from "./recall.js";
