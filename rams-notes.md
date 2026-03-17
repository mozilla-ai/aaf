# Ram's Notes

## What We Built

We added a Playwright-first fallback path for arbitrary, unannotated webpages.

Before this change, the system only worked on pages that exposed AAF semantics:

- `data-agent-*` DOM annotations
- manifest-driven action definitions
- explicit semantic action and field names

After this change, the runtime can now do this:

1. Detect whether the page is AAF-annotated.
2. If yes, use the existing AAF path unchanged.
3. If not, and an LLM backend is configured, infer possible actions from:
   - Playwright ARIA snapshot data
   - DOM heuristics
   - visible controls and form structure
4. Normalize those inferred actions into semantic action names.
5. Validate and execute only safe supported actions.

This was implemented in the Playwright runtime and the CLI.

The widget was not changed.

## Main Files Added or Changed

### Runtime Core

- `packages/agent-runtime-core/src/types.ts`

Extended the shared action catalog types to support inferred-action metadata such as:

- `source`
- `risk`
- `confirmation`
- `intent`
- `confidence`
- `supported`
- `unsupportedReason`
- `siteType`
- `pageType`
- `evidence`
- field `label`
- field `controlType`
- catalog `discoveryMode`
- catalog `pageContext`

### Playwright Runtime

- `packages/agent-runtime-playwright/src/action-executor.ts`
- `packages/agent-runtime-playwright/src/accessibility-extractor.ts`
- `packages/agent-runtime-playwright/src/dom-affordance-extractor.ts`
- `packages/agent-runtime-playwright/src/inference-prompt.ts`
- `packages/agent-runtime-playwright/src/inference-risk.ts`
- `packages/agent-runtime-playwright/src/inferred-action-discoverer.ts`
- `packages/agent-runtime-playwright/src/inferred-action-executor.ts`

These files added the arbitrary-page inference path.

### CLI

- `packages/aaf-cli/src/cli.ts`
- `packages/aaf-cli/src/llm-config.ts`

The CLI now:

- supports AAF pages as before
- supports inferred discovery on unannotated pages
- supports Ollama or OpenAI-compatible backends
- can run with a visible browser for manual testing

### Planner Backend

- `packages/aaf-planner-local/src/openai-backend.ts`

Added `currentModel()` and `setModel()` support for consistency with the shared backend abstraction.

### Tests and Fixtures

Added tests:

- `packages/agent-runtime-playwright/src/inference-risk.test.ts`
- `packages/agent-runtime-playwright/src/inferred-action-discoverer.test.ts`
- `packages/aaf-cli/src/llm-config.test.ts`

Added fixtures:

- `tests/falsification/fixtures/unannotated-search/index.html`
- `tests/falsification/fixtures/unannotated-login/index.html`
- `tests/falsification/fixtures/unannotated-settings/index.html`
- `tests/falsification/fixtures/unannotated-danger/index.html`

The login fixture was later updated to visibly render:

- `hello <email>`

on successful submit, so manual testing is obvious in the browser.

## How It Works

### 1. Discovery Mode Selection

`PlaywrightAdapter` now has two modes:

- AAF mode
- inferred mode

Default behavior:

- if AAF is present, prefer AAF
- otherwise, if an LLM backend exists, run inferred discovery

### 2. Page Snapshot Extraction

The inferred path extracts:

- page URL
- title
- headings
- landmarks
- forms
- interactive controls
- visible page text
- ARIA snapshot summary

The DOM extractor assigns internal element IDs like:

- `el_1`
- `el_2`

These are temporary internal identifiers for one discovery pass only.

### 3. LLM Action Inference

The LLM receives a structured page snapshot, not raw HTML.

It is asked to return:

- site type
- page type
- summary
- confidence
- action list with semantic names, fields, targets, risk, and evidence

### 4. Normalization

The runtime then normalizes the model output:

- intent aliases like `login`, `auth`, `sign_in` -> `authenticate`
- semantic action names are made planner-safe
- duplicate names are deduplicated
- form actions can recover the real submit button if the model picks the wrong target

### 5. Safety Filtering

Deterministic risk rules are applied after the model response.

Examples of actions forced unsupported:

- delete/remove/destroy
- purchase/pay/checkout
- reset/revoke/close account

Unsupported actions are blocked at validation/execution time.

### 6. Execution

Supported inferred actions can currently execute:

- links
- buttons
- simple form submit flows
- toggles like checkboxes/radios

Supported field types:

- text
- email
- password
- search
- number
- date
- textarea
- select
- checkbox
- radio

## What We Debugged

This feature did not work end-to-end on the first pass. These were the main issues fixed:

### 1. Node Version / Dependency Compatibility

Initial tests failed because the environment was on Node `20.8.0` while installed packages expected newer Node 20 versions.

We updated Node via Homebrew to:

- `v20.20.1`

This fixed the `jsdom` / ESM dependency failures in the test suite.

### 2. Playwright Accessibility API Mismatch

Initial runtime code used:

- `page.accessibility.snapshot()`

That API was not available in the installed Playwright version.

We replaced it with:

- `page.locator('body').ariaSnapshot()`

and parsed the resulting ARIA snapshot text into the summary format we needed.

### 3. Browser `page.evaluate` Helper Leakage

The DOM extractor initially crashed in the browser context with:

- `ReferenceError: __name is not defined`

Cause:

- compiled helper code leaked into the function serialized into `page.evaluate`

Fix:

- replaced that evaluator with raw browser-side JavaScript source and a trampoline

### 4. Misleading CLI Startup Error

The CLI reported:

- `No AAF annotations found and no LLM backend configured for inferred discovery.`

even when the backend had actually been called successfully.

Fix:

- changed CLI startup logic to only print that message when no backend actually exists
- otherwise call `discover()` directly and inspect the resulting catalog

### 5. Intent Alias Mismatch

The model returned intent values like:

- `login`

but the runtime expected canonical values like:

- `authenticate`

Fix:

- added intent normalization

### 6. False Unsupported State

The model returned a login action that was actually usable, but it selected the wrong submit target.

That caused the runtime to mark the action unsupported and surface:

- `optional`

as a bogus validation error.

Fix:

- ignore placeholder unsupported reasons like `optional`
- recover the form's actual submit button from form structure when the model picks a bad target

## Manual Demo Flow

This is the path that was manually verified:

1. Serve fixture pages locally.
2. Run the CLI with a visible Playwright browser.
3. Point it at the unannotated login fixture.
4. Use an OpenAI-compatible backend.
5. Type a natural-language login command.
6. Watch the browser fill and submit the form.
7. Confirm visible output:
   - `hello alice@example.com`

That confirmed:

- inferred discovery worked
- planning worked
- form fill worked
- execution worked
- the submit event propagated into visible page state

## How Hard-Coded It Is

This is not hard-coded to only one page or one workflow.

But it is intentionally constrained.

### Flexible Parts

- page classification is model-driven
- action discovery is model-driven
- semantic action naming is derived from inferred intent and page context
- field extraction is structural, not page-specific
- works on unannotated pages that expose usable accessible/visible controls

### Hard-Coded Parts

- supported execution categories are deliberately narrow
- risk detection uses explicit keyword heuristics
- execution logic only supports common native controls
- complex custom widgets are not generally supported
- destructive/payment/irreversible actions are blocked

### Good Current Fits

- login pages
- search forms
- settings pages
- simple create/update forms
- obvious links and buttons

### Weak Current Fits

- highly custom component libraries with weak accessibility
- multi-step transactional flows
- file uploads
- rich text editors
- drag/drop UIs
- canvas-heavy interfaces
- payment flows
- destructive admin workflows

## Current Status

### What Passes

The new inferred-discovery tests pass.

The full suite also became mostly green after the Node upgrade.

The remaining failing test is unrelated to this feature:

- `packages/aaf-lint/src/cli.test.ts`

It assumes a temporary git repo has a `main` branch, but the test repo initializes with `master`.

### What Works End-to-End

Confirmed working manually:

- inferred discovery on unannotated login page
- semantic action generation
- natural-language planning
- Playwright execution
- visible browser confirmation

## Next Good Extensions

If this is continued, the most valuable next steps are:

1. Add better support for dialogs, tabs, and table/filter flows.
2. Improve status/result detection on arbitrary pages.
3. Expand inferred execution patterns for more accessible component libraries.
4. Add more manual demo fixtures beyond login/search/settings.
5. Add stronger schema/type validation for inferred fields.
6. Improve LLM prompt constraints for target selection and action support decisions.

## Bottom Line

We now have a real inferred-action fallback for arbitrary, unannotated pages in the Playwright runtime.

It is:

- useful
- demonstrably working
- reasonably safe for common accessible interactions
- not universal
- architecturally extensible

It should be thought of as:

- explicit semantics when available
- inferred semantics as a fallback

not as a replacement for AAF.
