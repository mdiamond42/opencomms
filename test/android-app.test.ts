import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const androidDir = join(process.cwd(), "apps", "android");

describe("OpenComms Android v1 scaffold", () => {
  it("declares an Android app with internet permission and MainActivity", () => {
    const manifestPath = join(androidDir, "app", "src", "main", "AndroidManifest.xml");
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = readFileSync(manifestPath, "utf8");
    expect(manifest).toContain("android.permission.INTERNET");
    expect(manifest).toContain(".MainActivity");
  });

  it("implements the rendezvous WebSocket protocol for phone-to-agent messages", () => {
    const activityPath = join(androidDir, "app", "src", "main", "java", "com", "opencomms", "baja", "MainActivity.kt");
    expect(existsSync(activityPath)).toBe(true);
    const activity = readFileSync(activityPath, "utf8");
    expect(activity).toContain("/v0/ws");
    expect(activity).toContain("type\", \"register");
    expect(activity).toContain("type\", \"envelope");
    expect(activity).toContain("put(\"envelope\", env)");
    expect(activity).toContain("targetIdForSelection");
    expect(activity).toContain("put(\"recipient\", JSONObject().put(\"type\", \"agent\").put(\"id\", targetId))");
    expect(activity).toContain("OPENCOMMS_RENDEZVOUS_TOKEN");
  });

  it("keeps relay settings local and avoids committing a real token", () => {
    const activityPath = join(androidDir, "app", "src", "main", "java", "com", "opencomms", "baja", "MainActivity.kt");
    const activity = readFileSync(activityPath, "utf8");
    expect(activity).toContain("SharedPreferences");
    expect(activity).toContain("Paste OpenComms token here");
    expect(activity).toContain("Toast.makeText");
    expect(activity).toContain("Connect tapped");
    expect(activity).not.toMatch(/sk-or-[A-Za-z0-9_-]+/);
    expect(activity).not.toMatch(/OPENCOMMS_RENDEZVOUS_TOKEN\s*=\s*\"[^\"]{8,}\"/);
  });
});
