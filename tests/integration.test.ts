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

  it("CENARIO 1: fato do WhatsApp disponivel no Slack", async () => {
    const message = "My meeting with Acme Corp was moved to Thursday";
    const whatsappSession = "agent:main:whatsapp:direct:user1";
    const slackSession = "agent:main:slack:direct:user1";

    // 1. Mensagem passa pelo noise filter
    expect(isRelevantMessage(message)).toBe(true);

    // 2. LLM extrai fato
    const fact = await extractFact(
      message,
      mockLlm('{"content": "Meeting with Acme Corp moved to Thursday", "category": "schedule"}'),
    );
    expect(fact).not.toBeNull();

    // 3. Fato salvo no store
    store.upsert(fact!.content, fact!.category, "whatsapp", whatsappSession);

    // 4. Sessao do Slack ve o fato
    const factsForSlack = store.getActiveFactsExcludingSession(slackSession);
    expect(factsForSlack).toHaveLength(1);
    expect(factsForSlack[0].content).toContain("Acme Corp");
    expect(factsForSlack[0].content).toContain("Thursday");
  });

  it("CENARIO 2: conflitos resolvidos gracefully", async () => {
    const whatsappSession = "agent:main:whatsapp:direct:user1";
    const slackSession = "agent:main:slack:direct:user1";
    const telegramSession = "agent:main:telegram:direct:user1";

    // WhatsApp diz azul
    store.upsert("Favorite color is blue", "preference", "whatsapp", whatsappSession);

    // 10 segundos depois, Slack diz verde
    store.upsert("Favorite color is green", "preference", "slack", slackSession);

    // Telegram ve so o mais recente
    const facts = store.getActiveFactsExcludingSession(telegramSession);
    expect(facts).toHaveLength(1);
    expect(facts[0].content).toBe("Favorite color is green");
    expect(facts[0].sourceChannel).toBe("slack");
  });

  it("CENARIO 3: ruido nao e propagado", async () => {
    const noiseMessages = ["lol", "ok", "haha", "👍", "kkkk"];
    const discordSession = "agent:main:discord:direct:user1";
    const slackSession = "agent:main:slack:direct:user1";

    for (const msg of noiseMessages) {
      // Noise filter barra todas
      if (isRelevantMessage(msg)) {
        // Se por algum motivo passar, LLM retorna null
        const fact = await extractFact(msg, mockLlm('{"content": null, "category": null}'));
        if (fact) {
          store.upsert(fact.content, fact.category, "discord", discordSession);
        }
      }
    }

    // Nenhum fato propagado
    const facts = store.getActiveFactsExcludingSession(slackSession);
    expect(facts).toHaveLength(0);
  });
});