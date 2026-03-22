import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FactStore } from "../src/fact-store.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("fact-store", () => {
  let tmpDir: string;
  let store: FactStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "fact-store-test-"));
    store = new FactStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("saves and retrieves facts", () => {
    store.upsert("Meeting moved to Thursday", "schedule", "whatsapp", "agent:main:whatsapp:direct:user1");
    const facts = store.getActiveFacts();
    expect(facts).toHaveLength(1);
    expect(facts[0].content).toBe("Meeting moved to Thursday");
    expect(facts[0].active).toBe(true);
  });

  it("shares facts between sessions — excludes source session", () => {
    store.upsert("Meeting moved to Thursday", "schedule", "whatsapp", "agent:main:whatsapp:direct:user1");

    // Slack session CAN see the fact
    const factsForSlack = store.getActiveFactsExcludingSession("agent:main:slack:direct:user1");
    expect(factsForSlack).toHaveLength(1);

    // WhatsApp session CANNOT see it (it's the source)
    const factsForWhatsapp = store.getActiveFactsExcludingSession("agent:main:whatsapp:direct:user1");
    expect(factsForWhatsapp).toHaveLength(0);
  });

  it("resolves conflicts with last-write-wins", () => {
    store.upsert("Favorite color is blue", "preference", "whatsapp", "agent:main:whatsapp:direct:user1");
    store.upsert("Favorite color is green", "preference", "slack", "agent:main:slack:direct:user1");

    const active = store.getActiveFacts();
    expect(active).toHaveLength(1);
    expect(active[0].content).toBe("Favorite color is green");
    expect(active[0].supersedes).toBeDefined();
  });

  it("persists across restarts", () => {
    store.upsert("Important fact", "general", "telegram", "agent:main:telegram:direct:user1");

    // Recreate store from the same directory (simulates restart)
    const store2 = new FactStore(tmpDir);
    const facts = store2.getActiveFacts();
    expect(facts).toHaveLength(1);
    expect(facts[0].content).toBe("Important fact");
  });
});
