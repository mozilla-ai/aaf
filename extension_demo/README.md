# Extension Demo

This is a minimal Chrome extension demo for page-local action discovery.

What it does:

- inspects the current page
- lists explicit AAF actions when the page is annotated
- otherwise falls back to heuristic discovery for common forms and visible controls
- optionally sends the page snapshot to OpenAI to infer richer actions
- can take a plain-text command, ask the LLM to map it to a discovered action, and execute it on the current page

## Load It In Chrome

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the `extension_demo` folder

## Use It

1. Open any webpage
2. Click the extension icon
3. Click `Discover`

By default, the extension uses local discovery only.

## Optional OpenAI Mode

If you want a closer version of the inferred-action workflow:

1. Open the popup
2. Enable `Use OpenAI LLM inference`
3. Paste your OpenAI API key
4. Optionally change the model
5. Click `Discover`

Default values:

- Model: `gpt-5.4`

The extension uses `https://api.openai.com/v1` by default.

If you need a different OpenAI-compatible endpoint, open `Advanced Settings` and change the base URL.

The popup stores these values in `chrome.storage.local`.

## Run Commands

Once actions have been discovered in OpenAI mode:

1. Type a plain-language command into the `Command` box
2. Click `Run`

Examples:

- `Search for manchego cheese`
- `Log in with alice@example.com`
- `Start an analysis for nature.com with a Reject All flow`

The extension will:

- ask the LLM to map the command to one discovered action
- fill the grounded fields on the page
- click the grounded target when available
- refresh discovery after execution

## Notes

- This is a demo, not a production extension
- It now supports basic command planning and execution, but only for the current page
- The local fallback is heuristic and intentionally simple
- The LLM mode is closer to the repo's inferred-action direction, but still lightweight and extension-friendly
