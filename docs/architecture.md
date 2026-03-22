# Architecture: Cross-Session Memory Synchronization

## Problem Statement

OpenClaw sessions across different messaging channels (WhatsApp, Slack, Telegram, etc.) maintain independent conversation contexts. When a user shares information on one channel, that knowledge is invisible to other sessions. The shared `memory.md` file on disk is insufficient — not everything should be persisted there, and loading everything into every session's context would be expensive and noisy.

**Goal:** Share relevant knowledge between sessions in near real-time, without unifying contexts and without making every LLM call expensive.

## Solution Overview

An OpenClaw plugin that intercepts inbound messages, extracts actionable facts, stores them locally, and injects relevant cross-session knowledge into other sessions' prompts — all using OpenClaw's official hook system.

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  WhatsApp    │     │    Slack     │     │   Telegram   │
│   Session    │     │   Session    │     │   Session    │
│  [context A] │     │  [context B] │     │  [context C] │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       │  ┌─────────────────┴────────────────┐   │
       └──┤    cross-session-sync plugin     ├───┘
          │                                  │
          │  Hook: message_received          │
          │  ┌────────────────────────────┐  │
          │  │ 1. Noise Filter            │  │
          │  │    (heuristic, zero cost)  │  │
          │  │         │                  │  │
          │  │         ▼                  │  │
          │  │ 2. Fact Extractor          │  │
          │  │    (LLM, ~$0.001/call)     │  │
          │  │         │                  │  │
          │  │         ▼                  │  │
          │  │ 3. Fact Store              │  │
          │  │    (JSON, last-write-wins) │  │
          │  └────────────────────────────┘  │
          │                                  │
          │  Hook: before_prompt_build       │
          │  ┌────────────────────────────┐  │
          │  │ 4. Context Injector        │  │
          │  │    (reads facts, injects   │  │
          │  │     into system prompt of  │  │
          │  │     OTHER sessions)        │  │
          │  └────────────────────────────┘  │
          └──────────────┬───────────────────┘
                         │
               ┌─────────┴─────────┐
               │ cross-session-    │
               │ facts.json        │
               │ (~/.openclaw/)    │
               └───────────────────┘
```

## Data Flow

### Capture Path (message → fact)

1. User sends message on any channel (e.g., WhatsApp)
2. OpenClaw triggers `message_received` hook with message content, channel ID, and session key
3. **Noise Filter** applies zero-cost heuristics:
   - Discards short messages (< 4 words), emoji-only, interjections ("lol", "ok", etc.)
   - Passes messages with factual signals (dates, names, keywords like "meeting", "changed", "prefer")
   - Messages with 7+ words pass through to LLM classification
4. **Fact Extractor** calls a cheap LLM (Claude Haiku via OpenRouter, ~$0.001/call) with a structured prompt that returns JSON: `{"content": "Meeting with Acme moved to Thursday", "category": "schedule"}`
5. **Fact Store** saves the fact to `~/.openclaw/cross-session-facts.json` with:
   - UUID, content, category, source channel, source session key, timestamp
   - Conflict resolution via `findSimilar()` + last-write-wins

### Injection Path (fact → prompt)

1. User sends any message on another channel (e.g., Slack)
2. OpenClaw prepares prompt for LLM, triggers `before_prompt_build` hook
3. Plugin reads active facts from store, **excluding facts from the current session** (no self-injection)
4. Formats facts as a `## Cross-Session Context` section
5. Returns `{ prependContext: injection }` — OpenClaw prepends this to the system prompt
6. LLM receives the prompt with cross-session knowledge and can use it if relevant

## Conflict Resolution

**Strategy: Last-Write-Wins with Supersedes Chain**

When a new fact arrives with the same category and 50%+ keyword overlap with an existing active fact:

1. The existing fact is marked `active: false`
2. The new fact is saved with `supersedes: <old_fact_id>`
3. Only active facts are injected into prompts

