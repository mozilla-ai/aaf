#!/usr/bin/env npx tsx
import { chromium, type Page, type Browser } from 'playwright';
import { buildSystemPrompt, buildUserPrompt, parseResponse, type LlmBackend } from '@agent-accessibility-framework/planner-local';
import { getPageForAction } from '@agent-accessibility-framework/runtime-core';
import type { AgentManifest, ActionCatalog } from '@agent-accessibility-framework/runtime-core';
import { PlaywrightAdapter } from '@agent-accessibility-framework/runtime-playwright';
import * as readline from 'readline';
import { createBackendCandidate } from './llm-config.js';

const LEGACY_OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const LEGACY_OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';
const HEADLESS = process.env.AAF_HEADLESS !== 'false';

function log(label: string, msg: string) {
  console.log(`\x1b[36m[${label}]\x1b[0m ${msg}`);
}
function success(msg: string) {
  console.log(`\x1b[32m✓\x1b[0m ${msg}`);
}
function error(msg: string) {
  console.error(`\x1b[31m✗\x1b[0m ${msg}`);
}
function warn(msg: string) {
  console.log(`\x1b[33m!\x1b[0m ${msg}`);
}
function dim(msg: string) {
  console.log(`\x1b[90m  ${msg}\x1b[0m`);
}

