import { describe, it, expect } from "vitest";
import { extractFact } from "../src/fact-extractor.js";

describe("fact-extractor", () => {
  // Mock LLM that returns a controlled response (no real OpenRouter call)
  const mockLlm = (response: string) => async (_prompt: string) => response;

  it("extracts fact from message", async () => {
    const result = await extractFact(
      "My meeting with Acme was moved to Thursday",
      mockLlm('{"content": "Meeting with Acme moved to Thursday", "category": "schedule"}'),
    );
    expect(result).toEqual({
      content: "Meeting with Acme moved to Thursday",
      category: "schedule",
    });
  });

  it("returns null for message with no fact", async () => {
    const result = await extractFact(
      "haha that's funny",
      mockLlm('{"content": null, "category": null}'),
    );
    expect(result).toBeNull();
  });

  it("returns null if LLM returns invalid JSON", async () => {
    const result = await extractFact(
      "some message",
      mockLlm("this is not json"),
    );
    expect(result).toBeNull();
  });
});
