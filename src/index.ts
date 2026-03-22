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
    // Resolver diretorio de estado do OpenClaw (~/.openclaw/)
    const stateDir = join(
      process.env.HOME || process.env.USERPROFILE || "~",
      ".openclaw",
    );
    const factStore = new FactStore(stateDir);

    // ─── Hook 1: Capturar mensagens inbound ───────────────────
    // Toda vez que o usuario manda uma mensagem em QUALQUER canal,
    // este hook dispara. Filtra ruido, extrai fato, salva no store.
    api.on(
      "message_received",
      async (event, ctx) => {
        const content = event.content;
        const channelId = ctx.channelId;
        const senderId = event.from ?? "unknown";
        const sessionKey = `${channelId}:${senderId}`;

        api.logger.info(`[cross-session-sync] message_received: "${content}" from ${channelId} (${senderId})`);

        if (typeof content !== "string" || !content.trim()) return;

        // Filtro de ruido (custo zero — sem LLM)
        if (!isRelevantMessage(content)) {
          api.logger.info(`[cross-session-sync] filtered as noise: "${content}"`);
          return;
        }

        api.logger.info(`[cross-session-sync] passed noise filter, extracting fact...`);

        // Extrair fato via LLM barato (OpenRouter → Haiku)
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

        // Salvar fato no store (com resolucao de conflitos automatica)
        factStore.upsert(
          result.content,
          result.category,
          channelId,
          sessionKey,
        );

        api.logger.info(`[cross-session-sync] fact saved: "${result.content}" (${result.category}) from ${channelId}`);
      },
    );

    // ─── Hook 2: Injetar fatos no prompt de outras sessoes ────
    // Quando qualquer sessao esta montando o prompt para enviar ao LLM,
    // este hook injeta fatos de OUTRAS sessoes no system prompt.
    // Assim o agente "sabe" o que foi dito em outros canais.
    api.on(
      "before_prompt_build",
      (_event, ctx) => {
        const sessionKey = ctx.sessionKey;
        if (!sessionKey) return {};

        // Buscar fatos ativos que NAO vieram desta sessao
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

        // prependContext adiciona esse texto no inicio do system prompt
        return { prependContext: injection };
      },
      { priority: 50 },
    );

    api.logger.info("Cross-session sync plugin loaded");
  },
});