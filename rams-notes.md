# Ram's Notes

## Current Status

AAF now has a working Playwright-first fallback for arbitrary unannotated pages.

Current behavior:

- if a page has AAF annotations, the existing AAF path is used
- if a page does not have AAF annotations, the runtime can infer semantic actions from the current page when an LLM backend is configured
- this works through the Playwright runtime and the CLI
- the widget has not been updated

## What Was Added

The project now supports:

- inferred action discovery on unannotated pages
- semantic action naming for inferred actions
- safe execution of common inferred actions
- visible-browser manual testing through the CLI
- OpenAI-compatible and Ollama-backed inference for the CLI path

## What Was Validated

### Local Fixture Validation

The unannotated fixture pages were exercised successfully:

- login page
- search page
- settings/toggle page
- destructive page

The login flow was verified visually by updating the page so that successful submit renders:

- `hello <email>`

This confirmed that inference, planning, filling, and submit propagation all worked end to end.

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

This is the strongest point-in-time validation so far because it worked on a non-AAF public website rather than only on synthetic fixtures.

## Important Constraint

The inferred-action system currently operates page by page.

That means:

- it reasons over the current page only
- it discovers actions from the currently loaded DOM only
- it does not build a cross-page capability map for arbitrary non-AAF sites

This is still a reasonable product boundary, especially if the intended destination is a browser extension. In that model, current-page inference is likely the correct scope.

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

## Current Limitations

This is not universal arbitrary-web automation yet.

Weak current fits:

- highly custom widget libraries with weak accessibility
- multi-step workflows
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
- the full suite is mostly green

Remaining known unrelated test issue:

- one `aaf-lint` CLI test still assumes a `main` branch exists in a temp git repo, but the repo initializes as `master`

## Near-Term Next Steps

Most useful next steps from here:

1. Test on more real public websites.
2. Expand support for dialogs, tabs, and table/filter flows.
3. Improve result/status detection on arbitrary pages.
4. Improve behavior on more complex accessible component libraries.
5. Keep the inferred path page-local unless there is a strong reason to broaden scope.

## Bottom Line

Point-in-time summary:

- inferred semantic actions for arbitrary unannotated pages are now working in the Playwright runtime
- the feature has been validated both on local fixtures and on a real public site
- it is practical for common accessible interactions
- it remains intentionally constrained and page-local
