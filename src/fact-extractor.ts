import type { ExtractionResult } from "./types.js";

const EXTRACTION_PROMPT = `You are a fact extractor. Given a user message, extract the main factual information as a short declarative sentence.

Categorize as one of: schedule, preference, decision, contact, task, general.

Respond ONLY with JSON: {"content": "...", "category": "..."}

If the message contains no extractable fact, respond: {"content": null, "category": null}

Examples:
- "My meeting with Acme Corp was moved to Thursday" → {"content": "Meeting with Acme Corp moved to Thursday", "category": "schedule"}
- "I prefer dark mode" → {"content": "User prefers dark mode", "category": "preference"}
- "Call John at 555-1234" → {"content": "John's phone number is 555-1234", "category": "contact"}
- "We decided to use PostgreSQL" → {"content": "Decision: use PostgreSQL", "category": "decision"}`;

export async function extractFact(
  message: string,
  llmCall: (prompt: string) => Promise<string>,
): Promise<ExtractionResult | null> {
  try {
    const response = await llmCall(
      `${EXTRACTION_PROMPT}\n\nMessage: "${message}"`,
    );

    const cleaned = response.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    if (!parsed.content || !parsed.category) return null;

    return {
      content: parsed.content,
      category: parsed.category,
    };
  } catch {
    return null;
  }
}