```
t=100  WhatsApp: "Favorite color is blue"   → Fact A (active: true)
t=110  Slack:    "Favorite color is green"  → Fact B (active: true, supersedes: A)
                                              Fact A (active: false)

Any session now sees only: "Favorite color is green"
```

**Why this works:**
- Simple and deterministic — no distributed consensus needed
- Auditable — the supersedes chain preserves history
- The challenge explicitly states "perfect consistency is not required, but the behavior must be reasonable and explainable"
- In practice, conflicting updates seconds apart represent the user changing their mind — the latest one wins

## Selective Propagation

### Two-Layer Filtering

**Layer 1: Heuristic Filter (zero cost, filters ~80%)**

| Pattern | Action | Example |
|---|---|---|
| Interjections | Discard | "lol", "ok", "haha", "kkkk" |
| Emoji-only | Discard | "👍", "😂🤣" |
| Very short (≤3 chars) | Discard | "hi", "no", "?" |
| Punctuation-only | Discard | "!!", "???" |
| < 4 words, no signals | Discard | "sure thing" |
| Date/time keywords | Pass | "moved to Thursday" |
| Action keywords | Pass | "meeting cancelled" |
| Preference keywords | Pass | "I prefer dark mode" |
| 7+ words | Pass to LLM | "I was thinking about the project timeline" |

**Layer 2: LLM Classification (only for ambiguous messages)**

A cheap model (Claude Haiku, ~$0.001/call) receives a structured prompt to extract factual content and categorize it. If the LLM returns `null`, the message is not propagated.

### Cost Analysis

| Scenario | Messages/day | Filtered by heuristic | LLM calls | LLM cost/day |
|---|---|---|---|---|
| Light usage | 50 | 40 (80%) | 10 | $0.01 |
| Moderate | 200 | 160 (80%) | 40 | $0.04 |
| Heavy | 500 | 400 (80%) | 100 | $0.10 |

**Prompt overhead per session:** ~200 tokens for injected facts (assuming 10-20 active facts). At current prices, this adds < $0.001 per LLM call.

## Integration with OpenClaw

The plugin uses two official OpenClaw hook APIs — no core modifications required:

| Hook | API | Purpose |
|---|---|---|
| `message_received` | `api.registerHook()` | Capture inbound messages from any channel |
| `before_prompt_build` | `api.on()` | Inject facts into system prompt before LLM call |

Both APIs are part of OpenClaw's public plugin SDK (`openclaw/plugin-sdk/core`). The plugin follows the same pattern as built-in extensions like `memory-core` and `anthropic`.

**Key architectural decisions:**

1. **Hooks over custom Context Engine:** Hooks are less invasive — we inject additional context without replacing the entire context assembly pipeline. This minimizes the risk of breaking existing functionality.

2. **JSON file over SQLite:** The fact store holds at most ~100 active facts. JSON is simpler, human-readable, and sufficient for this scale. SQLite would add complexity without meaningful benefit.

3. **Direct OpenRouter HTTP calls:** For fact extraction, the plugin calls OpenRouter directly rather than routing through OpenClaw's agent system. This avoids creating recursive sessions and keeps the extraction path simple and fast.

4. **Atomic writes (temp + rename):** Prevents data corruption if the process crashes mid-write. Multiple sessions can safely read/write because rename is atomic on POSIX and Windows (NTFS).

## Limitations and Trade-offs

| Limitation | Mitigation |
|---|---|
| LLM extraction adds latency (~500ms) | Async — does not block the message processing pipeline |
| Heuristic filter may miss edge cases | 7+ word messages pass to LLM as fallback |
| Keyword overlap similarity is approximate | Good enough for ~100 facts; embeddings would be overkill |
| Single-machine only (no distributed sync) | OpenClaw is designed as a local-first system |
| Race condition if user switches channels instantly | Async extraction may not complete before next session prompt; acceptable for near real-time |
