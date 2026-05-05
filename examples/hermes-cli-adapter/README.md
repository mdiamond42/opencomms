# Hermes CLI Adapter Contract

`CliAdapter` starts a command, writes one AgentComms envelope as JSON to stdin, and expects either:

- one reply envelope as JSON on stdout, or
- empty stdout for fire-and-forget delivery.

The placeholder `agentcomms-stdio.js` proves the contract without calling a real Hermes process. Configure it locally:

```json
{
  "adapters": {
    "echo": { "kind": "echo" },
    "hermes": {
      "kind": "cli",
      "command": "node",
      "args": ["examples/hermes-cli-adapter/agentcomms-stdio.js"]
    }
  }
}
```
