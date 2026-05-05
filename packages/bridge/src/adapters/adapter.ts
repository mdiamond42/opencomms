import type { EnvelopeV01 } from "@agentcomms/protocol";

export interface AgentAdapter {
  id: string;
  send(env: EnvelopeV01): Promise<EnvelopeV01 | null>;
  close(): Promise<void>;
}
