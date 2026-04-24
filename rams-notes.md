# Ram's Notes

## Current Status

AAF now has a working Playwright-first fallback for arbitrary unannotated pages.

Current behavior:

- if a page has AAF annotations, the existing AAF path is used
- if a page does not have AAF annotations, the runtime can infer semantic actions from the current page when an LLM backend is configured
- this works through the Playwright runtime and the CLI
- the widget has not been updated
- low-risk inferred actions can now partially execute even when the submit/click target is not grounded confidently
- low-risk inferred search actions now have an Enter-key fallback after field fill
- inferred-mode action catalogs are now refreshed after page-changing operations instead of being treated as site-wide
- inferred-mode can now detect repeated-pattern collection candidates during snapshot creation
- inferred collections can now be normalized into parameterized item-scoped inferred actions
- inferred item-scoped actions now resolve the requested item before clicking the item-local target
- the CLI now has snapshot / collection / prompt debugging commands for inferred-mode inspection
- inferred grounding now uses richer per-element metadata inspired by Pilo-style accessibility-tree grounding
- inferred form fields now support `url`
- inferred form fields now support `radio-group`
- the CLI now prints supported options for `select`, `radio`, and `radio-group` fields when they are available

## What Was Added

The project now supports:

- inferred action discovery on unannotated pages
- semantic action naming for inferred actions
- safe execution of common inferred actions
- visible-browser manual testing through the CLI
- OpenAI-compatible and Ollama-backed inference for the CLI path
- repeated-item collection candidate detection in inferred snapshots
- collection-aware inferred action templates for repeated item controls
- item-scoped inferred execution for repeated-item pages
- local debugging of raw inferred snapshots, collection candidates, and the exact inference prompt
- a dedicated unannotated repeated-item fixture for local testing
- richer grounding metadata on inferred interactives, including tag name, pointer behavior, and element box data
- grouped radio-field inference and execution for arbitrary unannotated forms
- option-aware CLI output for inferred form fields
- real-site consent-check form execution with URL, radio-group, and select inputs

## What Was Validated

### Local Fixture Validation

The unannotated fixture pages were exercised successfully:

- login page
- search page
- settings/toggle page
- destructive page
- repeated-item product-list page

The login flow was verified visually by updating the page so that successful submit renders:

- `hello <email>`

This confirmed that inference, planning, filling, and submit propagation all worked end to end.

### Repeated-Item Fixture Validation

A new local unannotated repeated-item fixture was added at:

- `tests/falsification/fixtures/unannotated-product-list/index.html`

What this page includes:

- a product grid with repeated cards
- per-item `Add to cart` and `Save for later` buttons
- a search form
- a filter form

This is meant to test inferred collection detection without relying on noisy real sites like Amazon.

Observed local snapshot/debug result:

- the page is classified as e-commerce / product listing
- repeated product cards are detected as a single collection candidate
- item-local controls are captured for each card
- the collection label now resolves correctly as `Search results` rather than incorrectly using the first product title

Observed collection debug output:

```text
[collections] Found 1 collection candidate(s) on http://localhost:8082/tests/falsification/fixtures/unannotated-product-list/index.html
  el_24 "Search results" (items:4, signature:article|h2,p,p,div|button,button)
    item: Manchego Curado
    controls: button:Add to cart | button:Save for later
    item: Manchego Reserva
    controls: button:Add to cart | button:Save for later
    item: Young Manchego
    controls: button:Add to cart | button:Save for later
    item: Smoked Idiazabal
    controls: button:Add to cart | button:Save for later
```

This is an important narrowing of the problem:

- collection detection is working on the synthetic repeated-item page
- the failure mode is no longer "the runtime cannot see the collection"
- model choice still matters for whether the repeated-item structure is promoted into useful collection actions

So at this point the open issue is no longer repeated-item snapshot extraction itself. The remaining variability is mostly in model behavior and grounding quality on messier pages.

### Real-Site Validation

The flow was also run successfully on a real public site:

- `https://macss.uchicago.edu/`

Observed result:

- no AAF manifest was present
- the runtime still inferred actions on the homepage
- the page was classified as an educational/program homepage
- multiple semantic actions were inferred
- the command `apply for the program` mapped to `apply.submit`
- execution completed successfully

Observed CLI output:

```text
[browser] Launching visible browser...
[manifest] Fetching https://macss.uchicago.edu/.well-known/agent-manifest.json
! No agent manifest found at https://macss.uchicago.edu/.well-known/agent-manifest.json
[navigate] https://macss.uchicago.edu

[discover] Found 3 action(s) on https://macss.uchicago.edu/ [inferred]
  context: educational / program homepage (0.95)
  summary: The Masters in Computational Social Science program at the University of Chicago provides information about the program, application process, and related resources.
  apply.submit (source:inferred, risk:low, confirm:optional, confidence:0.90)
  request.info (source:inferred, risk:low, confirm:optional, confidence:0.88)
  view.news (source:inferred, risk:low, confirm:optional, confidence:0.85)

Type a command in natural language, or "help" for options.

aaf> apply for the program
[plan] Asking gpt-4o-mini to map: "apply for the program"
✓ Planned: apply.submit
  args: {}

✓ Status: completed
✓ Result: submitted inferred action "apply.submit"
```

This was the strongest early point-in-time validation because it worked on a non-AAF public website rather than only on synthetic fixtures.

### Real-Site Negative Case

The flow was also tried on:

- `https://www.amazon.com/`

Observed result:

- no AAF manifest was present
- the system classified the page as e-commerce / homepage
- it inferred a plausible `search.submit` action
- the search field itself was found
- but the action was not executable because the inferred primary target was treated as lacking an accessible name
- the planner still selected that action, and execution failed with validation output

Observed CLI output:

```text
[browser] Launching visible browser...
[manifest] Fetching https://www.amazon.com/.well-known/agent-manifest.json
! No agent manifest found at https://www.amazon.com/.well-known/agent-manifest.json
[navigate] https://www.amazon.com

[discover] Found 1 action(s) on https://www.amazon.com/ [inferred]
  context: e-commerce / homepage (0.95)
  summary: The homepage of Amazon, featuring various product categories, promotional deals, and a search functionality.
  search.submit (source:inferred, risk:low, confirm:optional, confidence:0.92)
    unsupported: Primary target lacks an accessible name
    field: query <search>

Type a command in natural language, or "help" for options.

aaf> search for manchego cheese
[plan] Asking gpt-4o-mini to map: "search for manchego cheese"
✓ Planned: search.submit
  args: {"query":"manchego cheese"}

✗ Status: validation_error
✗ Error: Primary target lacks an accessible name
```

What this suggests:

- the current system can often infer the right high-level action even on large production sites
- but target grounding is still fragile on complex commercial pages
- large sites with layered navigation, custom controls, or ambiguous submit elements are still a weak spot
- the current safety checks are doing their job by refusing to execute when the target is not grounded confidently enough

This is a useful failure, not a useless one. It shows:

- the classification and intent inference are reasonably strong
- the current bottleneck is reliable execution grounding on complex sites
- the next improvements should focus more on target resolution and execution recovery than on basic page understanding

### Real-Site Mixed Case

Amazon was later rerun after partial low-risk execution and Enter fallback were added.

Observed result:

- the homepage search action became executable
- the runtime filled the search field and used Enter fallback successfully
- the page then re-scraped and inferred a new action set for the search-results page
- a follow-up filter action was inferred on the results page
- that filter action then failed during execution because the inferred target pointed at a native `<select>` that was visually wrapped by Amazon's custom dropdown UI, causing pointer interception during click

Observed CLI output:

```text
[browser] Launching visible browser...
[manifest] Fetching https://www.amazon.com/.well-known/agent-manifest.json
! No agent manifest found at https://www.amazon.com/.well-known/agent-manifest.json
[navigate] https://www.amazon.com

[discover] Found 1 action(s) on https://www.amazon.com/ [inferred]
  context: e-commerce / homepage (0.95)
  summary: Amazon's homepage featuring various deals and categories for shopping.
  search.submit (source:inferred, risk:low, confirm:optional, confidence:0.92)
    field: query <search>

Type a command in natural language, or "help" for options.

aaf> search for manchego
[plan] Asking gpt-4o-mini to map: "search for manchego"
✓ Planned: search.submit
  args: {"query":"manchego"}

[act] filled query -> Search Amazon with "manchego"
[act] pressed Enter on Search Amazon

✓ Status: completed
✓ Result: submitted inferred action "search.submit" via Enter fallback


[discover] Found 2 action(s) on https://www.amazon.com/s?k=manchego&ref=nb_sb_noss [inferred]
  context: e-commerce / search results (0.95)
  summary: Search results for 'manchego' on Amazon, displaying various cheese products with options to filter and sort.
  search.submit (source:inferred, risk:low, confirm:optional, confidence:0.92)
    field: query <search>
  filter.apply (source:inferred, risk:low, confirm:optional, confidence:0.85)

aaf> filter by price under 20 dollars
[plan] Asking gpt-4o-mini to map: "filter by price under 20 dollars"
✓ Planned: filter.apply
  args: {}
✗ Failed: locator.click: Timeout 30000ms exceeded.
```

What this suggests:

- page-local re-discovery is working as intended
- partial execution plus Enter fallback materially improved real-site usefulness
- the next execution bottleneck is custom widget handling on large production sites
- on Amazon search results, the system found a plausible filter action but did not yet know how to operate the wrapped dropdown safely
- large sites with layered custom controls may need control-specific execution strategies, not just better page understanding

### Real-Site GPT-5.4 Case

Amazon was later rerun again using:

- `gpt-5.4`

Observed result:

- homepage understanding improved significantly
- the inferred action catalog on the homepage became much richer
- the runtime inferred search, account, cart, category, and other page-level actions
- the homepage search flow worked end to end
- the runtime successfully navigated to Amazon search results for `manchego cheese`

On the search-results page, the inference quality also improved:

- the page was classified as e-commerce marketplace / search results
- the runtime inferred result-level actions like:
  - `product.open`
  - `reviews.open`
  - `cart.add_item`
- these appeared as item-scoped actions with `product_name` fields

However, those repeated-item actions were still not executable in that Amazon page state.

Observed result on search results:

- repeated-item collection-style actions were inferred
- but several were marked unsupported with:
  - `Collection action could not be grounded within repeated items`

Observed CLI output excerpt:

```text
[discover] Found 11 action(s) on https://www.amazon.com/s?k=manchego+cheese&ref=nb_sb_noss [inferred]
  context: ecommerce marketplace / search results (0.96)
  summary: Amazon search results page for "manchego cheese" with a global search form, sort control, product results, and repeated item-level actions like opening product details, viewing reviews, seeing purchase options, and adding some items to cart.
  search.submit (source:inferred, supported:yes, risk:low, confirm:optional, confidence:0.98)
    field: department <select>
    field: query <search>
  results.sort (source:inferred, supported:yes, risk:low, confirm:optional, confidence:0.95)
    field: sort_by <select>
  product.open (source:inferred, supported:no, risk:low, confirm:optional, confidence:0.98)
    unsupported: Collection action could not be grounded within repeated items
    field: product_name <text>
  reviews.open (source:inferred, supported:no, risk:low, confirm:optional, confidence:0.90)
    unsupported: Collection action could not be grounded within repeated items
    field: product_name <text>
  cart.add_item (source:inferred, supported:no, risk:low, confirm:optional, confidence:0.88)
    unsupported: Collection action could not be grounded within repeated items
    field: product_name <text>
```

What this suggests:

- `gpt-5.4` is much better than `gpt-4o-mini` at seeing collection-like repeated-item actions on real sites
- the collection inference path is not limited to synthetic fixtures anymore
- the remaining bottleneck is no longer high-level collection recognition
- the current bottleneck is robust grounding within heterogeneous real-world item cards

