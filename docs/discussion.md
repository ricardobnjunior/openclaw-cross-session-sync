# Discussion Questions

## 2.1 — Alternatives to OpenClaw

If not using OpenClaw, the strongest alternative for cross-session memory synchronization would be a **custom lightweight framework built on top of a message broker**.

### Architecture: Custom Solution

- **Core:** A Node.js or Python service that acts as a unified message router
- **Message broker:** Redis Pub/Sub or NATS for real-time event propagation between sessions
- **Channel adapters:** Lightweight wrappers around each platform's API (WhatsApp Business API, Slack Events API, Telegram Bot API)
- **LLM integration:** Direct API calls to Anthropic/OpenAI with a shared context manager
- **Memory:** PostgreSQL with pgvector for persistent fact storage with semantic search

### Comparison with OpenClaw

| Dimension | OpenClaw | Custom Solution |
|---|---|---|
| **Extensibility** | Plugin SDK with hooks, tools, context engines. Rich but TypeScript-only. | Full control — any language, any architecture. No SDK constraints. |
| **Multi-channel support** | 25+ channels built-in. Mature adapters with pairing, groups, threads. | Must build each adapter from scratch. WhatsApp alone requires Business API approval. |
| **Local-first vs cloud** | Local-first by design. All data on disk. Privacy-friendly. | Cloud-first is natural (message broker needs a server). Local-first requires extra engineering. |
| **Community maturity** | Young project. Active development, but API surface still evolving. Breaking changes possible. | No community — you own everything. Full control, full maintenance burden. |

### Verdict

OpenClaw's **25+ channel adapters** are the decisive advantage. Building and maintaining adapters for WhatsApp, Slack, Telegram, Discord, and others is a massive engineering effort that OpenClaw provides out of the box. The cross-session sync problem is solvable with a plugin — no need to rebuild the messaging infrastructure.

A custom solution makes sense only if you need: (a) cloud-native deployment, (b) multi-user/multi-tenant support, or (c) a language other than TypeScript for the core logic.

### Other Frameworks Considered

- **LangGraph / LangChain:** Strong for LLM orchestration, but no built-in multi-channel messaging. You'd still need to build or integrate channel adapters. Adds significant abstraction overhead for what is fundamentally a message routing problem.
- **AutoGen / CrewAI:** Designed for multi-agent collaboration, not multi-channel user-facing assistants. The mental model (agents talking to each other) doesn't map well to the problem of syncing user context across channels.
- **Botpress / Rasa:** Mature chatbot platforms with multi-channel support, but opinionated about conversation design (flow-based). Less flexible for the open-ended assistant use case OpenClaw targets. Cloud-first, which conflicts with OpenClaw's local-first philosophy.

---

## 2.2 — Advantages and Disadvantages of OpenClaw

### Strongest Architectural Decisions

1. **Local-first with file-based state.** Sessions are JSONL files, config is JSON5, memory is indexed markdown. No database server to manage, no cloud dependency. Data stays on the user's machine. This is a strong privacy and simplicity advantage.

2. **Pluggable context engine.** The `ContextEngine` interface with `assemble()`, `ingest()`, and `compact()` is well-designed. The registry pattern with Symbol-keyed globals allows clean extension without monkey-patching. The legacy engine wrapper ensures backward compatibility.

3. **Hook system with clear lifecycle.** The `before_prompt_build`, `message_received`, `llm_input`, `llm_output`, `agent_end` hooks cover the full message lifecycle. Plugins can observe and modify behavior at well-defined points. Error isolation (catch-and-continue) prevents one plugin from crashing others.

4. **Channel adapter abstraction.** 25+ channels sharing a unified inbound/outbound pipeline. The debouncing, mention gating, and session binding systems handle real-world messaging complexity (group chats, threads, reactions) that most frameworks ignore.

### Where It Falls Short

1. **No programmatic memory write API.** The memory system indexes files from disk but provides no `memory.write()` or `memory.upsert()` method. To "write" to memory, you must write a file and wait for re-indexing. This forces workarounds like our JSON-based fact store.

2. **TypeScript-only plugin system.** The Jiti loader and plugin SDK are tightly coupled to TypeScript. Python, Go, or Rust developers cannot write plugins without a bridge layer. This limits the contributor pool.

3. **Single-machine architecture.** No built-in support for distributed deployment, replication, or multi-user scenarios. The file-based state model that makes local development simple also makes scaling impossible without significant re-architecture.

4. **Limited testing infrastructure for plugins.** There's no official test harness for plugin developers. You can't easily mock the `OpenClawPluginApi` or simulate hook events without importing internal modules. The test patterns in the codebase rely on real module loading.

### Risks

