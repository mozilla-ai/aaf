# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Agent Accessibility Framework (AAF)

A proposal and prototype for making websites reliably operable by browser agents, using semantic DOM annotations (`data-agent-*`) and typed capability manifests. Agents interact with real UI through named actions and fields — never CSS selectors.

npm workspaces monorepo (`packages/*`, `samples/*`). All packages are TypeScript ES modules.

## Quick Reference

```bash
npm install                      # Bootstraps all workspaces
npm test                         # All unit tests (vitest)
npm run test:watch               # Watch mode
npm run test:e2e                 # Playwright E2E (start billing app first: cd samples/billing-app && npx vite)
npm run benchmark                # Generates artifacts/reliability-report.md

# Run a single package's tests
npx vitest run packages/agent-runtime-core
npx vitest run packages/aaf-contracts
npx vitest run tests/falsification

# Linter / site auditor
npx aaf-lint --html <path> --manifest <path>           # Local file
npx aaf-lint --audit <url> --render --crawl --safety   # Remote (--render needs playwright; auto-discovers manifest)

# SDK codegen from a manifest
npx agentgen --manifest <manifest.json> --output generated-sdk/
```

The widget and planner require **Ollama** running locally (`ollama serve`, `ollama pull llama3.2`) to demo end-to-end against `samples/billing-app` (port 5173) or `samples/docs-site` (port 5174).

## Architecture (4 Layers)

1. **UI Layer** — Human-facing website (unchanged)
2. **Agent Semantics Layer** — `data-agent-*` DOM attributes (kind, action, field, page, danger, confirm, scope)
3. **Agent Manifest Layer** — `/.well-known/agent-manifest.json` with action schemas, data view definitions, and policies
4. **Tooling Layer** — Runtimes, SDKs, linters, LLM planner

## Monorepo Layout

```
packages/
  # Core
  agent-runtime-core/        # SemanticParser, ManifestValidator, PolicyEngine, ExecutionLogger
  agent-runtime-playwright/  # PlaywrightAdapter (AAFAdapter for headless testing)
  aaf-contracts/             # PlannerRequest/RuntimeResponse types, validators, JSON schemas

  # Planning + UI
  aaf-planner-local/         # Local LLM planner (Ollama client, prompt builder, response parser)
  aaf-agent-widget/          # Embeddable agent chat widget (Ollama/OpenAI-compatible, shadow DOM)
  aaf-agent-skill/           # Packaged "skill" definition for hosted agents

  # Tooling / CLIs
  aaf-lint/                  # HTML/manifest conformance linter + site auditor (binary: aaf-lint)
  agentgen/                  # SDK + CLI code generator from manifests (binary: agentgen)
  aaf-cli/                   # Top-level dev CLI
  aaf-init/                  # Project scaffolder

  # Framework adapters (all @agent-accessibility-framework/*)
  aaf-next/                  # Next.js — AgentForm, withAgentAction
  aaf-react/                 # React components/hooks
  aaf-svelte/                # SvelteKit — AgentAction.svelte, server hook
  aaf-vue/                   # Vue components/composables
  aaf-vite-plugin/           # Vite plugin (manifest emit, dev integration)
  aaf-eslint-plugin/         # Lint rules for data-agent-* usage in source
  aaf-webmcp-bridge/         # Auto-registers AAF actions as navigator.modelContext tools (Chrome 146+)

samples/
  billing-app/               # Reference app + widget (3 pages, 2 actions, 1 data view) — port 5173
  docs-site/                 # AAF-annotated docs site, demos data chat mode — port 5174
  real-world-app/            # ProjectHub: 5 pages, 5 actions, 3 data views

schemas/
  agent-manifest.schema.json # JSON Schema for manifest validation
tests/
  conformance/               # Conformance test fixtures
  falsification/             # Selector vs semantic benchmark, safety, drift detection
docs/                        # Spec documents (vision, standard, security, threat model, HTML proposal)
```

When adding a feature that touches the planner→runtime contract, the change usually spans `aaf-contracts` (types/validators), `agent-runtime-core` (enforcement), `aaf-planner-local` (prompt + parser), and `aaf-agent-widget` (UI). Framework adapter packages mirror the same primitives per framework — keep the surface consistent across them.

## Core Concepts

