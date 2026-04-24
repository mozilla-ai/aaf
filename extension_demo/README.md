# Extension Demo

This is a minimal Chrome extension demo for page-local action discovery.

What it does:

- inspects the current page
- lists explicit AAF actions when the page is annotated
- otherwise falls back to heuristic discovery for common forms and visible controls
- optionally sends the page snapshot to OpenAI to infer richer actions

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

## Notes

- This is a demo, not a production extension
- It does discovery only; it does not execute actions
- The local fallback is heuristic and intentionally simple
- The LLM mode is closer to the repo's inferred-action direction, but still lightweight and extension-friendly