In other words:

- repeated-item understanding improved materially
- repeated-item execution grounding is still the main weakness on messy production pages like Amazon search results

### Real-Site Papaya Consent Checker Case

The inferred path was later validated on:

- `https://consentchecker.papayacomply.ai`

Observed result:

- no AAF manifest was present
- the runtime inferred a primary consent-analysis workflow on the landing page
- the inferred form included:
  - `website_url <url>`
  - `consent_flow <radio-group>`
  - `region <select>`
- the CLI printed the discovered radio-group and select options directly in the catalog
- planning mapped a natural-language request into the correct semantic action with grounded arguments
- execution filled the URL, selected the consent-flow radio option, selected the region, and clicked the start button successfully
- after submit, the runtime rediscovered the next page and produced a new analysis-status action set

Observed CLI output excerpt:

```text
[discover] Found 5 action(s) on https://papaya-consent-check-be11a0846ed5.herokuapp.com/ [inferred]
  context: consent testing SaaS / consent check runner (0.94)
  summary: Papaya Consent Checker landing/workspace page for starting a consent analysis on a target website, with consent flow and region options. The primary supported workflow is submitting a consent check analysis form. Login and pricing links are also present as workflow entry points.
  consent_check.start_analysis (source:inferred, supported:yes, risk:low, confirm:optional, confidence:0.97)
    field: website_url <url>
    field: consent_flow <radio-group>
    options: Accept All Cookies | Reject All Cookies | Global Privacy Control (GPC) | Define Granular Consent Flow
    field: granular_consent_instructions <text>
    field: region <select>
    options: Default (California, US) | US-CA | US-NY | US-CO | ...

aaf> Start an analysis for 'nature.com' with a Reject all flow in california
[plan] Asking gpt-5.4 to map: "Start an analysis for 'nature.com' with a Reject all flow in california"
✓ Planned: consent_check.start_analysis
  args: {"website_url":"nature.com","consent_flow":"Reject All Cookies","region":"Default (California, US)"}

[act] filled website_url -> Website URL with "nature.com"
[act] selected consent_flow -> Consent Flow as "Reject All Cookies"
[act] filled region -> Region (Geolocation) with "Default (California, US)"
[act] clicked target -> button "Start Analysis Starting..."

✓ Status: completed
✓ Result: submitted inferred action "consent_check.start_analysis"
```

What this suggests:

- the inferred path can now support richer real-world form controls than earlier in the project
- `url` fields are now handled correctly as fillable inputs rather than being rejected
- grouped radio choices can now be exposed semantically and resolved to real option elements at execution time
- printing discovered options in the CLI materially improves debuggability and trust
- page-local rediscovery after submit continues to work on real production apps

This is a stronger validation than the earlier purely synthetic form examples because it exercises a real third-party page with a mixed-control form.

## Pilo-Inspired Grounding

One of the recent improvements was motivated by comparing this repo's inferred-mode grounding with the Pilo approach.

The relevant idea taken from Pilo was not to replace AAF or inferred action discovery with a full YAML accessibility-tree flow, but to borrow the grounding mindset:

- keep action discovery semantic
- but make the discovered actions more tightly attached to real page elements

Concretely, the inferred snapshot now carries richer per-element grounding metadata, including:

- tag name
- pointer-event availability
- pointer-cursor signal
- element box geometry

This was added so that when the LLM infers an action like:

- `cart.add_item`
- `product.open`
- `consent_check.start_analysis`

the runtime has more than just a vague text/name match when grounding it.

This helped shift the inferred pipeline toward:

- semantic discovery from structured page snapshots
- followed by more concrete grounding in actual DOM elements

instead of relying purely on loose post-hoc fuzzy matching.

### Why This Matters

Earlier in the work, the system could often infer the right action name and arguments, but still fail during execution because the final click target was not grounded robustly enough.

The Pilo-inspired changes improved this by:

- enriching the snapshot before the LLM sees it
- grounding collection actions against real per-item controls during normalization
- preserving enough information for execution to act on real selectors instead of re-inferring the control at click time

This does not make the runtime identical to Pilo.

Important difference:

- Pilo is fundamentally accessibility-tree-first
- this repo is still semantic action discovery first

But the recent work borrows the best part of that design:

- improve grounding quality by carrying more concrete element evidence through the entire inferred-action pipeline

### Error Reporting Status

Error reporting for inferred-action failures is now clearer than it was earlier in the run.

Previously, some blocked inferred actions surfaced placeholder text like:

- `optional`

That was confusing and did not explain the real failure mode.

Current behavior:

- blocked inferred actions now surface the actual grounding/safety reason when available
- in the Amazon case, the runtime now reports:
  - `Primary target lacks an accessible name`
- low-risk inferred actions are no longer all-or-nothing:
  - search-like actions may still fill the query field and press Enter
  - other low-risk form actions may fill fields and return `awaiting_review`

This is better because it tells us:

- the planner likely chose the right high-level action
- the failure was in execution grounding, not intent understanding

So at this point the error logging is good enough to distinguish:

- page understanding problems
- target-grounding problems
- safety blocks
- input validation problems

## Collection Inference Status

The inferred-mode pipeline now has an explicit repeated-item collection path.

Current structure:

1. snapshot creation can emit `collectionCandidates`
2. each candidate contains repeated items plus item-local controls
3. the inference prompt includes those candidates in the JSON sent to the LLM
4. if the LLM returns a matching inferred collection, the runtime can normalize it into:
   - a discovered collection
   - one or more parameterized item-scoped inferred actions
5. execution can then resolve an item reference like `item_name` before clicking the matching local control

Important implementation detail:

- collection candidates are detector output, not final semantic collections
- they only become true inferred collections if the LLM returns a matching `collectionId`
- once normalized, collection actions now keep grounded per-item target selectors rather than trying to rediscover the correct control at execution time

This matters because we now have clear evidence that:

- the detector can find repeated-item groups correctly
- model behavior still affects whether those groups become useful collection actions
- and grounding quality improves when item-local controls are preserved directly from the snapshot

## Collection Naming Fix

There was a bug where collection candidates were being labeled with the first repeated item's heading.

Example bad behavior:

- the repeated product grid was named `Manchego Curado`

Cause:

- the collection label heuristic was naively pulling the first descendant heading inside the container

Current behavior:

- collection labels now prefer:
  - `aria-label` on the container
  - headings in non-item direct children of the container
  - preceding sibling headings
  - enclosing section/main/article headings before the collection

This fixed the product-list fixture so the collection is now labeled:

- `Search results`

instead of the first product name.

## Collections

To test repeated-item inference in a controlled way, a new local unannotated product-list fixture was created:

- `tests/falsification/fixtures/unannotated-product-list/index.html`

This page was designed specifically to exercise collection-style inference on a non-AAF page. It includes:

- a search form
- a filter form
- a repeated product-card grid
- per-item `Add to cart` and `Save for later` controls
- item identity cues such as product name and price

This let us test the repeated-item path locally instead of relying on noisy real ecommerce pages.

### What Was Observed

Using `debug collections`, the runtime found a repeated-item collection candidate with:

- 4 product items
- a stable repeated structure signature
- item-local controls captured correctly for each card

After the collection naming fix, the candidate is labeled:

- `Search results`

instead of incorrectly using the first item title.

### Model Change

The biggest change in behavior came from switching from `gpt-4o-mini` to:

- `gpt-5.4`

in the visible-browser CLI flow.

With the stronger model, the inferred action set on the unannotated product-list page improved substantially. It inferred:

- `search.submit`
- `filters.apply`
- `cart.add_item`
- `wishlist.save_item`

This is important because it means the model was able to:

- recognize the repeated-item collection
- promote it into shared item-level action templates
- expose those templates as parameterized actions using `product_name`

### End-to-End Result

