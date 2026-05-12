# Octonous Integration Plan

## Goal

Add the strongest parts of the AAF extension’s inferred-action system into the Octonous browser extension without replacing Octonous’s own:

- side panel UX
- auth/session model
- backend/runtime
- tool/integration approval flow

The main idea is:

- keep Octonous’s existing agent runtime
- improve its understanding of the current page
- give it a stronger way to infer available actions on unannotated pages
- ground those actions in real page elements so execution is more reliable

## What Octonous Already Has

From the description above, Octonous already has three strong pieces:

1. a side-panel chat UI
2. a background worker that coordinates auth, messaging, and backend access
3. a content-script layer that can extract page context and richer page content

That means Octonous does **not** need:

- a new extension shell
- a new LLM endpoint
- a new chat interface
- a new approval flow

What it needs, if we want AAF-style inferred interaction, is:

- a richer structured page snapshot
- an inferred action catalog
- grounded execution helpers for current-page actions

## Recommended Integration Strategy

Do **not** treat this as “port the whole AAF extension.”

Instead, treat the AAF extension work as three reusable capabilities:

1. page snapshot extraction
2. inferred-action normalization
3. grounded DOM execution

The cleanest architecture is:

- Octonous side panel remains the UI
- Octonous background worker continues to talk to the Octonous backend
- Octonous content script gains a richer AAF-style page model
- Octonous backend or local planner uses that richer model to infer actions
- Octonous content script executes grounded actions on the page

## What To Add To Octonous

### 1. Rich structured page snapshot

Octonous already extracts:

- URL
- title
- selected text
- some site-specific metadata
- richer readable page content on demand

Add a second, more interaction-focused snapshot alongside that content extraction.

This snapshot should include:

- headings
- landmarks
- forms
- interactives
- field/control types
- option lists for `select`
- synthesized `radio-group` controls
- per-element grounding metadata
- repeated-item `collectionCandidates`
- condensed page text summary

Why:

- Octonous’s current extraction is good for answering questions about page content
- it is not yet designed as a page-action model
- inferred action discovery needs a structured interaction snapshot, not just markdown-like readable text

Recommended source to adapt:

- [content-script.js](/Users/ramkripa/Desktop/Projects/aaf/extension_demo/content-script.js)

Key features to port:

- `collectInteractives()`
- `collectForms()`
- `collectRadioGroups()`
- `buildSnapshot()`
- collection candidate detection
- grounding data:
  - `selector`
  - `box`
  - `receivesPointerEvents`
  - `pointerCursor`
  - `heading`
  - `landmark`

### 2. Inferred-action schema inside Octonous

Octonous needs a stable internal shape for inferred page actions.

Suggested fields:

- `action`
- `title`
- `description`
- `supported`
- `unsupportedReason`
- `confidence`
- `risk`
- `confirmation`
- `intent`
- `fields`
- `targetSelectors`
- `submitSelector`
- optional `collectionScope`

Field shape should include:

- `field`
- `elementId`
- `selector`
- `label`
- `controlType`
- `required`
- `options`
- `enumValues`
- `optionSelectors`

This gives Octonous a typed page-action layer that sits between:

- raw page extraction

and

- natural-language planning/execution

### 3. LLM prompt for action inference

Octonous’s runtime should get a new prompt path specifically for:

- “what actions are available on this page?”

This prompt should consume the structured snapshot, not just readable page text.

The prompt should ask for:

- site/page classification
- inferred semantic actions
- fields
- support/confidence/risk
- collection-level action templates for repeated structures

Recommended source to adapt:

- [popup.js](/Users/ramkripa/Desktop/Projects/aaf/extension_demo/popup.js)

Important prompt behaviors to preserve:

- use only supplied element IDs
- do not invent selectors
- prefer one action per form/workflow
- include low-confidence grounded actions as unsupported instead of silently dropping them
- infer collection templates once for repeated items

### 4. Normalization and support rules

Octonous should not trust the raw LLM response directly.

It should normalize and post-process inferred actions the way the AAF path now does.

Key behaviors to add:

- normalize action names
- normalize intents
- map control types
- re-resolve missing submit targets from forms when possible
- apply support/risk rules
- filter low-value generic navigation links
- preserve field options
- convert repeated-item collection templates into real item-scoped actions

Recommended logic to adapt:

- normalization helpers in [popup.js](/Users/ramkripa/Desktop/Projects/aaf/extension_demo/popup.js)

Important rules to preserve:

- destructive/high-risk actions should be blocked
- low-confidence actions should usually be surfaced as unsupported
- unsupported reason should be explicit and human-readable
- generic brochure-style nav should be filtered

### 5. Collection-aware discovery

This is one of the biggest product-level improvements Octonous could borrow.

Instead of inferring 500 separate “Add to cart” actions on a product-list page, detect:

- one repeated collection
- one shared item action template
- one parameterized action like `cart.add_item(product_name)`

What to add:

- `collectionCandidates` in the snapshot
- collection IDs in the LLM prompt
- collection action templates in the LLM response
- normalization that turns those templates into executable item-scoped actions

The action should then carry:

- an item reference field
- item summaries
- grounded target selectors per item

This makes repeated-item pages much more tractable.

### 6. Grounded execution helpers

If Octonous wants to actually execute current-page actions, this is critical.

Do **not** ask the model which CSS selector to click at execution time.

Instead:

- infer actions semantically
- normalize them
- carry grounded selectors through the pipeline
- execute locally in the content script

Execution behaviors to add:

