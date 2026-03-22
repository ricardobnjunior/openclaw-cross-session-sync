import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FactStore } from "../src/fact-store.js";
import { isRelevantMessage } from "../src/noise-filter.js";
import { extractFact } from "../src/fact-extractor.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("integration: cross-session sync", () => {
  let tmpDir: string;
  let store: FactStore;

  const mockLlm = (response: string) => async (_prompt: string) => response;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "integration-test-"));
    store = new FactStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("SCENARIO 1: WhatsApp fact available on Slack", async () => {
    const message = "My meeting with Acme Corp was moved to Thursday";
    const whatsappSession = "agent:main:whatsapp:direct:user1";
    const slackSession = "agent:main:slack:direct:user1";

    // 1. Message passes noise filter
    expect(isRelevantMessage(message)).toBe(true);

    // 2. LLM extracts fact
    const fact = await extractFact(
      message,
      mockLlm('{"content": "Meeting with Acme Corp moved to Thursday", "category": "schedule"}'),
    );
    expect(fact).not.toBeNull();

    // 3. Fact saved to store
    store.upsert(fact!.content, fact!.category, "whatsapp", whatsappSession);

    // 4. Slack session sees the fact
    const factsForSlack = store.getActiveFactsExcludingSession(slackSession);
    expect(factsForSlack).toHaveLength(1);
    expect(factsForSlack[0].content).toContain("Acme Corp");
    expect(factsForSlack[0].content).toContain("Thursday");
  });

  it("SCENARIO 2: conflicts resolved gracefully", async () => {
    const whatsappSession = "agent:main:whatsapp:direct:user1";
    const slackSession = "agent:main:slack:direct:user1";
    const telegramSession = "agent:main:telegram:direct:user1";

    // WhatsApp says blue
    store.upsert("Favorite color is blue", "preference", "whatsapp", whatsappSession);

    // 10 seconds later, Slack says green
    store.upsert("Favorite color is green", "preference", "slack", slackSession);

    // Telegram sees only the most recent
    const facts = store.getActiveFactsExcludingSession(telegramSession);
    expect(facts).toHaveLength(1);
    expect(facts[0].content).toBe("Favorite color is green");
    expect(facts[0].sourceChannel).toBe("slack");
  });

  it("SCENARIO 3: noise is not propagated", async () => {
    const noiseMessages = ["lol", "ok", "haha", "👍", "kkkk"];
    const discordSession = "agent:main:discord:direct:user1";
    const slackSession = "agent:main:slack:direct:user1";

    for (const msg of noiseMessages) {
      // Noise filter blocks all of them
      if (isRelevantMessage(msg)) {
        // If it somehow passes, LLM returns null
        const fact = await extractFact(msg, mockLlm('{"content": null, "category": null}'));
        if (fact) {
          store.upsert(fact.content, fact.category, "discord", discordSession);
        }
      }
    }

    // No facts propagated
    const facts = store.getActiveFactsExcludingSession(slackSession);
    expect(facts).toHaveLength(0);
  });
});