The following command was tested successfully:

- `Add young manchego to cart`

Observed result:

- the planner mapped the command to `cart.add_item`
- the runtime resolved `product_name` to `Young Manchego`
- the click was scoped to the correct item-local `Add to cart` button
- execution completed successfully

Observed CLI output:

```text
[discover] Found 4 action(s) on http://localhost:8082/tests/falsification/fixtures/unannotated-product-list/index.html [inferred]
  context: ecommerce / product_listing (0.95)
  summary: Cheese Shop product listing page with catalog search, filter controls, and a repeated search-results collection of cheese products offering item-level add-to-cart and save-for-later actions.
  search.submit (source:inferred, supported:yes, risk:low, confirm:optional, confidence:0.97)
    field: query <search>
  filters.apply (source:inferred, supported:yes, risk:low, confirm:optional, confidence:0.96)
    field: origin <select>
    field: in_stock_only <checkbox>
  cart.add_item (source:inferred, supported:yes, risk:low, confirm:optional, confidence:0.95)
    field: product_name <text>
  wishlist.save_item (source:inferred, supported:yes, risk:low, confirm:optional, confidence:0.86)
    field: product_name <text>

aaf> Add young manchego to cart
[plan] Asking gpt-5.4 to map: "Add young manchego to cart"
✓ Planned: cart.add_item
  args: {"product_name":"young manchego"}

[act] resolved product_name -> "Young Manchego"
[act] clicked target -> button "Add to cart"

✓ Status: completed
✓ Result: submitted inferred action "cart.add_item"
```

### Current Interpretation

This is the strongest local validation so far for inferred collections on unannotated repeated-item pages.

It suggests that:

- collection candidate extraction is working
- item-local control capture is working
- collection-aware normalization is working
- item-scoped execution is working
- model quality still matters a lot for whether repeated-item candidates are promoted into useful collection actions

At this point, the remaining concern is less about whether the runtime can support collections at all, and more about:

- how reliably different models will infer them
- how deterministic the inferred action names and action sets are across rediscovery

## CLI Debugging Status

The CLI now supports debugging the inferred-discovery pipeline directly.

Current commands:

- `debug collections`
  - prints collection candidates, sample items, and item-local controls
- `debug snapshot`
  - prints the inferred DOM snapshot summary: headings, landmarks, forms, interactives, collection candidates, and page text summary
- `debug prompt`
  - prints the exact inference system prompt sent to the LLM, including the full nested snapshot JSON

There is also a startup env toggle:

- `AAF_DEBUG_COLLECTIONS=true`

This is useful because it lets us distinguish:

- snapshot extraction failures
- collection-candidate detection failures
- prompt/model failures
- post-inference normalization failures

Recent debugging improvements also make normal discovery output much more informative for form-heavy pages because the catalog now prints:

- supported options for `select`
- supported options for `radio`
- supported options for `radio-group`

## Important Constraint

The inferred-action system currently operates page by page.

That means:

- it reasons over the current page only
- it discovers actions from the currently loaded DOM only
- it does not build a cross-page capability map for arbitrary non-AAF sites

This is still a reasonable product boundary, especially if the intended destination is a browser extension. In that model, current-page inference is likely the correct scope.

Operationally, that now means:

- inferred actions are re-scraped from the currently loaded page
- after inferred execution, the runtime refreshes its inferred catalog instead of carrying stale actions forward
- the CLI also reprints the current page's inferred catalog after inferred navigation/execution

## Current Recovery Behavior

The runtime now has a limited recovery path for low-risk inferred actions when field grounding is good but submit-target grounding is weak.

Current recovery behavior:

- if the action is low-risk and the fields are grounded, the runtime may still fill fields even when the submit target is unresolved
- for search-like actions, it can press Enter on the primary field as a fallback
- for other low-risk form actions, it can fill the fields and return `awaiting_review`
- high-risk actions are still blocked rather than partially executed

Current observed limit:

- custom UI wrappers around native controls can still break direct click execution even after the right high-level action is inferred

