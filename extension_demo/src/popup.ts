import {
  buildInferencePrompt,
  buildPlannerPrompt,
  normalizeInferenceResult,
  type BrowserActionCatalog,
  type BrowserDiscoverySnapshot,
} from '@agent-accessibility-framework/browser-actions';

const discoverButton = document.getElementById('discoverButton') as HTMLButtonElement;
const copySnapshotButton = document.getElementById('copySnapshotButton') as HTMLButtonElement;
const runCommandButton = document.getElementById('runCommandButton') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const pageMetaEl = document.getElementById('pageMeta') as HTMLDivElement;
const resultsEl = document.getElementById('results') as HTMLDivElement;
const useLlmEl = document.getElementById('useLlm') as HTMLInputElement;
const baseUrlEl = document.getElementById('baseUrl') as HTMLInputElement;
const apiKeyEl = document.getElementById('apiKey') as HTMLInputElement;
const modelEl = document.getElementById('model') as HTMLInputElement;
const commandInputEl = document.getElementById('commandInput') as HTMLTextAreaElement;

let lastSnapshot: BrowserDiscoverySnapshot | null = null;
let lastCatalog: BrowserActionCatalog | null = null;

const STORAGE_KEY = 'aaf_extension_demo_settings';

function setStatus(message: string, isError = false) {
  statusEl.textContent = message;
  statusEl.className = isError ? 'error' : '';
}

function escapeHtml(value: unknown) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderMeta(payload: BrowserActionCatalog | null, sourceLabel: string) {
  const parts: string[] = [];
  if (payload?.title) parts.push(`<strong>${escapeHtml(payload.title)}</strong>`);
  if (payload?.url) parts.push(`<span>${escapeHtml(payload.url)}</span>`);
  if (sourceLabel) parts.push(`<span>mode: ${escapeHtml(sourceLabel)}</span>`);
  if (payload?.pageContext?.siteType || payload?.pageContext?.pageType) {
    const context = [payload.pageContext.siteType, payload.pageContext.pageType].filter(Boolean).join(' / ');
    const confidence = payload.pageContext.confidence !== undefined
      ? ` (${Number(payload.pageContext.confidence).toFixed(2)})`
      : '';
    parts.push(`<span>context: ${escapeHtml(context)}${escapeHtml(confidence)}</span>`);
  }
  if (payload?.pageContext?.summary) parts.push(`<span>${escapeHtml(payload.pageContext.summary)}</span>`);
  pageMetaEl.innerHTML = parts.join('<br />');
}

function renderActions(payload: BrowserActionCatalog, sourceLabel: string) {
  const actions = payload?.actions || [];
  if (!actions.length) {
    resultsEl.className = 'results empty';
    resultsEl.textContent = 'No actions found on this page.';
    renderMeta(payload, sourceLabel);
    lastCatalog = payload || null;
    return;
  }

  lastCatalog = payload;
  resultsEl.className = 'results';
  resultsEl.innerHTML = actions.map((action) => {
    const pills = [
      action.source ? `source:${action.source}` : sourceLabel ? `source:${sourceLabel}` : '',
      action.supported === false ? 'supported:no' : 'supported:yes',
      action.risk ? `risk:${action.risk}` : '',
      action.confirmation ? `confirm:${action.confirmation}` : '',
      action.confidence !== undefined ? `confidence:${Number(action.confidence).toFixed(2)}` : '',
    ].filter(Boolean);
    const fields = (action.fields || []).map((field) => {
      const options = (field.enumValues?.length ? field.enumValues : field.options) || [];
      return `
        <div class="field">
          <div><span class="fieldName">${escapeHtml(field.field)}</span> &lt;${escapeHtml(field.controlType || 'text')}&gt;</div>
          ${field.label ? `<div>${escapeHtml(field.label)}</div>` : ''}
          ${options.length ? `<div class="fieldOptions">options: ${escapeHtml(options.join(' | '))}</div>` : ''}
        </div>
      `;
    }).join('');

    return `
      <article class="actionCard">
        <div class="actionHeader">
          <div class="actionName">${escapeHtml(action.action)}</div>
          <div class="pillRow">${pills.map((pill) => `<span class="pill">${escapeHtml(pill)}</span>`).join('')}</div>
        </div>
        ${action.description ? `<div class="actionSummary">${escapeHtml(action.description)}</div>` : ''}
        ${action.supported === false && action.unsupportedReason ? `<div class="actionSummary error">${escapeHtml(action.unsupportedReason)}</div>` : ''}
        ${fields ? `<div class="fieldList">${fields}</div>` : ''}
      </article>
    `;
  }).join('');

  renderMeta(payload, sourceLabel);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab found.');
  return tab;
}

function sendMessage<T = unknown>(tabId: number, message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response: T) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

async function ensureContentScript(tabId: number) {
  try {
    await sendMessage(tabId, { type: 'AAF_EXTENSION_PING' });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['build/content-script.js'],
    });
  }
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const settings = stored[STORAGE_KEY] || {};
  useLlmEl.checked = Boolean(settings.useLlm);
  baseUrlEl.value = settings.baseUrl || 'https://api.openai.com/v1';
  apiKeyEl.value = settings.apiKey || '';
  modelEl.value = settings.model || 'gpt-5.4';
}

async function saveSettings() {
  await chrome.storage.local.set({
    [STORAGE_KEY]: {
      useLlm: useLlmEl.checked,
      baseUrl: baseUrlEl.value.trim(),
      apiKey: apiKeyEl.value.trim(),
      model: modelEl.value.trim(),
    },
  });
}