- fill text-like inputs
- fill `url`
- fill/search text boxes
- select native `<select>` values by exact or fuzzy visible match
- resolve `radio-group` options via precomputed option selectors
- resolve collection item references before click
- click grounded targets
- Enter fallback for some search-like actions
- partial low-risk “awaiting review” behavior when fields are grounded but submit target is weak

Recommended source to adapt:

- [content-script.js](/Users/ramkripa/Desktop/Projects/aaf/extension_demo/content-script.js)

### 7. Planner path for plain-language page actions

Octonous already has a chat system.

Add a page-action planning path so the agent can decide:

- answer with page-aware text
- use an external integration/tool
- execute a current-page inferred action

That means the page-action catalog should be available to the Octonous planner as an additional capability source.

Suggested planner inputs:

- page snapshot summary
- inferred action catalog
- support/risk metadata
- available field options
- collection item titles for collection actions

This allows prompts like:

- “Start an analysis for nature.com with a reject-all flow”
- “Add young manchego to cart”
- “Sort results by price”

to map to structured page actions rather than freeform browser manipulation.

### 8. UX for approval and execution visibility

Octonous already has approval UX for external tools.

Reuse that same product idea for current-page actions when needed.

Suggested behavior:

- low-risk supported current-page actions can run immediately
- low-risk but partially grounded actions can show “filled for review”
- high-risk or destructive page actions should require approval
- unsupported actions should be surfaced with a visible reason

Good UI states:

- `available`
- `unsupported`
- `executing`
- `completed`
- `awaiting_review`
- `needs_confirmation`

## What Not To Copy Directly

Do not copy these parts as-is:

- OpenAI API settings UI from the AAF demo
- popup architecture
- demo-specific storage shape
- demo-specific message names

Octonous already has:

- its own runtime/backend
- its own extension architecture
- its own chat surface

The transferable value is the page-action layer, not the demo shell.

## Best Integration Shape For Octonous

The cleanest long-term shape is:

### Content script

Add:

- `getStructuredPageSnapshot()`
- `executeGroundedPageAction()`

Responsibilities:

- inspect DOM
- produce interaction snapshot
- keep temporary element IDs/selectors
- execute grounded current-page actions

### Background worker

Add:

- message routing for page-action snapshot requests
- message routing for current-page action execution

Responsibilities:

- bridge side panel and content script
- keep auth/backend interaction unchanged

### Side panel / React app

Add:

- optional “available actions” section for current page
- optional action-debug view
- execution status rendering

Responsibilities:

- display inferred actions
- show supported/unsupported state
- send page-action planning/execution requests

### Octonous backend/runtime

Add:

- prompt path for page-action inference
- prompt path for planning against page actions
- normalization/validation of inferred actions

Responsibilities:

- infer semantic actions from snapshot
- choose actions from catalog based on user intent
- keep external integrations and page actions in one unified agent workflow

## Suggested Implementation Order

### Phase 1: Snapshot only

Add the structured interaction snapshot to Octonous, without execution yet.

Deliverables:

- content-script snapshot builder
- debug view in side panel
- snapshot transport through background worker

Success criterion:

- Octonous can inspect a random page and show a rich interaction snapshot

### Phase 2: LLM action discovery

Add inferred action discovery against the new snapshot.

Deliverables:

- inference prompt
- action normalization
- support/risk filtering
- action catalog rendering in side panel

Success criterion:

- Octonous can show semantic available actions for unannotated pages

### Phase 3: Grounded form execution

Add safe execution for simple grounded actions.

Deliverables:

- fill text/url/search fields
- select native selects
- resolve radio groups
- click grounded submit/primary target
- Enter fallback

Success criterion:

- Octonous can execute common form actions on current page

### Phase 4: Collection-aware repeated-item actions

Add repeated-item support.

Deliverables:

- collection candidates
- collection prompt/response support
- item-scoped action normalization
- collection item resolution at execution time

Success criterion:

- Octonous can infer and execute one semantic item action across repeated cards/listings

### Phase 5: Full UX integration

Make it feel native inside Octonous.

Deliverables:

- approval states
- execution status states
- unsupported reason rendering
- optional debug panels

Success criterion:

- page actions feel like a first-class part of the Octonous extension, not a bolted-on demo

## Recommended First Ports From AAF

If we want the highest-value minimal transplant, start with:

1. `buildSnapshot()` from [content-script.js](/Users/ramkripa/Desktop/Projects/aaf/extension_demo/content-script.js)
2. `collectRadioGroups()` from [content-script.js](/Users/ramkripa/Desktop/Projects/aaf/extension_demo/content-script.js)
3. collection candidate detection from [content-script.js](/Users/ramkripa/Desktop/Projects/aaf/extension_demo/content-script.js)
4. normalization/risk helpers from [popup.js](/Users/ramkripa/Desktop/Projects/aaf/extension_demo/popup.js)
5. grounded execution helpers from [content-script.js](/Users/ramkripa/Desktop/Projects/aaf/extension_demo/content-script.js)

That would give Octonous the biggest jump in capability with the least architectural churn.

## Key Product Value For Octonous

If this is integrated well, Octonous becomes more than:

- “chat about the page”

It becomes:

- “understand the page as an interaction surface”
- “infer what can be done on the page”
- “execute safe grounded actions on the page”
- “use integrations when current-page action is not the right tool”

That is a meaningful product expansion.

## Bottom Line

The right way to use this work in Octonous is:

- do not replace Octonous’s runtime
- do not replace Octonous’s chat flow
- add an AAF-style structured interaction layer inside the content script
- add inferred-action discovery on top of that layer
- add grounded execution against real DOM elements

In short:

- keep Octonous’s brain
- give it better page understanding
- give it a safer page-action hand
