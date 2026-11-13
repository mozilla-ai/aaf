#!/usr/bin/env npx tsx
/**
 * AAF CLI Agent — interact with AAF-annotated websites from the terminal.
 *
 * Usage:
 *   npx tsx packages/aaf-cli/src/cli.ts <url> "<command>"
 *   npx tsx packages/aaf-cli/src/cli.ts http://localhost:5177/invoices/new "create an invoice for alice@test.com for 99 EUR"
 *
 * Interactive mode (no command):
 *   npx tsx packages/aaf-cli/src/cli.ts http://localhost:5177
 */
import { chromium, type Page, type Browser } from 'playwright';
import { LocalPlanner } from '@agent-accessibility-framework/planner-local';
import { coerceArgs, getPageForAction } from '@agent-accessibility-framework/runtime-core';
import type { AgentManifest, ActionCatalog, DiscoveredAction } from '@agent-accessibility-framework/runtime-core';
import * as readline from 'readline';

// ─── Config ───────────────────────────────────────────────────────────────
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';
const HEADLESS = process.env.AAF_HEADLESS !== 'false';

// ─── Helpers ──────────────────────────────────────────────────────────────
function log(label: string, msg: string) {
  console.log(`\x1b[36m[${label}]\x1b[0m ${msg}`);
}
function success(msg: string) {
  console.log(`\x1b[32m✓\x1b[0m ${msg}`);
}
function error(msg: string) {
  console.error(`\x1b[31m✗\x1b[0m ${msg}`);
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
  await page.waitForSelector('[data-agent-kind]', { timeout: 5000 }).catch(() => {});
}

async function discoverActions(page: Page): Promise<ActionCatalog> {
  const actions = await page.evaluate(() => {
    const actionEls = document.querySelectorAll('[data-agent-kind="action"][data-agent-action]');
    const results: DiscoveredAction[] = [];
    const seen = new Set<string>();

    actionEls.forEach((el) => {
      const name = el.getAttribute('data-agent-action')!;
      if (name.split('.').length > 2 || seen.has(name)) return;
      seen.add(name);

      const fields: Array<{ field: string; tagName: string; forAction?: string }> = [];
      el.querySelectorAll('[data-agent-kind="field"]').forEach((f) => {
        fields.push({
          field: f.getAttribute('data-agent-field')!,
          tagName: f.tagName.toLowerCase(),
        });
      });
      document.querySelectorAll(`[data-agent-kind="field"][data-agent-for-action="${name}"]`).forEach((f) => {
        const fieldName = f.getAttribute('data-agent-field')!;
        if (!fields.some((x) => x.field === fieldName)) {
          fields.push({ field: fieldName, tagName: f.tagName.toLowerCase(), forAction: name });
        }
      });

      const statuses: Array<{ output: string; tagName: string }> = [];
      el.querySelectorAll('[data-agent-kind="status"]').forEach((s) => {
        statuses.push({ output: s.getAttribute('data-agent-output')!, tagName: s.tagName.toLowerCase() });
      });

      let submitAction: string | undefined;
      el.querySelectorAll('[data-agent-kind="action"]').forEach((sub) => {
        const subAction = sub.getAttribute('data-agent-action');
        if (subAction && subAction.startsWith(name + '.')) submitAction = subAction;
      });

      results.push({
        action: name,
        kind: 'action',
        danger: el.getAttribute('data-agent-danger') ?? undefined,
        confirm: el.getAttribute('data-agent-confirm') ?? undefined,
        scope: el.getAttribute('data-agent-scope') ?? undefined,
        idempotent: el.getAttribute('data-agent-idempotent') ?? undefined,
        fields,
        statuses,
        submitAction,
      });
    });
    return results;
  });

  return { actions, url: page.url(), timestamp: new Date().toISOString() };
}