async function fetchManifest(page: Page, baseUrl: string): Promise<AgentManifest | null> {
  try {
    const resp = await page.goto(`${baseUrl}/.well-known/agent-manifest.json`);
    if (!resp || !resp.ok()) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

async function navigateTo(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
}

async function createBackendFromEnv(): Promise<LlmBackend | null> {
  const backend = createBackendCandidate({
    AAF_LLM_PROVIDER: process.env.AAF_LLM_PROVIDER,
    AAF_LLM_BASE_URL: process.env.AAF_LLM_BASE_URL,
    AAF_LLM_MODEL: process.env.AAF_LLM_MODEL,
    AAF_LLM_API_KEY: process.env.AAF_LLM_API_KEY,
    OLLAMA_URL: LEGACY_OLLAMA_URL,
    OLLAMA_MODEL: LEGACY_OLLAMA_MODEL,
  });
  if (!backend) return null;
  return await backend.isAvailable() ? backend : null;
}

async function planCommand(
  backend: LlmBackend,
  command: string,
  catalog: ActionCatalog,
): Promise<ReturnType<typeof parseResponse>> {
  const raw = await backend.generate(buildUserPrompt(command), buildSystemPrompt(catalog), { json: true });
  return parseResponse(raw, {
    validActions: catalog.actions.map((action) => action.action),
    validActionFields: Object.fromEntries(catalog.actions.map((action) => [action.action, action.fields.map((field) => field.field)])),
  });
}

function printCatalog(catalog: ActionCatalog) {
  console.log();
  const mode = catalog.discoveryMode || 'aaf';
  log('discover', `Found ${catalog.actions.length} action(s) on ${catalog.url} [${mode}]`);
  if (catalog.pageContext) {
    dim(`context: ${catalog.pageContext.siteType} / ${catalog.pageContext.pageType} (${catalog.pageContext.confidence.toFixed(2)})`);
    dim(`summary: ${catalog.pageContext.summary}`);
  }
  for (const action of catalog.actions) {
    const tags: string[] = [];
    if (action.source) tags.push(`source:${action.source}`);
    if (action.risk || action.danger) tags.push(`risk:${action.risk || action.danger}`);
    if (action.confirmation || action.confirm) tags.push(`confirm:${action.confirmation || action.confirm}`);
    if (action.confidence !== undefined) tags.push(`confidence:${action.confidence.toFixed(2)}`);
    const tagStr = tags.length > 0 ? ` \x1b[90m(${tags.join(', ')})\x1b[0m` : '';
    console.log(`  \x1b[33m${action.action}\x1b[0m${tagStr}`);
    if (action.supported === false) {
      dim(`  unsupported: ${action.unsupportedReason || 'blocked'}`);
    }
    for (const field of action.fields) {
      dim(`  field: ${field.field} <${field.controlType || field.tagName}>`);
    }
  }
  console.log();
}

async function runCommand(
  adapter: PlaywrightAdapter,
  backend: LlmBackend,
  command: string,
  catalog: ActionCatalog,
  manifest: AgentManifest | null,
  page: Page,
  baseUrl: string,
) {
  try {
    const model = backend.currentModel?.() || backend.name();
    log('plan', `Asking ${model} to map: "${command}"`);
    const plan = await planCommand(backend, command, catalog);

    if (plan.kind === 'answer') {
      success(plan.text);
      console.log();
      return;
    }

    if (plan.kind === 'navigate') {
      const target = plan.page.startsWith('http') ? plan.page : `${baseUrl}${plan.page}`;
      log('navigate', target);
      await navigateTo(page, target);
      console.log();
      return;
    }

    const actionName = plan.request.action;
    success(`Planned: \x1b[33m${actionName}\x1b[0m`);
    dim(`args: ${JSON.stringify(plan.request.args)}`);

    if (manifest) {
      const actionPage = getPageForAction(manifest, actionName);
      if (actionPage) {
        const currentPath = new URL(page.url()).pathname.replace(/\/$/, '');
        const targetPath = actionPage.replace(/\/$/, '');
        if (currentPath !== targetPath) {
          const actionUrl = `${baseUrl}${actionPage}`;
          log('navigate', actionUrl);
          await navigateTo(page, actionUrl);
          catalog = await adapter.discover();
        }
      }
    }

    const result = await adapter.execute({
      actionName,
      args: plan.request.args,
      ...(manifest ? { manifest } : {}),
      confirmed: plan.request.confirmed,
    });

    console.log();
    if (result.status === 'completed') {
      success('Status: completed');
      if (result.result) success(`Result: ${result.result}`);
    } else {
      error(`Status: ${result.status}`);
      if (result.error) error(`Error: ${result.error}`);
      if (result.missing_fields?.length) error(`Missing fields: ${result.missing_fields.join(', ')}`);
    }
    console.log();
  } catch (err) {
    error(`Failed: ${(err as Error).message}`);
    console.log();
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
\x1b[1mAAF CLI Agent\x1b[0m — interact with AAF sites and inferred arbitrary pages

\x1b[1mUsage:\x1b[0m
  npx tsx packages/aaf-cli/src/cli.ts <url> [command]

\x1b[1mEnvironment:\x1b[0m
  AAF_LLM_PROVIDER  ollama | openai
  AAF_LLM_BASE_URL  backend base URL
  AAF_LLM_MODEL     model name
  AAF_LLM_API_KEY   API key for openai-compatible providers
  OLLAMA_URL        legacy Ollama endpoint
  OLLAMA_MODEL      legacy Ollama model
  AAF_HEADLESS      Set to "false" to show browser window
`);
    process.exit(0);
  }

  const url = args[0];
  const command = args.slice(1).join(' ') || null;
  const baseUrl = new URL(url).origin;

  log('browser', `Launching ${HEADLESS ? 'headless' : 'visible'} browser...`);
  const browser: Browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    log('manifest', `Fetching ${baseUrl}/.well-known/agent-manifest.json`);
    const manifest = await fetchManifest(page, baseUrl);
    if (manifest) {
      success(`Manifest loaded: ${Object.keys(manifest.actions).length} action(s) defined`);
    } else {
      warn(`No agent manifest found at ${baseUrl}/.well-known/agent-manifest.json`);
    }

    log('navigate', url);
    await navigateTo(page, url);

    const backend = await createBackendFromEnv();
    const adapter = new PlaywrightAdapter(page, baseUrl, manifest || undefined, {
      ...(backend ? { llmBackend: backend } : {}),
    });

    const hasAaf = await page.evaluate(() => document.querySelectorAll('[data-agent-kind]').length > 0);
    if (!hasAaf && !backend) {
      error('No AAF annotations found and no LLM backend configured for inferred discovery.');
      process.exit(1);
    }

    let catalog = await adapter.discover();
    if (catalog.actions.length === 0) {
      error('No actions were discovered on this page.');
      process.exit(1);
    }
    printCatalog(catalog);

    if (command) {
      if (!backend) {
        error('A configured LLM backend is required to plan commands from natural language.');
        process.exit(1);
      }
      await runCommand(adapter, backend, command, catalog, manifest, page, baseUrl);
      return;
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const promptUser = () => {
      rl.question('\x1b[1maaf>\x1b[0m ', async (input) => {
        const trimmed = input.trim();
        if (!trimmed || trimmed === 'exit' || trimmed === 'quit') {
          rl.close();
          return;
        }
        if (trimmed === 'scan' || trimmed === 'discover') {
          catalog = await adapter.discover();
          printCatalog(catalog);
          promptUser();
          return;
        }
        if (trimmed.startsWith('goto ')) {
          const newUrl = trimmed.slice(5).trim();
          const fullUrl = newUrl.startsWith('http') ? newUrl : `${baseUrl}${newUrl}`;
          log('navigate', fullUrl);
          await navigateTo(page, fullUrl);
          catalog = await adapter.discover();
          printCatalog(catalog);
          promptUser();
          return;
        }
        if (trimmed === 'help') {
          console.log(`
  \x1b[1mCommands:\x1b[0m
    <natural language>  Ask the LLM to execute an action
    scan                Re-discover actions on current page
    goto <path>         Navigate to a different page
    help                Show this help
    exit                Quit
`);
          promptUser();
          return;
        }

        if (!backend) {
          error('No LLM backend configured. Set AAF_LLM_PROVIDER and related env vars.');
          promptUser();
          return;
        }

        catalog = await adapter.discover();
        await runCommand(adapter, backend, trimmed, catalog, manifest, page, baseUrl);
        promptUser();
      });
    };

    console.log('Type a command in natural language, or "help" for options.\n');
    promptUser();
    await new Promise<void>((resolve) => rl.on('close', resolve));
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  error(err.message);
  process.exit(1);
});
