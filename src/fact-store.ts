import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { CrossSessionFact, FactStore as FactStoreType } from "./types.js";

const STORE_FILENAME = "cross-session-facts.json";
const MAX_ACTIVE_FACTS = 100;
const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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

    // Atomic write: temp file + rename (prevents corruption on crash)
    const tmpPath = this.storePath + ".tmp";
    writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), "utf-8");
    renameSync(tmpPath, this.storePath);
  }

  upsert(content: string, category: CrossSessionFact["category"], sourceChannel: string, sourceSessionKey: string): CrossSessionFact {
    // Find existing fact with the same topic (same category + similar keywords)
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
      // Last-write-wins: deactivate old fact, new one points to it
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
      // 50%+ overlap of significant words = same topic
      let overlap = 0;
      for (const w of contentWords) {
        if (factWords.has(w)) overlap++;
      }
      return overlap >= Math.min(contentWords.size, factWords.size) * 0.5;
    });
  }

  private cleanup(): void {
    const now = Date.now();
    // Remove inactive facts older than 7 days
    this.data.facts = this.data.facts.filter(
      (f) => f.active || now - f.timestamp < 7 * 24 * 60 * 60 * 1000,
    );
    // Mark stale active facts (older than 30 days)
    for (const f of this.data.facts) {
      if (f.active && now - f.timestamp > STALE_THRESHOLD_MS) {
        f.active = false;
      }
    }
    // Cap total active facts (keep most recent)
    const active = this.data.facts.filter((f) => f.active);
    if (active.length > MAX_ACTIVE_FACTS) {
      active.sort((a, b) => a.timestamp - b.timestamp);
      for (let i = 0; i < active.length - MAX_ACTIVE_FACTS; i++) {
        active[i].active = false;
      }
    }
  }
}
