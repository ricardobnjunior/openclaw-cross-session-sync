import { describe, it, expect } from "vitest";
import { extractFact } from "../src/fact-extractor.js";

describe("fact-extractor", () => {
  // Mock LLM que retorna resposta controlada (sem chamar OpenRouter de verdade)
  const mockLlm = (response: string) => async (_prompt: string) => response;

  it("extrai fato de mensagem", async () => {
    const result = await extractFact(
      "My meeting with Acme was moved to Thursday",
      mockLlm('{"content": "Meeting with Acme moved to Thursday", "category": "schedule"}'),
    );
    expect(result).toEqual({
      content: "Meeting with Acme moved to Thursday",
      category: "schedule",
    });
  });

  it("retorna null para mensagem sem fato", async () => {
    const result = await extractFact(
      "haha that's funny",
      mockLlm('{"content": null, "category": null}'),
    );
    expect(result).toBeNull();
  });

  it("retorna null se LLM retorna JSON invalido", async () => {
    const result = await extractFact(
      "some message",
      mockLlm("this is not json"),
    );
    expect(result).toBeNull();
  });
});