- **Community governance:** OpenClaw is an open-source project with an active but relatively small community. Bus factor risk — if key maintainers step away, the project could stagnate.
- **API stability:** The plugin SDK is still evolving. Hook signatures, context engine interfaces, and configuration schemas may change between releases. No formal deprecation policy visible.
- **Security surface:** Running an AI agent locally with access to shell commands, file system, and messaging platforms creates a significant attack surface. The security documentation acknowledges this but puts the burden on the user.
- **Licensing:** MIT license is permissive and business-friendly. No risk here.

### "No Vector Database, No Orchestration Framework" Philosophy

**How it helps:** Forces simplicity. The file-based memory system with hybrid search (FTS + optional embeddings) is sufficient for personal assistant use cases. No infrastructure to manage, no database to tune, no orchestration complexity to debug.

**How it hinders the cross-session problem:** Without a vector database or event bus, there's no built-in mechanism for real-time cross-session communication. The memory system is designed for slow, file-based indexing — not the near real-time propagation this problem requires. Our solution works around this by using hooks (event-driven) and a separate JSON store (bypassing the memory system entirely).

---

## 2.3 — Maintaining a Custom Fork

### Strategy Overview

The goal is to minimize the surface area of our changes and keep them isolated from OpenClaw's core evolution.

### Branching Strategy

```
upstream/main ──────────────────────────────────────────►
                    │              │              │
                    ▼              ▼              ▼
fork/main     ─────┬──────────────┬──────────────┬─────►
                    │              │              │
                    └──► merge ◄───┘              │
                                                  │
feature/cross-session-sync ───────────────────────┘
```

- **`fork/main`**: Tracks `upstream/main`. Regularly rebased or merged.
- **`feature/cross-session-sync`**: Our plugin branch. Rebased onto `fork/main` after each upstream sync.
- **Never modify files outside `extensions/cross-session-sync/`** — this is the single most important rule for maintainability.

### Minimizing Upstream Breakage Risk

1. **Zero core modifications.** Our plugin lives entirely in `extensions/cross-session-sync/`. No changes to `src/`, `packages/`, or any other OpenClaw directory. This means upstream refactors to the core codebase cannot break our code directly.

2. **Depend only on public SDK APIs.** We import from `openclaw/plugin-sdk/core` — the official extension point. Internal module paths (`../../src/hooks/internal-hooks.js`) are avoided. If OpenClaw changes internal implementations but maintains the SDK contract, our plugin continues to work.

3. **Pin to hook API contract.** Our plugin uses exactly two hooks: `message_received` and `before_prompt_build`. Both are documented, tested in OpenClaw's own test suite, and used by built-in plugins. They are unlikely to be removed without a migration path.

### CI/CD Patterns

```yaml
# .github/workflows/upstream-compat.yml
name: Upstream Compatibility Check
on:
  schedule:
    - cron: '0 6 * * 1'  # Every Monday
  workflow_dispatch:

jobs:
  test-against-upstream:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          repository: openclaw/openclaw
          ref: main

      - name: Copy plugin into upstream
        run: |
          cp -r ${{ github.workspace }}/../plugin/extensions/cross-session-sync \
                extensions/cross-session-sync

      - name: Install and test
        run: |
          pnpm install
          pnpm vitest run extensions/cross-session-sync/tests/
```

This weekly CI job:
- Clones the latest upstream `main`
- Copies our plugin into the fresh upstream
- Runs our tests against the latest OpenClaw
- Alerts immediately if an upstream change breaks our plugin

### Testing Compatibility

1. **Unit tests (always run):** Noise filter, fact store, fact extractor — pure logic with no OpenClaw dependencies. These never break from upstream changes.

2. **Integration tests (run against upstream):** The three mandatory scenarios test the full pipeline. If OpenClaw changes hook signatures or fact store behavior, these catch it.

3. **Smoke test (manual, on major releases):** Start OpenClaw with the plugin, send messages across two TUI sessions, verify facts propagate. This validates the real runtime behavior.

### When to Contribute Upstream vs. Maintain Separately

| Scenario | Action |
|---|---|
| Our plugin is generic and useful to other users | Open PR to upstream |
| OpenClaw adds a native cross-session sync feature | Migrate to native, deprecate plugin |
| Hook API changes break our plugin | Adapt plugin, open issue if API change was undocumented |
| We need a `memory.write()` API | Propose upstream (benefits the ecosystem), maintain local patch until merged |

**Current assessment:** The cross-session sync plugin is specific enough to maintain separately. However, if OpenClaw's community shows interest in cross-session memory (likely, given the problem is fundamental), contributing upstream would reduce maintenance burden and benefit all users.

### Adapter Pattern for Resilience

The plugin's internal architecture already follows the adapter pattern:

```
OpenClaw Hook API  →  index.ts (adapter)  →  Pure business logic
                                              ├── noise-filter.ts
                                              ├── fact-store.ts
                                              └── fact-extractor.ts
```

If OpenClaw changes hook signatures, only `index.ts` needs updating. The business logic (filtering, storing, extracting) is completely decoupled from OpenClaw's API. This limits the blast radius of any upstream change to a single file.