- **Actions**: Executable operations with dot-notation identifiers (`invoice.create`, `workspace.delete`). Sub-actions use extra dot (`invoice.create.submit`).
- **Data Views**: Read-only data sources (`invoice.list`). Defined in `manifest.data`, referenced from `page.data`. Navigating to the page is the "execution" — the widget scrapes and answers questions about the visible data. Data views with `inputSchema` are **queryable** — agents pass filter args that map to URL query params (e.g. `/invoices/?status=paid`).
- **Links**: Navigation elements annotated with `data-agent-kind="link"`. On `<a>` tags, target is derived from `href`; on non-`<a>` elements, `data-agent-page="/path/"` is required. `data-agent-page` can also override `href` on `<a>` tags. Both internal and external links are supported.
- **Fields**: snake_case identifiers (`customer_email`, `amount`). Linked to actions via nesting or `data-agent-for-action`. Fields in `inputSchema`/`outputSchema` may include `"x-semantic": "https://schema.org/email"` to express semantic type (manifest-only, no DOM changes).
- **Risk/Confirmation**: Three tiers — `optional` (fill and submit automatically), `review` (fill only, user submits manually, returns `awaiting_review`), `required` (blocked without user consent, returns `needs_confirmation`). `danger="high"` + `confirm="required"` blocks execution.
- **AAFAdapter interface**: `detect() → discover() → validate() → execute()`. Implemented by `PlaywrightAdapter` (testing).
- **Agent Widget**: Embeddable `<script>` that adds a floating chat panel to any AAF-annotated page. Uses Ollama for LLM planning. Shadow DOM isolation. Supports **cross-page navigation** — the widget reads all actions from the manifest, plans against them regardless of which page the user is on, and auto-navigates when the target action is on a different page (conversation history persists via sessionStorage).
- **Contract rule**: Planners send semantic action names + args, NEVER selectors. Validators reject selector-like values.

## Execution Flow

1. **Discover** — `SemanticParser.discoverActions(root)` + `discoverLinks(root)` on DOM → `ActionCatalog` + `DiscoveredLink[]`
2. **Site-aware context** — `buildSiteActions` + `buildSiteDataViews` + `buildPageSummaries` add off-page actions, queryable data views, and navigable pages from the manifest
3. **Plan** — LLM maps user intent to one of three response types:
   - `{ kind: 'action', request }` — executable action with args
   - `{ kind: 'navigate', page }` — navigation-only intent (e.g. "go to settings")
   - `{ kind: 'answer', text }` — direct answer from page data (data chat mode)
4. **Navigate** (if needed) — If the planned action is on another page, or the LLM returns a navigate response, persist conversation to sessionStorage and navigate via `window.location.href`. On page load, the widget restores the conversation and re-plans.
5. **Validate** — `ManifestValidator.validateInput()` checks args against JSON Schema
6. **Policy** — `PolicyEngine.checkExecution()` enforces risk/confirmation rules
7. **Execute** — Fill fields (native value setter + events), click submit, read status
8. **Log** — `ExecutionLogger` records semantic steps (fill, click, read_status, navigate)

## Conventions

- All packages use TypeScript ES modules (`"type": "module"`)
- Package names: `@agent-accessibility-framework/*` for scoped, `aaf-lint`/`agentgen` for standalone CLIs
- Tests colocated in `src/` as `*.test.ts` (vitest)
- AJV for JSON Schema validation (runtime-core, contracts)
- Vite for builds (billing app, agent widget)
- No CSS selector references in agent contracts — semantic names only

## Key Files

| File | What it does |
|------|-------------|
| `packages/agent-runtime-core/src/types.ts` | All core type definitions including AAFAdapter |
| `packages/agent-runtime-core/src/semantic-parser.ts` | DOM → DiscoveredAction[] (works on real DOM and jsdom) |
| `packages/aaf-contracts/src/validators.ts` | Validates planner requests, rejects selectors |
| `packages/aaf-planner-local/src/planner.ts` | Ollama LLM → semantic action request |
| `packages/aaf-agent-widget/src/widget.ts` | Embeddable agent widget entry point (detects AAF, mounts UI, wires planner) |
| `packages/aaf-agent-widget/src/ollama-planner.ts` | Ollama planner for local LLM inference |
| `packages/aaf-agent-widget/src/ui/chat.ts` | Shadow DOM floating chat panel |
| `packages/aaf-contracts/src/types.ts` | FieldSummary, DataViewSummary, PlannerRequest/RuntimeResponse types |
| `packages/aaf-agent-widget/src/navigation.ts` | Cross-page navigation helpers (buildSiteActions, buildSiteDataViews, persist/check pending nav) |
| `samples/billing-app/public/.well-known/agent-manifest.json` | Reference manifest |
