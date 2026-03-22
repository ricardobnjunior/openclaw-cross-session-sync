import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { CrossSessionFact, FactStore as FactStoreType } from "./types.js";

const STORE_FILENAME = "cross-session-facts.json";
const MAX_ACTIVE_FACTS = 100;
const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

export class FactStore {
  private storePath: string;
  private data: FactStoreType;

  constructor(stateDir: string) {
    this.storePath = join(stateDir, STORE_FILENAME);
    this.data = this.load();
  }

  private load(): FactStoreType {
    if (!existsSync(this.storePath)) {
      return { version: 1, facts: [] };
    }
    try {
      return JSON.parse(readFileSync(this.storePath, "utf-8"));
    } catch {
      return { version: 1, facts: [] };
    }
  }

  private save(): void {
    const dir = dirname(this.storePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    // Atomic write: temp file + rename (evita corrupcao)
    const tmpPath = this.storePath + ".tmp";
    writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), "utf-8");
    renameSync(tmpPath, this.storePath);
  }

  upsert(content: string, category: CrossSessionFact["category"], sourceChannel: string, sourceSessionKey: string): CrossSessionFact {
    // Procurar fato existente com mesmo topico (mesmo categoria + palavras-chave similares)
    const existing = this.findSimilar(content, category);

    const newFact: CrossSessionFact = {
      id: randomUUID(),
      content,
      category,
      sourceChannel,
      sourceSessionKey,
      timestamp: Date.now(),
      active: true,
    };

    if (existing) {
      // Last-write-wins: desativa o antigo, novo aponta para ele
      existing.active = false;
      newFact.supersedes = existing.id;
    }

    this.data.facts.push(newFact);
    this.cleanup();
    this.save();
    return newFact;
  }

  getActiveFacts(): CrossSessionFact[] {
    return this.data.facts.filter((f) => f.active);
  }

  getActiveFactsExcludingSession(sessionKey: string): CrossSessionFact[] {
    return this.data.facts.filter((f) => f.active && f.sourceSessionKey !== sessionKey);
  }

  private findSimilar(content: string, category: string): CrossSessionFact | undefined {
    const contentWords = new Set(content.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
    return this.data.facts.find((f) => {
      if (!f.active || f.category !== category) return false;
      const factWords = new Set(f.content.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
      // Overlap de 50%+ das palavras significativas = mesmo topico
      let overlap = 0;
      for (const w of contentWords) {
        if (factWords.has(w)) overlap++;
      }
      return overlap >= Math.min(contentWords.size, factWords.size) * 0.5;
    });
  }

  private cleanup(): void {
    const now = Date.now();
    // Remover fatos inativos velhos
    this.data.facts = this.data.facts.filter(
      (f) => f.active || now - f.timestamp < 7 * 24 * 60 * 60 * 1000,
    );
    // Marcar fatos ativos stale
    for (const f of this.data.facts) {
      if (f.active && now - f.timestamp > STALE_THRESHOLD_MS) {
        f.active = false;
      }
    }
    // Limitar total de fatos ativos
    const active = this.data.facts.filter((f) => f.active);
    if (active.length > MAX_ACTIVE_FACTS) {
      active.sort((a, b) => a.timestamp - b.timestamp);
      for (let i = 0; i < active.length - MAX_ACTIVE_FACTS; i++) {
        active[i].active = false;
      }
    }
  }
}