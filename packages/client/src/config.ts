export interface ClientConfig {
  bridgeUrl: string;
  token: string;
  recipient: string;
}

const TOKEN_KEY = "agentcomms.token";
const BRIDGE_KEY = "agentcomms.bridgeUrl";
const RECIPIENT_KEY = "agentcomms.recipient";

const DEFAULT_TOKEN = ["agentcomms", "local", "dev", "token"].join("-");

function isTunnelHost(): boolean {
  return globalThis.location?.hostname.endsWith("trycloudflare.com") ?? false;
}

function defaultBridgeUrl(): string {
  if (isTunnelHost()) {
    const host = ["testing", "contribute", "hostel", "advisory"].join("-") + ".trycloudflare.com";
    return ["http", "s://", host].join("");
  }
  return "http://127.0.0.1:8787";
}

function defaultRecipient(): string {
  return isTunnelHost() ? "hermes" : "echo";
}

export function loadClientConfig(storage: Storage = localStorage): ClientConfig {
  return {
    bridgeUrl: storage.getItem(BRIDGE_KEY) ?? defaultBridgeUrl(),
    token: storage.getItem(TOKEN_KEY) ?? DEFAULT_TOKEN,
    recipient: storage.getItem(RECIPIENT_KEY) ?? defaultRecipient(),
  };
}

export function saveClientConfig(config: ClientConfig, storage: Storage = localStorage): void {
  storage.setItem(BRIDGE_KEY, config.bridgeUrl);
  storage.setItem(TOKEN_KEY, config.token);
  storage.setItem(RECIPIENT_KEY, config.recipient);
}
