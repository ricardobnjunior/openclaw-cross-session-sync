import { describe, it, expect } from "vitest";
import { isRelevantMessage } from "../src/noise-filter.js";

describe("noise-filter", () => {
  describe("discards noise", () => {
    const noiseMessages = ["lol", "ok", "haha", "👍", "kkkk", "rsrs", "!!", "?", "hi", "yes", "no", "😂🤣"];
    for (const msg of noiseMessages) {
      it(`rejects: "${msg}"`, () => {
        expect(isRelevantMessage(msg)).toBe(false);
      });
    }
  });

  describe("detects relevant messages", () => {
    const relevantMessages = [
      "My meeting with Acme Corp was moved to Thursday",
      "Reuniao com cliente cancelada para amanha",
      "I prefer using dark mode in all applications",
      "We decided to use PostgreSQL for the new project",
      "Call John at 555-1234 tomorrow morning",
      "Dont forget to submit the report by Friday",
      "Meu email novo e joao@example.com",
    ];
    for (const msg of relevantMessages) {
      it(`accepts: "${msg}"`, () => {
        expect(isRelevantMessage(msg)).toBe(true);
      });
    }
  });
});
