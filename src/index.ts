import { definePluginEntry } from "openclaw/plugin-sdk/core";
import { FactStore } from "./fact-store.js";
import { isRelevantMessage } from "./noise-filter.js";
import { extractFact } from "./fact-extractor.js";
import { join } from "node:path";

export default definePluginEntry({
  id: "cross-session-sync",
  name: "Cross-Session Memory Sync",
  description: "Synchronizes relevant knowledge between sessions in near real-time",

  register(api) {
    // Resolve OpenClaw state directory (~/.openclaw/)
    const stateDir = join(
      process.env.HOME || process.env.USERPROFILE || "~",
      ".openclaw",
    );
    const factStore = new FactStore(stateDir);

    // ─── Hook 1: Capture inbound messages ───────────────────
    // Fires on every user message across ALL channels.
    // Filters noise, extracts facts, saves to store.
    api.on(
      "message_received",
      async (event, ctx) => {
        const content = event.content;
        const channelId = ctx.channelId;
        const senderId = event.from ?? "unknown";
        const sessionKey = `${channelId}:${senderId}`;

        api.logger.info(`[cross-session-sync] message_received: "${content}" from ${channelId} (${senderId})`);

        if (typeof content !== "string" || !content.trim()) return;

        // Noise filter (zero cost — no LLM)
        if (!isRelevantMessage(content)) {
          api.logger.info(`[cross-session-sync] filtered as noise: "${content}"`);
          return;
        }

        api.logger.info(`[cross-session-sync] passed noise filter, extracting fact...`);

        // Extract fact via cheap LLM (OpenRouter)
        const result = await extractFact(content, async (prompt) => {
          const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            },
            body: JSON.stringify({
              model: "anthropic/claude-haiku-4-5",
              messages: [{ role: "user", content: prompt }],
              max_tokens: 200,
            }),
          });
          const data = (await response.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          return data.choices?.[0]?.message?.content ?? "";
        });

        if (!result) return;

        // Save fact to store (with automatic conflict resolution)
        factStore.upsert(
          result.content,
          result.category,
          channelId,
          sessionKey,
        );

        api.logger.info(`[cross-session-sync] fact saved: "${result.content}" (${result.category}) from ${channelId}`);
      },
    );

    // ─── Hook 2: Inject facts into other sessions' prompts ────
    // When any session builds a prompt for the LLM, this hook
    // injects facts from OTHER sessions into the system prompt.
    api.on(
      "before_prompt_build",
      (_event, ctx) => {
        const sessionKey = ctx.sessionKey;
        if (!sessionKey) return {};

        // Get active facts NOT from this session
        const facts = factStore.getActiveFactsExcludingSession(sessionKey);
        if (facts.length === 0) return {};

        const lines = facts.map((f) => {
          const time = new Date(f.timestamp).toLocaleString();
          return `- [${f.sourceChannel}, ${time}] ${f.content}`;
        });

        const injection = [
          "## Cross-Session Context",
          "The following information was shared by the user in other messaging sessions:",
          ...lines,
          "",
        ].join("\n");

        // Prepend this text to the system prompt
        return { prependContext: injection };
      },
      { priority: 50 },
    );

    api.logger.info("Cross-session sync plugin loaded");
  },
});