/** Execute an action directly on the page — fill fields, click submit, read status. */
async function executeAction(
  page: Page,
  actionName: string,
  args: Record<string, unknown>,
  discovered: DiscoveredAction,
  confirmSubmit?: () => Promise<boolean>,
) {
  // Fill fields
  for (const field of discovered.fields) {
    const value = args[field.field];
    if (value === undefined) continue;

    const selector = await page.evaluate(
      ({ name, field }) => {
        const actionRoot = document.querySelector(
          `[data-agent-kind="action"][data-agent-action="${name}"]`,
        );
        const base = `[data-agent-kind="field"][data-agent-field="${field}"]`;
        const nested = actionRoot?.querySelector(base) as Element | null;
        if (nested?.id) return `#${nested.id}`;

        const linked = document.querySelector(
          `${base}[data-agent-for-action="${name}"]`,
        ) as Element | null;
        if (linked?.id) return `#${linked.id}`;
        return linked ? `${base}[data-agent-for-action="${name}"]` : null;
      },
      { name: actionName, field: field.field },
    );
    if (!selector) continue;

    const tagName = await page.evaluate(
      (sel) => document.querySelector(sel)?.tagName.toLowerCase(),
      selector,
    );

    if (tagName === 'select') {
      await page.selectOption(selector, String(value));
      log('fill', `${field.field} = "${value}" (select)`);
    } else if (tagName === 'textarea' || tagName === 'input') {
      await page.fill(selector, String(value));
      log('fill', `${field.field} = "${value}"`);
    }
  }

  if (confirmSubmit && !(await confirmSubmit())) {
    return { status: 'cancelled' };
  }

  // Click submit
  const submitAction = discovered.submitAction || actionName;
  const submitSelector = `[data-agent-action="${submitAction}"]`;
  log('click', submitAction);
  await page.click(submitSelector);

  // Wait for status to update
  await page.waitForTimeout(500);

  // Read status
  const statusText = await page.evaluate((name) => {
    const actionRoot = document.querySelector(
      `[data-agent-kind="action"][data-agent-action="${name}"]`,
    );
    const nested = actionRoot?.querySelector('[data-agent-kind="status"]');
    const linked = document.querySelector(
      `[data-agent-kind="status"][data-agent-for-action="${name}"]`,
    );
    const el = nested || linked;
    return el?.textContent?.trim() || '';
  }, actionName);

  if (statusText) {
    return { status: 'completed', result: statusText };
  }
  return { status: 'completed' };
}

function printCatalog(catalog: ActionCatalog) {
  console.log();
  log('discover', `Found ${catalog.actions.length} action(s) on ${catalog.url}`);
  for (const action of catalog.actions) {
    const tags: string[] = [];
    if (action.danger) tags.push(`danger:${action.danger}`);
    if (action.confirm) tags.push(`confirm:${action.confirm}`);
    if (action.scope) tags.push(`scope:${action.scope}`);
    const tagStr = tags.length > 0 ? ` \x1b[90m(${tags.join(', ')})\x1b[0m` : '';
    console.log(`  \x1b[33m${action.action}\x1b[0m${tagStr}`);
    for (const field of action.fields) {
      dim(`  field: ${field.field} <${field.tagName}>`);
    }
    if (action.submitAction) {
      dim(`  submit: ${action.submitAction}`);
    }
  }
  console.log();
}

