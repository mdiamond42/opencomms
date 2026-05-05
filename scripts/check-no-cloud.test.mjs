#!/usr/bin/env node
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const repo = new URL("..", import.meta.url).pathname;

function runFixture(files) {
  const root = mkdtempSync(join(tmpdir(), "agentcomms no-cloud fixture "));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const path = join(root, relativePath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
    return spawnSync("sh", [join(repo, "scripts/check-no-cloud.sh")], {
      cwd: repo,
      env: { ...process.env, CHECK_NO_CLOUD_ROOT: root },
      encoding: "utf8",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const allowed = runFixture({
  "README.md": "example: https://relay.example.com\n",
  "src/Schemes.kt": "url.replace(\"https://\", \"wss://\"); url.startsWith(\"https://\")\n",
  "src/AndroidManifest.xml": "<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\" xmlns:tools=\"http://schemas.android.com/tools\">\n",
  "test/example.test.ts": "const url = \"https://relay.example.com\";\n",
  "src/test/resources/pairing.json": "{\"relay_url\":\"https://relay.example.com\"}\n",
});

if (allowed.status !== 0) {
  console.error("Expected allowed examples/schema/scheme literals to pass.");
  console.error(allowed.stdout);
  console.error(allowed.stderr);
  process.exit(1);
}

const blocked = runFixture({
  "src/BadEndpoint.ts": "export const relay = \"https://relay.example.com\";\n",
});

if (blocked.status === 0) {
  console.error("Expected production source cloud endpoint to fail.");
  process.exit(1);
}

if (!`${blocked.stdout}\n${blocked.stderr}`.includes("check:no-cloud failed")) {
  console.error("Expected failure output to mention check:no-cloud failed.");
  console.error(blocked.stdout);
  console.error(blocked.stderr);
  process.exit(1);
}

const mixedWithLocalhost = runFixture({
  "src/BadMixedLocal.ts":
    "export const relays = [\"https://relay.example.com\", \"http://localhost:5173\"];\n",
});

if (mixedWithLocalhost.status === 0) {
  console.error(
    "Expected remote URL on the same production source line as localhost to fail.",
  );
  process.exit(1);
}

const mixedWithSchemeOnly = runFixture({
  "src/BadMixedScheme.ts":
    "export const relay = \"https://relay.example.com\"; if (url.startsWith(\"https://\")) return url;\n",
});

if (mixedWithSchemeOnly.status === 0) {
  console.error(
    "Expected remote URL on the same production source line as a scheme-only literal to fail.",
  );
  process.exit(1);
}

const mixedWithXmlNamespace = runFixture({
  "src/BadMixedNamespace.xml":
    "<manifest endpoint=\"https://relay.example.com\" xmlns:android=\"http://schemas.android.com/apk/res/android\" />\n",
});

if (mixedWithXmlNamespace.status === 0) {
  console.error(
    "Expected remote URL on the same production source line as an XML namespace to fail.",
  );
  process.exit(1);
}

console.log("check-no-cloud fixture tests passed");
