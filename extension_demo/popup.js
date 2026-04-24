const discoverButton = document.getElementById('discoverButton');
const copySnapshotButton = document.getElementById('copySnapshotButton');
const statusEl = document.getElementById('status');
const pageMetaEl = document.getElementById('pageMeta');
const resultsEl = document.getElementById('results');
const useLlmEl = document.getElementById('useLlm');
const baseUrlEl = document.getElementById('baseUrl');
const apiKeyEl = document.getElementById('apiKey');
const modelEl = document.getElementById('model');

let lastSnapshot = null;

const STORAGE_KEY = 'aaf_extension_demo_settings';

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.className = isError ? 'error' : '';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderMeta(payload, sourceLabel) {
  const parts = [];
  if (payload?.title) parts.push(`<strong>${escapeHtml(payload.title)}</strong>`);
  if (payload?.url) parts.push(`<span>${escapeHtml(payload.url)}</span>`);
  if (sourceLabel) parts.push(`<span>mode: ${escapeHtml(sourceLabel)}</span>`);
  if (payload?.pageContext?.summary) parts.push(`<span>${escapeHtml(payload.pageContext.summary)}</span>`);
  pageMetaEl.innerHTML = parts.join('<br />');
}

function renderActions(payload, sourceLabel) {
  const actions = payload?.actions || [];
  if (!actions.length) {
    resultsEl.className = 'results empty';
    resultsEl.textContent = 'No actions found on this page.';
    renderMeta(payload, sourceLabel);
    return;
  }

  resultsEl.className = 'results';
  resultsEl.innerHTML = actions.map((action) => {
    const pills = [
      action.source ? `source:${action.source}` : sourceLabel ? `source:${sourceLabel}` : '',
      action.supported === false ? 'supported:no' : 'supported:yes',
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

function sendMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

async function ensureContentScript(tabId) {
  try {
    await sendMessage(tabId, { type: 'AAF_EXTENSION_PING' });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-script.js'],
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

function buildInferencePrompt(snapshot) {
  return `You infer user-meaningful actions from a structured page snapshot.
Return EXACTLY one JSON object with this shape:
{
  "summary": "string",
  "actions": [
    {
      "action": "search.submit",
      "title": "Search",
      "description": "optional",
      "supported": true,
      "confidence": 0.0,
      "fields": [
        {
          "field": "query",
          "elementId": "ext_1",
          "label": "Search",
          "controlType": "search",
          "required": true,
          "enumValues": []
        }
      ]
    }
  ]
}

Rules:
- Use only elementId values from the supplied snapshot interactives.
- Prefer semantic dot-separated action names.
- Prefer one action per form or important visible workflow.
- Include fields only when they are part of that action.
- For select or radio-group fields, include enumValues when the snapshot provides options.
- Mark clearly blocked or ambiguous actions as supported=false.

Snapshot:
${JSON.stringify(snapshot, null, 2)}`;
}

async function inferWithLlm(snapshot, settings) {
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
  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed.actions)) throw new Error('LLM response is missing an actions array.');

  const actions = parsed.actions.map((action) => ({
    action: action.action || 'page.act',
    title: action.title || action.action || 'Action',
    description: action.description || '',
    supported: action.supported !== false,
    confidence: typeof action.confidence === 'number' ? action.confidence : undefined,
    source: 'llm',
    fields: Array.isArray(action.fields)
      ? action.fields.map((field) => {
        const node = snapshot.interactives.find((interactive) => interactive.elementId === field.elementId);
        return {
          field: field.field || field.elementId || 'field',
          label: field.label || node?.name || '',
          controlType: field.controlType || node?.type || 'text',
          required: Boolean(field.required),
          options: node?.options,
          enumValues: Array.isArray(field.enumValues) ? field.enumValues : node?.options,
        };
      })
      : [],
  }));

  return {
    url: snapshot.url,
    title: snapshot.title,
    pageContext: {
      summary: parsed.summary || snapshot.pageTextSummary || '',
    },
    actions,
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
      const snapshot = await sendMessage(tab.id, { type: 'AAF_EXTENSION_GET_SNAPSHOT' });
      if (snapshot?.error) throw new Error(snapshot.error);
      lastSnapshot = snapshot;
      setStatus('Calling LLM...');
      const payload = await inferWithLlm(snapshot, settings);
      renderActions(payload, 'llm');
      setStatus(`Found ${payload.actions.length} action(s) with LLM inference.`);
      return;
    }

    const payload = await sendMessage(tab.id, { type: 'AAF_EXTENSION_DISCOVER' });
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

discoverButton.addEventListener('click', discover);
copySnapshotButton.addEventListener('click', copySnapshot);
useLlmEl.addEventListener('change', saveSettings);
baseUrlEl.addEventListener('change', saveSettings);
apiKeyEl.addEventListener('change', saveSettings);
modelEl.addEventListener('change', saveSettings);

loadSettings().then(discover).catch((error) => {
  setStatus(error instanceof Error ? error.message : String(error), true);
});