// ─── Main ─────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
\x1b[1mAAF CLI Agent\x1b[0m — interact with AAF-annotated websites

\x1b[1mUsage:\x1b[0m
  npx tsx packages/aaf-cli/src/cli.ts <url> [command]

\x1b[1mExamples:\x1b[0m
  # One-shot: execute a single command
  npx tsx packages/aaf-cli/src/cli.ts http://localhost:5177/invoices/new/ "create invoice for alice@test.com, 99 EUR"

  # Interactive REPL
  npx tsx packages/aaf-cli/src/cli.ts http://localhost:5177/invoices/new/

  # Show browser window
  AAF_HEADLESS=false npx tsx packages/aaf-cli/src/cli.ts http://localhost:5177/invoices/new/

\x1b[1mEnvironment:\x1b[0m
  OLLAMA_URL     Ollama endpoint (default: http://localhost:11434)
  OLLAMA_MODEL   Model name (default: llama3.2)
  AAF_HEADLESS   Set to "false" to show browser window
`);
    process.exit(0);
  }

  const url = args[0];
  const command = args.slice(1).join(' ') || null;
  const baseUrl = new URL(url).origin;

  // 1. Launch browser
  log('browser', `Launching ${HEADLESS ? 'headless' : 'visible'} browser...`);
  const browser: Browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // 2. Fetch manifest
    log('manifest', `Fetching ${baseUrl}/.well-known/agent-manifest.json`);
    const manifest = await fetchManifest(page, baseUrl);
    if (!manifest) {
      error(`No agent manifest found at ${baseUrl}/.well-known/agent-manifest.json`);
      error('Is the site running? Does it serve an AAF manifest?');
      process.exit(1);
    }
    success(`Manifest loaded: ${Object.keys(manifest.actions).length} action(s) defined`);

    // 3. Navigate to the target page
    log('navigate', url);
    await navigateTo(page, url);

    // 4. Create planner
    const planner = new LocalPlanner(OLLAMA_URL, OLLAMA_MODEL);

    // 5. Detect AAF
    const hasAaf = await page.evaluate(() => document.querySelectorAll('[data-agent-kind]').length > 0);
    if (!hasAaf) {
      error('No AAF annotations (data-agent-*) found on this page.');
      process.exit(1);
    }

    // 6. Discover actions
    let catalog = await discoverActions(page);
    printCatalog(catalog);

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const lines = rl[Symbol.asyncIterator]();
    async function readLine(prompt: string) {
      process.stdout.write(prompt);
      const line = await lines.next();
      return line.done ? '' : line.value.trim();
    }
    async function confirmSubmit() {
      const reply = await readLine('Review the values above. Type "submit" to submit, or press Enter to cancel: ');
      return reply.toLowerCase() === 'submit';
    }

    try {
      if (command) {
        await runCommand(command, catalog, planner, manifest, page, baseUrl, confirmSubmit);
        return;
      }

      console.log('Type a command in natural language, or "help" for options.\n');
      while (true) {
        const input = await readLine('aaf> ');
        if (!input || input === 'exit' || input === 'quit') break;
        try {
          if (input === 'scan' || input === 'discover') {
            printCatalog(await discoverActions(page));
          } else if (input.startsWith('goto ')) {
            const newUrl = input.slice(5).trim();
            await navigateTo(page, newUrl.startsWith('http') ? newUrl : baseUrl + newUrl);
            printCatalog(await discoverActions(page));
          } else if (input === 'help') {
            console.log('Enter a request, scan or discover, goto <path>, or exit.');
          } else {
            catalog = await discoverActions(page);
            await runCommand(input, catalog, planner, manifest, page, baseUrl, confirmSubmit);
          }
        } catch (err) {
          error((err as Error).message);
        }
      }
    } finally {
      rl.close();
    }
  } finally {
    await browser.close();
  }
}

async function runCommand(
  command: string,
  catalog: ActionCatalog,
  planner: LocalPlanner,
  manifest: AgentManifest,
  page: Page,
  baseUrl: string,
  confirmSubmit: () => Promise<boolean>,
) {
  // 1. Plan — LLM maps natural language to action + args
  log('plan', `Asking ${OLLAMA_MODEL} to map: "${command}"`);
  const plan = await planner.plan(command, catalog);
  if (plan.kind === 'answer') {
    console.log(plan.text);
    return;
  }
  if (plan.kind === 'navigate') {
    const target = new URL(plan.page, baseUrl);
    if (target.origin !== baseUrl) throw new Error('Planner navigation must stay on this site');
    log('navigate', target.href);
    await navigateTo(page, target.href);
    printCatalog(await discoverActions(page));
    return;
  }
  const { request } = plan;
  success(`Planned: \x1b[33m${request.action}\x1b[0m`);
  dim(`args: ${JSON.stringify(request.args)}`);
  console.log();

  // 2. Navigate if action is on a different page
  const actionDef = manifest.actions[request.action];
  const actionPage = getPageForAction(manifest, request.action);
  if (actionPage) {
    const currentPath = new URL(page.url()).pathname.replace(/\/$/, '');
    const targetPath = actionPage.replace(/\/$/, '');
    if (currentPath !== targetPath) {
      const actionUrl = `${baseUrl}${actionPage}`;
      log('navigate', actionUrl);
      await navigateTo(page, actionUrl);
      // Re-discover after navigation
      catalog = await discoverActions(page);
    }
  }

  // 3. Find the discovered action
  const discovered = catalog.actions.find((a) => a.action === request.action);
  if (!discovered) {
    throw new Error(`Action "${request.action}" not found on page`);
  }

  // 4. Coerce args to match schema types, then execute
  let coercedArgs = request.args;
  if (actionDef?.inputSchema) {
    const coerceResult = coerceArgs(request.args, actionDef.inputSchema);
    coercedArgs = coerceResult.args;
    if (coerceResult.coercions.length > 0) {
      for (const c of coerceResult.coercions) {
        dim(`coerce: ${c.field} ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)} (${c.rule})`);
      }
    }
  }
  log('execute', `Running ${request.action}...`);
  const needsReview = [actionDef?.confirmation, discovered.confirm]
    .some(policy => policy === 'review' || policy === 'required');
  const result = await executeAction(page, request.action, coercedArgs, discovered, needsReview ? confirmSubmit : undefined);
  if (result.status === 'cancelled') {
    log('review', 'Cancelled before submission.');
    return;
  }
  success('Status: completed');
  if (result.result) success(`Result: ${result.result}`);
}

main().catch((err) => {
  error(err.message);
  process.exit(1);
});
