import { loadClientConfig, saveClientConfig, type ClientConfig } from "./config.js";
import { BridgeClient, fetchTranscripts } from "./net/bridgeClient.js";
import { transition, type Session } from "./state/session.js";
import "./ui/styles.css";

let config = loadClientConfig();
let client: BridgeClient | null = null;
let session: Session = { state: "idle", error: null };
const messages: string[] = [];

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing app root");
const appRoot: HTMLDivElement = app;

function render(): void {
  appRoot.innerHTML = `
    <section class="shell">
      <header class="topbar">
        <div class="brand">AgentComms</div>
        <div class="status">${session.state}</div>
      </header>
      <div class="panel">
        <form class="settings" id="settings">
          <label>Bridge URL<input name="bridgeUrl" value="${config.bridgeUrl}" /></label>
          <label>Token<input name="token" type="password" value="${config.token}" /></label>
          <label>Recipient<input name="recipient" value="${config.recipient}" /></label>
        </form>
        <section class="composer">
          <textarea id="text" placeholder="Type to your local agent"></textarea>
          <div class="actions">
            <button id="connect" type="button">Connect</button>
            <button id="send" type="button">Send</button>
            <button id="tail" class="secondary" type="button">Load transcript</button>
          </div>
        </section>
        <section class="transcript">
          <div class="messages">${messages.map((message) => `<div class="message">${escapeHtml(message)}</div>`).join("")}</div>
        </section>
      </div>
    </section>
  `;
  bindEvents();
}

function readForm(): ClientConfig {
  const form = document.querySelector<HTMLFormElement>("#settings");
  if (!form) return config;
  const data = new FormData(form);
  return {
    bridgeUrl: String(data.get("bridgeUrl") ?? config.bridgeUrl),
    token: String(data.get("token") ?? "agentcomms-local-dev-token"),
    recipient: String(data.get("recipient") ?? "echo"),
  };
}

function bindEvents(): void {
  document.querySelector("#connect")?.addEventListener("click", async () => {
    config = readForm();
    saveClientConfig(config);
    client?.close();
    client = new BridgeClient(config);
    client.onMessage((env) => {
      messages.unshift(`${env.sender.id}: ${env.payload.body}`);
      session = transition(session, "reply");
      render();
    });
    session = transition(session, "connect");
    render();
    await client.connect();
    session = transition(session, "ready");
    render();
  });
  document.querySelector("#send")?.addEventListener("click", () => {
    const text = document.querySelector<HTMLTextAreaElement>("#text")?.value.trim();
    if (!text) return;
    messages.unshift(`you: ${text}`);
    session = transition(session, "send");
    client?.sendText(text);
    render();
  });
  document.querySelector("#tail")?.addEventListener("click", async () => {
    config = readForm();
    const rows = await fetchTranscripts(config);
    messages.unshift(`transcript rows: ${rows.length}`);
    render();
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[char] ?? char;
  });
}

render();
