# Ram's Notes

## Purpose

This file is now a changelog-style working document for the unannotated-page fallback work in AAF.

It has two jobs:

- describe the current state of the system
- record what we changed over time, why we changed it, and what we validated

## Current State

As of now, AAF has a meaningful inferred-action fallback for arbitrary unannotated pages in two places:

- the Playwright runtime + CLI
- the Chrome extension demo

The behavior is:

- if a page has AAF annotations, the normal explicit AAF path is used
- if a page does not have AAF annotations, the runtime can build a structured page snapshot, ask an LLM to infer semantic actions, and execute against grounded real elements

Current inferred-mode capabilities:

- page-local inferred action discovery
- page-local rediscovery after execution/navigation
- partial execution for some low-risk unsupported actions
- Enter-key fallback for some search-like actions
- collection-candidate detection for repeated item structures
- normalization of inferred collections into item-scoped actions
- item-level execution by resolving an item reference first, then clicking the correct local control
- richer grounding metadata inspired by Pilo
- support for `url`
- support for `radio-group`
- CLI printing of supported options for `select`, `radio`, and `radio-group`

Current extension-demo capabilities:

- heuristic fallback remains available
- OpenAI-backed inferred discovery remains optional
- plain-text command planning/execution is available in the popup
- the LLM-only path is now closer to the CLI:
  - richer snapshot
  - collection-aware inference
  - stronger support/unsupported handling
  - stronger grounded execution

Still true:

- this is page-local inference, not a full cross-page capability graph for arbitrary websites
- the widget has not been updated to use this inferred path
- real-world custom widgets are still a major source of execution fragility

## Changelog

### 2026-04-xx: Baseline inferred fallback landed

We added a Playwright-first inferred fallback for pages with no AAF annotations.

That established the core shape:

- build a page snapshot
- infer semantic actions with an LLM
- validate and safety-check those actions
- execute against grounded DOM targets instead of raw selectors from the planner

This was the first point where AAF could do useful work on arbitrary pages without site-provided annotations.

### 2026-04-xx: Safer low-risk recovery

We improved execution behavior for cases where field grounding was good but submit-target grounding was weak.

Added:

- partial execution for some low-risk unsupported inferred actions
- Enter fallback for search-like actions
- page-local rediscovery after page-changing operations

This mattered because it turned some “planner got it right but executor blocked” cases into useful behavior instead of dead ends.

### 2026-04-xx: Collection candidate detection

We added repeated-item detection at snapshot creation time.

The snapshot can now emit `collectionCandidates`, each with:

- repeated items
- item summaries
- item-local controls
- repeated-structure signature

This changed the problem from:

- infer every repeated action separately

to:

- detect the repeated structure once and let the LLM infer shared item-level actions

### 2026-04-xx: Collection naming fix

There was a bug where a collection candidate could get named after the first repeated item, which was misleading.

Example bad label:

- `Manchego Curado`

We changed collection labeling to prefer:

- container `aria-label`
- non-item headings in the container
- preceding sibling headings
- enclosing section/main/article headings

That fixed the repeated-item fixture so the collection became:

- `Search results`

instead of the first product title.

### 2026-04-xx: Local repeated-item fixture added

We added:

- `tests/falsification/fixtures/unannotated-product-list/index.html`

This page includes:

- a search form
- a filter form
- repeated product cards
- per-item `Add to cart` / `Save for later` controls

This gave us a clean local harness for repeated-item inference without depending on a noisy site like Amazon.

### 2026-04-xx: Collection-aware normalization and execution

We then connected collection candidates to actual inferred actions.

Added:

- inferred collections in prompt/response flow
- normalization of collections into parameterized item-scoped actions
- item-resolution before click during execution
- preservation of per-item grounded target selectors

This was the milestone that made commands like:

- `Add young manchego to cart`

work end to end on the synthetic product-list page.

### 2026-04-xx: Debugging commands for inferred mode

The CLI gained:

- `debug snapshot`
- `debug collections`
- `debug prompt`

And an env toggle:

- `AAF_DEBUG_COLLECTIONS=true`

This made it much easier to separate:

- detector failures
- prompt/model failures
- normalization failures
- grounding failures

### 2026-04-xx: Model upgrade to `gpt-5.4`

Switching from `gpt-4o-mini` to `gpt-5.4` materially improved inferred discovery quality.

Observed effect:

- richer action catalogs
- better repeated-item understanding
- stronger real-site performance

This was especially visible on:

- the local product-list fixture
- Amazon homepage/search results
- Papaya Consent Checker

The main lesson was that model quality strongly affects whether collection candidates become useful semantic actions.

### 2026-04-xx: Pilo-inspired grounding improvements

We compared this repo’s inferred grounding to Pilo’s accessibility-tree-first grounding style.

We did not copy Pilo’s whole architecture.

What we borrowed was the grounding mindset:

- keep semantic action discovery
- carry richer concrete element evidence through the pipeline

Added richer per-element metadata such as:

- tag name
- pointer-event signal
- pointer-cursor signal
- box geometry

This improved the handoff between:

- “the model inferred the right action”

and:

- “the executor can find the real element safely enough to act”

### 2026-04-xx: `url` and `radio-group` support

We added first-class support for:

- `url`
- `radio-group`

This included:

- inferred field acceptance
- execution support
- option printing in the CLI
- real-site validation on a mixed-control SaaS form

This was important because it moved the inferred path beyond just trivial text fields and buttons.

### 2026-04-xx: Real-site Papaya validation

We validated the richer inferred form path on:

- `https://consentchecker.papayacomply.ai`

