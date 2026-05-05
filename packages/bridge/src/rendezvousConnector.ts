#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { startBridge } from "./server.js";
import { startRendezvousBridge } from "./rendezvousClient.js";

const relayUrl = process.env.OPENCOMMS_RENDEZVOUS_URL ?? process.env.AGENTCOMMS_RENDEZVOUS_URL;
const userId = process.env.OPENCOMMS_USER_ID ?? process.env.AGENTCOMMS_USER_ID ?? "hermes";
const token = process.env.OPENCOMMS_RENDEZVOUS_TOKEN ?? process.env.AGENTCOMMS_RENDEZVOUS_TOKEN;

if (!relayUrl) {
  throw new Error("Set OPENCOMMS_RENDEZVOUS_URL to connect the local bridge to the rendezvous relay");
}

const bridge = await startBridge(loadConfig());
const rendezvous = startRendezvousBridge({ relayUrl, userId, token, router: bridge.router });
console.log(JSON.stringify({ event: "opencomms_bridge_connected", bridge_url: bridge.url, relay_url: relayUrl, user_id: userId }));

const shutdown = async () => {
  rendezvous.close();
  await bridge.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
