# Cross-Session Memory Synchronization for OpenClaw

An OpenClaw plugin that synchronizes relevant knowledge between independent messaging sessions in near real-time. When a user shares information on one channel (e.g., WhatsApp), that knowledge becomes available to the assistant on other channels (e.g., Slack, Telegram) — without merging conversation contexts or inflating token costs.

## How It Works

```
User on WhatsApp: "My meeting with Acme was moved to Thursday"
    │
    ▼
Plugin captures message → filters noise → extracts fact → stores locally
    │
    ▼
User on Slack: "When is my Acme meeting?"
    │
    ▼
Plugin injects fact into Slack session's prompt → LLM knows the answer
```

The plugin uses two OpenClaw hooks:
- **`message_received`** — intercepts inbound messages, filters noise via heuristics, extracts facts via a cheap LLM call, stores them with conflict resolution
- **`before_prompt_build`** — injects relevant facts from other sessions into the system prompt before each LLM call

## Key Features

- **Near real-time sync** — facts available within seconds across all sessions
- **Selective propagation** — two-layer filtering (heuristic + LLM) prevents noise from polluting other sessions
- **Conflict resolution** — last-write-wins with supersedes chain preserves history
- **Zero core modifications** — pure plugin using OpenClaw's official hook API
- **Cost-efficient** — heuristic filter eliminates ~80% of messages without any LLM call; fact extraction uses the cheapest available model

## Prerequisites

- Node.js 22.16+ (recommended: 24)
- pnpm
- An OpenRouter API key (or any OpenAI-compatible LLM provider)
- OpenClaw installed and configured

## Installation

### 1. Clone and set up OpenClaw

```bash
git clone https://github.com/ricardobnjunior/openclaw-cross-session-sync.git
cd openclaw-cross-session-sync
```

### 2. Install as an OpenClaw extension

Copy the plugin into your OpenClaw installation's `extensions/` directory:

```bash
cp -r . /path/to/openclaw/extensions/cross-session-sync
cd /path/to/openclaw
pnpm install
```

### 3. Set your OpenRouter API key

```bash
export OPENROUTER_API_KEY="sk-or-v1-..."
```

### 4. Start the gateway

```bash
openclaw gateway
```

The plugin loads automatically on startup. You should see `Cross-session sync plugin loaded` in the logs.

## Running Tests

```bash
# From the OpenClaw root directory
pnpm vitest run extensions/cross-session-sync/tests/
```

### Test Coverage

| Test File | What It Covers |
|---|---|
| `noise-filter.test.ts` | Noise messages discarded, factual messages accepted |
| `fact-store.test.ts` | Save/retrieve, session exclusion, conflict resolution, persistence |
| `fact-extractor.test.ts` | LLM extraction, null handling, invalid JSON resilience |
| `integration.test.ts` | **3 mandatory scenarios:** fact sharing, conflict resolution, noise filtering |

### The 3 Mandatory Scenarios

1. **Fact shared across sessions** — A fact stated on WhatsApp becomes available when querying from Slack
2. **Conflicting updates resolved** — "Favorite color is blue" (WhatsApp) then "Favorite color is green" (Slack) → only "green" is active
3. **Noise not propagated** — Messages like "lol", "ok", "👍" never reach other sessions

## Manual Testing

1. Open two TUI sessions in separate terminals:
   ```bash
   # Terminal 1
   openclaw tui

   # Terminal 2
   openclaw tui
   ```

2. In Terminal 1, say: `My meeting with Acme Corp was moved to Thursday`

3. In Terminal 2, ask: `When is my Acme Corp meeting?`

4. The assistant in Terminal 2 should know about the Thursday meeting — even though it was never mentioned in that session.

## Project Structure

```
├── src/
│   ├── index.ts              # Entry point — registers hooks, wires components
│   ├── types.ts              # TypeScript interfaces (CrossSessionFact, etc.)
│   ├── noise-filter.ts       # Heuristic noise filter (zero LLM cost)
│   ├── fact-store.ts         # JSON-based fact store with conflict resolution
│   └── fact-extractor.ts     # LLM-based fact extraction
├── tests/
│   ├── noise-filter.test.ts  # Noise filter unit tests
│   ├── fact-store.test.ts    # Fact store unit tests
│   ├── fact-extractor.test.ts # Fact extractor unit tests
│   └── integration.test.ts   # End-to-end integration tests
├── docs/
│   ├── architecture.md       # Architecture document with diagrams
│   └── discussion.md         # Discussion questions and analysis
├── package.json              # npm manifest
└── openclaw.plugin.json      # OpenClaw plugin manifest
```

## Documentation

- [Architecture Document](docs/architecture.md) — System design, data flow, conflict resolution, cost analysis
- [Discussion](docs/discussion.md) — Alternatives analysis, OpenClaw pros/cons, fork maintenance strategy