This is meant to improve practical usefulness on real sites like Amazon without weakening the current safety boundary for destructive or ambiguous actions.

## How Association Works

There are now two different ways actions get associated with page elements.

### AAF Mode

In AAF mode, the association is explicit.

The page itself declares semantic meaning with AAF annotations such as:

- `data-agent-kind="action"`
- `data-agent-action="..."`
- `data-agent-kind="field"`
- `data-agent-field="..."`
- `data-agent-for-action="..."`

So in AAF mode:

- action names are declared by the page
- fields are declared by the page
- the association between action and field is explicit in the DOM

This is the high-reliability path.

### Inferred Mode

In inferred mode, the page does not explicitly declare semantic actions.

So the runtime creates a temporary semantic layer for the current page using:

- DOM structure
- form structure
- visible controls
- ARIA snapshot data
- labels, headings, and landmarks
- LLM interpretation

The runtime first assigns temporary internal element IDs such as:

- `el_1`
- `el_2`

These are not page IDs. They are internal handles for one discovery pass.

The model then selects from those extracted elements when proposing actions and fields.

### What “Primary Target” Means

The primary target is the main trigger element for an inferred action.

Examples:

- for a search action, it is usually the submit button or submit control
- for a login action, it is usually the sign-in button
- for a link action, it is the link itself
- for a toggle action, it is the checkbox/radio/switch itself

The fields are separate from the primary target.

So:

- fields are what get filled
- primary target is what gets clicked, toggled, opened, or submitted

### Why This Matters

Some real-site failures are not failures of page understanding. They are failures of target grounding.

That means:

- the system understood the likely action
- the relevant field may have been found correctly
- but the runtime did not trust the main trigger element enough to execute it safely

This is what happened in the Amazon search example:

- the system inferred `search.submit`
- it found the search field
- but it did not confidently ground the submit target
- so execution was blocked

This is why target recovery and form-based submit recovery are important next steps.

## Current Strengths

Good current fits:

- login pages
- search forms
- settings/toggle pages
- simple create/update forms
- obvious links and buttons

Positive qualities:

- works on unannotated pages
- produces semantic actions instead of selectors
- can be tested in a real visible browser
- has conservative safety behavior
- increasingly grounds inferred actions in concrete DOM targets rather than loose text matches
- can now handle mixed-control forms with URL inputs, selects, and grouped radio choices

## Current Limitations

This is not universal arbitrary-web automation yet.

Weak current fits:

- highly custom widget libraries with weak accessibility
- multi-step workflows
- large production sites with layered/custom commerce UI
- file uploads
- rich text editors
- drag/drop interfaces
- canvas-heavy interfaces
- payment flows
- destructive admin flows

It should currently be understood as:

- useful inferred fallback for common accessible interactions
- not a replacement for explicit AAF semantics

## Environment / Test Status

Node was updated to:

- `v20.20.1`

This resolved earlier dependency/runtime issues seen during testing.

At the current point in time:

- the new inferred-discovery tests pass
- the manual fixture demos work
- the real-site demo works
- recent real-site Papaya consent-check execution works end to end
- the suite is largely green aside from a known unrelated `aaf-lint` branch-name test issue

Remaining known unrelated test issue:

- one `aaf-lint` CLI test still assumes a `main` branch exists in a temp git repo, but the repo initializes as `master`

## Near-Term Next Steps

Most useful next steps from here:

1. Test on more real public websites.
2. Expand support for dialogs, tabs, and table/filter flows.
3. Improve result/status detection on arbitrary pages.
4. Improve behavior on more complex accessible component libraries and large production websites.
5. Keep the inferred path page-local unless there is a strong reason to broaden scope.

## Bottom Line

Point-in-time summary:

- inferred semantic actions for arbitrary unannotated pages are now working in the Playwright runtime
- the feature has been validated on local fixtures and on multiple real public sites, including a mixed-control SaaS form
- it is practical for common accessible interactions
- it remains intentionally constrained and page-local