The runtime successfully inferred and executed:

- `consent_check.start_analysis`

with:

- `website_url <url>`
- `consent_flow <radio-group>`
- `region <select>`

This was one of the strongest validations so far because it used a real third-party mixed-control form.

### 2026-04-xx: Chrome extension demo added

We created:

- `extension_demo/`

Files:

- `extension_demo/manifest.json`
- `extension_demo/popup.html`
- `extension_demo/popup.css`
- `extension_demo/popup.js`
- `extension_demo/content-script.js`
- `extension_demo/README.md`

The extension lets us try the current-page discovery story directly in Chrome.

The initial version supported:

- explicit AAF action listing
- heuristic fallback for unannotated pages
- optional OpenAI-backed inferred discovery
- snapshot copying for debugging

### 2026-04-xx: Extension command execution

We then extended the popup so it could:

- accept a plain-text command
- ask the LLM to map that command to a discovered action
- execute that action on the page

This made the extension feel much closer to the CLI interaction model.

### 2026-04-29: Extension LLM path brought closer to CLI

We explicitly kept the heuristic fallback and improved only the LLM inferred path in the extension.

Main changes:

- snapshot shape now more closely matches the CLI/runtime snapshot
- repeated-item `collectionCandidates` now flow into extension-side LLM inference
- collection-aware inferred actions are normalized into item-scoped actions
- planner context now includes support status, risk, confirmation, unsupported reason, and collection item titles
- inferred actions now keep stronger grounding:
  - target selectors
  - field selectors
  - radio-group option selectors
  - per-item grounded target selectors
- extension execution now prefers grounded selectors over coarse IDs
- extension execution now does stronger select/radio matching and collection item resolution

This is still not literal runtime sharing with the CLI, but it is materially closer in behavior on unannotated pages.

## Validation Summary

### Local fixtures

Validated successfully on local unannotated fixtures for:

- login
- search
- settings/toggle
- destructive-page behavior
- repeated-item product listing

Strongest local collection result:

- `Add young manchego to cart`

worked end to end on the repeated-item product-list fixture with item resolution and item-local click grounding.

### Real site: UChicago MACSS

Site:

- `https://macss.uchicago.edu/`

Observed:

- no AAF manifest
- successful inferred homepage actions
- natural-language command mapped to the correct action
- execution completed successfully

This was the strongest early proof that the inferred path could work on a real public non-AAF site.

### Real site: Amazon

Site:

- `https://www.amazon.com/`

Observed across multiple runs:

- homepage search understanding worked
- partial execution + Enter fallback improved usefulness
- `gpt-5.4` materially improved action discovery quality
- search-results pages exposed collection-like item actions such as product open / reviews open / add to cart
- grounding on heterogeneous repeated result cards is still fragile
- custom wrapped controls remain a major execution bottleneck

Current interpretation:

- page understanding is often good
- execution grounding is still the main weakness on large custom commerce sites

### Real site: Papaya Consent Checker

Site:

- `https://consentchecker.papayacomply.ai`

Observed:

- successful inferred form discovery
- successful planning from natural language
- successful execution across `url`, `radio-group`, and `select`
- successful rediscovery after submit

This is currently one of the best demonstrations of the richer inferred form path.

### Real site: Sporcle (extension demo)

Site:

- `https://www.sporcle.com/`

Observed:

- the extension extracted the quiz inputs as grounded page actions
- those inputs could then be filled one by one by giving the extension the next answer to enter
- the extension successfully entered the supplied answers into the quiz fields

Why this is interesting:

- this is a nice proof that the package-backed extension path is not limited to static forms or toy pages
- it shows that grounded current-page actions can support fast repeated entry workflows under time pressure
- it suggests a compelling future composition with an agent runtime like Octonous:
  - use the runtime to research or retrieve the quiz answers
  - feed them one by one into grounded current-page actions
  - complete the quiz within the time window

Current interpretation:

- the extension is already useful for “discover current-page inputs and act on them repeatedly”
- chaining page-grounded actions with a stronger external reasoning/research agent could unlock higher-value browser-side workflows than simple one-shot form submit cases

## Extension Screenshots

Screenshots live in:

- `extension_screenshots/`

Current files:

- `extension_screenshots/Screenshot 2026-04-24 at 3.17.10 PM.png`
- `extension_screenshots/Screenshot 2026-04-24 at 3.17.20 PM.png`
- `extension_screenshots/Screenshot 2026-04-24 at 3.17.24 PM.png`
- `extension_screenshots/Screenshot 2026-04-24 at 3.17.29 PM.png`

## Current Strengths

- works on unannotated pages
- stays semantic at the planner contract layer
- can ground many inferred actions to real DOM targets
- handles repeated-item collections in controlled cases
- handles richer form controls than earlier in the project
- has useful CLI and extension debugging affordances
- has conservative safety behavior

## Current Limits

- still page-local for arbitrary non-AAF sites
- still fragile on custom widget-heavy production pages
- not yet robust for complex multi-step workflows
- not yet a universal browser automation layer
- still strongly model-dependent in collection/action quality
- still weaker on large ecommerce/search-result pages than on cleaner forms and simpler layouts

## Bottom Line

The project has moved from:

- “can we infer anything useful on unannotated pages?”

to:

- “how far can we push grounded semantic execution on real arbitrary pages?”

The answer right now is:

- clearly useful on a meaningful subset of accessible pages
- strongest on search/forms/simple repeated-item pages
- improving on real sites
- still bottlenecked mainly by grounding and custom control behavior, not by the basic idea of inferred semantic actions
