export interface CrossSessionFact {
  id: string;
  content: string;
  category: "schedule" | "preference" | "decision" | "contact" | "task" | "general";
  sourceChannel: string;
  sourceSessionKey: string;
  timestamp: number;
  supersedes?: string;
  active: boolean;
}

export interface FactStore {
  version: number;
  facts: CrossSessionFact[];
}

export interface ExtractionResult {
  content: string;
  category: CrossSessionFact["category"];
}