async function inferWithLlm(snapshot: BrowserDiscoverySnapshot, settings: { baseUrl: string; apiKey: string; model: string }) {
  const baseUrl = (settings.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const url = `${baseUrl}/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      messages: [
        {
          role: 'system',
          content: buildInferencePrompt(snapshot),
        },
        {
          role: 'user',
          content: 'Infer the actions available on this page.',
        },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM request failed (${response.status}): ${text}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error('LLM response did not include message content.');
  return normalizeInferenceResult(content, snapshot);
}

async function planCommand(command: string, catalog: BrowserActionCatalog, settings: { baseUrl: string; apiKey: string; model: string }) {
  const baseUrl = (settings.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const url = `${baseUrl}/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      messages: [
        {
          role: 'system',
          content: buildPlannerPrompt(command, catalog),
        },
        {
          role: 'user',
          content: command,
        },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Planner request failed (${response.status}): ${text}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Planner response did not include message content.');
  const parsed = JSON.parse(content) as { action?: string; args?: Record<string, unknown> };
  if (!parsed || typeof parsed !== 'object') throw new Error('Planner returned invalid JSON.');
  return {
    action: typeof parsed.action === 'string' ? parsed.action : 'none',
    args: parsed.args && typeof parsed.args === 'object' ? parsed.args : {},
  };
}

async function discover() {
  try {
    setStatus('Inspecting current page...');
    const tab = await getActiveTab();
    await ensureContentScript(tab.id);
    const settings = {
      useLlm: useLlmEl.checked,
      baseUrl: baseUrlEl.value.trim(),
      apiKey: apiKeyEl.value.trim(),
      model: modelEl.value.trim(),
    };
    await saveSettings();

    if (settings.useLlm) {
      if (!settings.apiKey || !settings.model) {
        throw new Error('OpenAI API key and model are required for LLM inference.');
      }
      setStatus('Collecting snapshot...');
      const snapshot = await sendMessage<BrowserDiscoverySnapshot & { error?: string }>(tab.id, { type: 'AAF_EXTENSION_GET_SNAPSHOT' });
      if (snapshot?.error) throw new Error(snapshot.error);
      lastSnapshot = snapshot;
      setStatus('Calling LLM...');
      const payload = await inferWithLlm(snapshot, settings);
      renderActions(payload, 'llm');
      setStatus(`Found ${payload.actions.length} action(s) with LLM inference.`);
      return;
    }

    const payload = await sendMessage<BrowserActionCatalog & { error?: string }>(tab.id, { type: 'AAF_EXTENSION_DISCOVER' });
    if (payload?.error) throw new Error(payload.error);
    lastSnapshot = payload.snapshot || null;
    renderActions(payload, payload.discoveryMode || 'heuristic');
    setStatus(`Found ${payload.actions.length} action(s) with ${payload.discoveryMode || 'heuristic'} discovery.`);
  } catch (error) {
    resultsEl.className = 'results empty';
    resultsEl.textContent = '';
    pageMetaEl.innerHTML = '';
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
}

async function copySnapshot() {
  if (!lastSnapshot) {
    setStatus('No snapshot available yet. Run discovery first.', true);
    return;
  }
  await navigator.clipboard.writeText(JSON.stringify(lastSnapshot, null, 2));
  setStatus('Snapshot copied to clipboard.');
}

async function runCommand() {
  try {
    const command = commandInputEl.value.trim();
    if (!command) {
      throw new Error('Enter a command first.');
    }

    const tab = await getActiveTab();
    await ensureContentScript(tab.id);

    const settings = {
      useLlm: useLlmEl.checked,
      baseUrl: baseUrlEl.value.trim(),
      apiKey: apiKeyEl.value.trim(),
      model: modelEl.value.trim(),
    };
    await saveSettings();

    if (!settings.useLlm) {
      throw new Error('Enable "Use OpenAI LLM inference" to run commands.');
    }
    if (!settings.apiKey || !settings.model) {
      throw new Error('OpenAI API key and model are required to run commands.');
    }

    if (!lastCatalog || !Array.isArray(lastCatalog.actions) || !lastCatalog.actions.length) {
      setStatus('Discovering actions first...');
      await discover();
    }
    if (!lastCatalog || !lastCatalog.actions?.length) {
      throw new Error('No discovered actions are available to plan against.');
    }

    setStatus('Planning command...');
    const plan = await planCommand(command, lastCatalog, settings);
    if (plan.action === 'none') {
      throw new Error('The planner could not map that command to an available action.');
    }

    const selectedAction = lastCatalog.actions.find((action) => action.action === plan.action);
    if (!selectedAction) {
      throw new Error(`Planned action "${plan.action}" was not found in the current catalog.`);
    }

    setStatus(`Executing ${plan.action}...`);
    const result = await sendMessage<{ error?: string; status?: string; executionDetails?: string[] }>(tab.id, {
      type: 'AAF_EXTENSION_EXECUTE',
      action: selectedAction,
      args: plan.args,
    });
    if (result?.error) {
      throw new Error(result.error);
    }

    if (Array.isArray(result?.executionDetails) && result.executionDetails.length) {
      setStatus(result.executionDetails.join(' | '));
    } else {
      setStatus(result?.status === 'completed' ? `Completed ${plan.action}.` : `Finished ${plan.action}.`);
    }

    await discover();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  }
}

discoverButton.addEventListener('click', discover);
copySnapshotButton.addEventListener('click', copySnapshot);
runCommandButton.addEventListener('click', runCommand);
commandInputEl.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    runCommand();
  }
});
useLlmEl.addEventListener('change', saveSettings);
baseUrlEl.addEventListener('change', saveSettings);
apiKeyEl.addEventListener('change', saveSettings);
modelEl.addEventListener('change', saveSettings);

loadSettings().then(discover).catch((error) => {
  setStatus(error instanceof Error ? error.message : String(error), true);
});
