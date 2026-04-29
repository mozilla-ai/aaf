const discoverButton = document.getElementById('discoverButton');
const copySnapshotButton = document.getElementById('copySnapshotButton');
const runCommandButton = document.getElementById('runCommandButton');
const statusEl = document.getElementById('status');
const pageMetaEl = document.getElementById('pageMeta');
const resultsEl = document.getElementById('results');
const useLlmEl = document.getElementById('useLlm');
const baseUrlEl = document.getElementById('baseUrl');
const apiKeyEl = document.getElementById('apiKey');
const modelEl = document.getElementById('model');
const commandInputEl = document.getElementById('commandInput');

let lastSnapshot = null;
let lastCatalog = null;

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

function renderActions(payload, sourceLabel) {
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

const HIGH_RISK_PATTERN = /\b(delete|remove|destroy|logout|sign out|pay|purchase|buy now|place order|checkout|confirm transfer|close account|reset|revoke)\b/i;
const SUPPORTED_CONTROL_TYPES = new Set(['text', 'email', 'password', 'search', 'number', 'date', 'url', 'textarea', 'select', 'checkbox', 'radio', 'radio-group']);
const PLACEHOLDER_UNSUPPORTED_REASONS = new Set(['optional', 'never', 'review', 'required', 'true', 'false', 'n/a', 'none']);

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function sanitizeUnsupportedReason(reason) {
  if (!reason) return undefined;
  const normalized = String(reason).trim();
  if (!normalized) return undefined;
  if (PLACEHOLDER_UNSUPPORTED_REASONS.has(normalized.toLowerCase())) return undefined;
  return normalized;
}

function normalizeIntent(intent) {
  const value = String(intent || 'unknown').toLowerCase().replace(/[\s-]+/g, '_');
  switch (value) {
    case 'login':
    case 'log_in':
    case 'sign_in':
    case 'signin':
    case 'authentication':
    case 'authenticate':
    case 'auth':
      return 'authenticate';
    case 'navigate':
    case 'navigation':
      return 'navigate';
    case 'search':
      return 'search';
    case 'create':
      return 'create';
    case 'update':
    case 'save':
      return 'update';
    case 'delete':
      return 'delete';
    case 'filter':
      return 'filter';
    case 'sort':
      return 'sort';
    case 'toggle':
      return 'toggle';
    case 'submit':
      return 'submit';
    case 'open':
      return 'open';
    case 'close':
      return 'close';
    case 'download':
      return 'download';
    default:
      return 'unknown';
  }
}

function classifyPrefix(pageType, intent) {
  const page = String(pageType || '').toLowerCase();
  if (intent === 'search' || page.includes('search')) return 'search';
  if (intent === 'authenticate' || page.includes('login') || page.includes('sign in') || page.includes('auth')) return 'auth';
  if (page.includes('settings') || page.includes('preferences')) return 'settings';
  if (page.includes('product')) return 'product';
  if (page.includes('cart')) return 'cart';
  if (page.includes('checkout')) return 'checkout';
  if (page.includes('docs') || page.includes('documentation') || page.includes('article')) return 'navigation';
  return 'page';
}

function verbForIntent(intent) {
  switch (intent) {
    case 'navigate':
    case 'open':
      return 'open';
    case 'search':
      return 'submit';
    case 'authenticate':
      return 'sign_in';
    case 'toggle':
      return 'toggle';
    case 'filter':
      return 'apply_filters';
    case 'create':
      return 'create';
    case 'update':
      return 'save';
    case 'submit':
      return 'submit';
    default:
      return 'act';
  }
}

function normalizeActionName(rawAction, pageType, seen) {
  const prefix = slug(classifyPrefix(pageType, rawAction.intent)) || 'page';
  const verb = slug(verbForIntent(rawAction.intent)) || 'act';
  const objectHint = slug(rawAction.title || rawAction.description || String(rawAction.action || '').split('.').slice(-1)[0] || 'task') || 'task';
  let candidate = `${prefix}.${verb}_${objectHint}`;
  if (/^[a-z0-9_]+\.[a-z0-9_]+$/.test(String(rawAction.action || ''))) {
    candidate = String(rawAction.action).toLowerCase().replace(/[^a-z0-9._]+/g, '_').replace(/\.+/g, '.');
  }
  let deduped = candidate;
  let index = 2;
  while (seen.has(deduped)) deduped = `${candidate}_${index++}`;
  seen.add(deduped);
  return deduped;
}

function mapControlType(field, nodeType) {
  return field.controlType || (nodeType === 'select' ? 'select'
    : nodeType === 'textarea' ? 'textarea'
      : nodeType === 'email' ? 'email'
        : nodeType === 'password' ? 'password'
          : nodeType === 'search' ? 'search'
            : nodeType === 'number' ? 'number'
              : nodeType === 'date' ? 'date'
                : nodeType === 'url' ? 'url'
                  : nodeType === 'checkbox' ? 'checkbox'
                    : nodeType === 'radio-group' ? 'radio-group'
                      : nodeType === 'radio' ? 'radio'
                        : 'text');
}

function buildInferencePrompt(snapshot) {
  return `You classify web pages and infer agent-safe actions from structured accessibility and DOM data.
Return EXACTLY one JSON object. Do not include markdown. Do not invent controls or element IDs.

Goals:
1. Classify the site and page.
2. Infer likely user-meaningful actions on this page.
3. Detect repeated collections and infer shared item-level action templates once per collection.
4. Use contextual semantic action IDs with dot notation.
5. Include only actions grounded in the supplied interactives and forms.
6. Prefer one semantic action per form or region, not one action per field.
7. For repeated product/list/card/table structures, prefer collection-level templates instead of duplicating one action per repeated item.
8. Include plausible low-confidence actions when they are grounded in visible controls, but mark them with lower confidence and supported=false instead of omitting them.

Output JSON shape:
{
  "siteType": "string",
  "pageType": "string",
  "summary": "string",
  "confidence": 0.0,
  "actions": [
    {
      "action": "search.submit",
      "title": "Search",
      "description": "optional",
      "kind": "action",
      "intent": "search",
      "targetIds": ["ext_2"],
      "fields": [
        {
          "field": "query",
          "elementId": "ext_1",
          "required": true,
          "schemaType": "string",
          "enumValues": [],
          "label": "Search",
          "controlType": "search"
        }
      ],
      "risk": "low",
      "confirmation": "optional",
      "idempotent": true,
      "confidence": 0.92,
      "expectedEffect": "submit",
      "supported": true,
      "unsupportedReason": "only include when supported is false",
      "evidence": [{"kind":"role","value":"button"}]
    }
  ],
  "collections": [
    {
      "collectionId": "ext_10",
      "title": "Product listing",
      "description": "optional",
      "itemKeyFields": ["product_name"],
      "confidence": 0.88,
      "actionTemplates": [
        {
          "action": "cart.add_item",
          "title": "Add item to cart",
          "description": "optional",
          "intent": "create",
          "targetRole": "button",
          "targetName": "Add to cart",
          "confidence": 0.9,
          "supported": true,
          "unsupportedReason": "only include when supported is false"
        }
      ]
    }
  ]
}

Rules:
- Use ONLY supplied element IDs from interactives/forms.
- Do not invent actions, but do include plausible low-confidence actions when grounded in visible controls.
- For low-confidence or weakly grounded actions, set supported to false and provide unsupportedReason instead of omitting them.
- Use dot-separated semantic action names.
- Do not reference selectors, XPath, CSS, or DOM paths.
- Use contextual names based on page type and intent.
- Mark destructive, payment, or irreversible actions as unsupported.
- Use only these evidence kinds when possible: role, name, label, heading, landmark, url, text.
- Do not emit generic brochure-site navigation links like "link" or "learn more" unless they are clearly primary CTAs or workflow entry points.
- Only emit collections for repeated structures present in collectionCandidates.
- Prefer collection templates for repeated item-local actions instead of one duplicated action per item.
- Collection action templates must describe an action that is available on most or all items in the collection.

Snapshot:
${JSON.stringify(snapshot, null, 2)}`;
}

function resolveTargetIds(action, snapshot) {
  const currentTargets = (action.targetIds || [])
    .map((id) => snapshot.interactives.find((node) => node.elementId === id))
    .filter(Boolean);
  const currentLooksExecutable = currentTargets.some((node) =>
    (node.role === 'button' || node.role === 'link') && Boolean(node.name || node.text));
  if (currentLooksExecutable) return action.targetIds || [];
  if (!['search', 'submit', 'authenticate', 'create', 'update', 'filter'].includes(action.intent || '')) return action.targetIds || [];

  const fieldNodes = (action.fields || [])
    .map((field) => snapshot.interactives.find((node) => node.elementId === field.elementId))
    .filter(Boolean);
  const formIds = [...new Set(fieldNodes.map((node) => node.formId).filter(Boolean))];
  if (formIds.length !== 1) return action.targetIds || [];
  const form = snapshot.forms.find((item) => item.formId === formIds[0]);
  if (!form || form.submitIds.length !== 1) return action.targetIds || [];
  return [form.submitIds[0]];
}

function applyInferenceRiskRules(action, snapshot) {
  const seedReason = sanitizeUnsupportedReason(action.unsupportedReason);
  const targetNodes = (action.targetIds || [])
    .map((id) => snapshot.interactives.find((node) => node.elementId === id))
    .filter(Boolean);
  const targetText = [
    action.title,
    action.description,
    ...(action.evidence || []).map((item) => item.value),
    ...targetNodes.flatMap((node) => [node?.name, node?.text, node?.href]),
  ].filter(Boolean).join(' ');

  const next = {
    ...action,
    ...(seedReason ? { unsupportedReason: seedReason } : {}),
    ...(action.supported ? {} : { supported: false }),
  };

  if (HIGH_RISK_PATTERN.test(targetText)) {
    next.risk = 'high';
    next.confirmation = 'required';
    next.supported = false;
    next.unsupportedReason = next.unsupportedReason || 'High-risk inferred actions are blocked';
  }
  if ((next.confidence || 0) < 0.7) {
    next.supported = false;
    next.unsupportedReason = next.unsupportedReason || 'Low-confidence inferred action';
  }
  const primary = targetNodes[0];
  if (!primary?.name && !primary?.text) {
    next.supported = false;
    next.unsupportedReason = next.unsupportedReason || 'Primary target lacks an accessible name';
  }
  if (targetNodes.length !== (next.targetIds || []).length) {
    next.supported = false;
    next.unsupportedReason = next.unsupportedReason || 'Action references unknown elements';
  }
  for (const field of next.fields || []) {
    if (field.controlType && !SUPPORTED_CONTROL_TYPES.has(field.controlType)) {
      next.supported = false;
      next.unsupportedReason = next.unsupportedReason || `Unsupported control type "${field.controlType}"`;
    }
    if (!snapshot.interactives.some((node) => node.elementId === field.elementId)) {
      next.supported = false;
      next.unsupportedReason = next.unsupportedReason || 'Field references unknown element';
    }
  }
  if (['search', 'submit', 'authenticate', 'create', 'update', 'filter'].includes(next.intent || '')
    && (next.targetIds || []).length !== 1) {
    next.supported = false;
    next.unsupportedReason = next.unsupportedReason || 'Form actions require exactly one submit target';
  }
  if (next.intent === 'toggle') {
    const toggleRole = primary?.role || primary?.type;
    if (!toggleRole || !['checkbox', 'radio', 'switch'].includes(toggleRole)) {
      next.supported = false;
      next.unsupportedReason = next.unsupportedReason || 'Toggle actions require checkbox, radio, or switch targets';
    }
  }
  return next;
}

function isLowValueNavigationAction(action, snapshot) {
  if (!(action.intent === 'navigate' || action.intent === 'open')) return false;
  if ((action.fields || []).length > 0) return false;
  if ((action.targetIds || []).length !== 1) return false;
  const primary = snapshot.interactives.find((node) => node.elementId === action.targetIds[0]);
  if (!primary || primary.role !== 'link') return false;
  const title = normalizeText(action.title);
  const description = normalizeText(action.description);
  const targetName = normalizeText(primary.name || primary.text);
  const genericPattern = /^(link|open link|navigation link|go to link|learn more|read more|more|details?|view)$/i;
  const hasGenericLabel = genericPattern.test(title)
    || genericPattern.test(description)
    || genericPattern.test(targetName)
    || /\.link(?:_\d+)?$/.test(action.action || '');
  if (!hasGenericLabel) return false;
  const meaningfulCuePattern = /\b(apply|admissions?|curriculum|faculty|tuition|request|download|contact|sign in|log in|get started|start application|register|browse)\b/i;
  const evidenceText = [action.title, action.description, primary.name, primary.text, ...(action.evidence || []).map((item) => item.value)]
    .filter(Boolean)
    .join(' ');
  return !meaningfulCuePattern.test(evidenceText);
}

function scoreGroundedInteractive(node, roleNeedle, nameNeedle) {
  const nodeRole = normalizeText(node.role);
  const nodeName = normalizeText(node.name || node.text);
  const tagName = normalizeText(node.tagName);
  let score = 0;
  if (roleNeedle) {
    if (nodeRole === roleNeedle) score += 5;
    else if (roleNeedle === 'button' && (nodeRole === 'link' || tagName === 'a')) score += 2;
  }
  if (nameNeedle) {
    if (nodeName === nameNeedle) score += 6;
    else if (nodeName.includes(nameNeedle)) score += 4;
    else if (nameNeedle.includes(nodeName) && nodeName) score += 2;
  }
  if (node.receivesPointerEvents !== false) score += 2;
  if (node.pointerCursor) score += 1;
  if (node.box && node.box.width > 0 && node.box.height > 0) score += 1;
  if (tagName === 'button') score += 1;
  return score;
}

function resolveGroundedCollectionTargets(targetRole, targetName, candidate) {
  const roleNeedle = normalizeText(targetRole);
  const nameNeedle = normalizeText(targetName);
  const byItem = {};
  let representative;
  for (const item of candidate.items) {
    const ranked = item.interactives
      .map((node) => ({ node, score: scoreGroundedInteractive(node, roleNeedle, nameNeedle) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);
    const best = ranked[0]?.node;
    if (!best) continue;
    byItem[item.itemId] = best.selector;
    if (!representative) representative = { selector: best.selector, elementId: best.elementId, role: best.role, name: best.name || best.text };
  }
  return { representative, byItem };
}

function inferItemReferenceField(rawCollection, candidate) {
  const explicit = (rawCollection.itemKeyFields || []).find((field) => field && field !== 'price');
  if (explicit) return explicit;
  const firstItem = candidate.items[0];
  if (firstItem?.title) return 'item_name';
  return 'item_ref';
}

function normalizeCollectionActionName(rawAction, title, pageType, seen) {
  return normalizeActionName({
    action: rawAction,
    title,
    description: title,
    intent: normalizeIntent(rawAction.split('.').includes('open') ? 'open' : 'create'),
  }, pageType, seen);
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
  const normalizedParsed = {
    siteType: typeof parsed.siteType === 'string' ? parsed.siteType : 'unknown',
    pageType: typeof parsed.pageType === 'string' ? parsed.pageType : 'unknown',
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
    actions: parsed.actions
      .filter((action) => action && typeof action === 'object')
      .map((action) => ({
        ...action,
        action: typeof action.action === 'string' ? action.action : 'page.act',
        title: typeof action.title === 'string' ? action.title : 'Unnamed action',
        intent: normalizeIntent(action.intent),
        targetIds: Array.isArray(action.targetIds) ? action.targetIds.filter((id) => typeof id === 'string') : [],
        fields: Array.isArray(action.fields) ? action.fields.filter((field) => field && typeof field.field === 'string' && typeof field.elementId === 'string') : [],
        risk: action.risk === 'high' || action.risk === 'none' ? action.risk : 'low',
        confirmation: action.confirmation === 'never' || action.confirmation === 'review' || action.confirmation === 'required' ? action.confirmation : 'optional',
        idempotent: Boolean(action.idempotent),
        confidence: typeof action.confidence === 'number' ? action.confidence : 0,
        supported: action.supported !== false,
        unsupportedReason: typeof action.unsupportedReason === 'string' ? sanitizeUnsupportedReason(action.unsupportedReason) : undefined,
        evidence: Array.isArray(action.evidence) ? action.evidence.filter((item) => item && typeof item.kind === 'string' && typeof item.value === 'string') : [],
      })),
    collections: Array.isArray(parsed.collections)
      ? parsed.collections.filter((collection) => collection && typeof collection.collectionId === 'string')
      : [],
  };

  const seen = new Set();
  const actions = [];
  const collections = [];

  for (const action of normalizedParsed.actions) {
    const normalizedAction = applyInferenceRiskRules({
      ...action,
      targetIds: resolveTargetIds(action, snapshot),
    }, snapshot);
    if (isLowValueNavigationAction(normalizedAction, snapshot)) continue;

    const actionName = normalizeActionName(normalizedAction, normalizedParsed.pageType, seen);
    const targetSelectors = (normalizedAction.targetIds || [])
      .map((id) => snapshot.interactives.find((interactive) => interactive.elementId === id)?.selector)
      .filter(Boolean);
    const fields = (normalizedAction.fields || []).map((field) => {
      const node = snapshot.interactives.find((interactive) => interactive.elementId === field.elementId);
      const enumValues = field.enumValues?.length ? field.enumValues : node?.options;
      return {
        field: field.field || field.elementId || 'field',
        elementId: field.elementId,
        selector: node?.selector,
        label: field.label || node?.name || '',
        controlType: mapControlType(field, node?.type),
        required: Boolean(field.required),
        options: node?.options,
        enumValues,
        optionSelectors: node?.optionSelectors,
      };
    });

    actions.push({
      action: actionName,
      title: normalizedAction.title,
      description: normalizedAction.description || '',
      supported: normalizedAction.supported,
      unsupportedReason: normalizedAction.unsupportedReason,
      confidence: normalizedAction.confidence,
      source: 'llm',
      risk: normalizedAction.risk,
      confirmation: normalizedAction.confirmation,
      intent: normalizedAction.intent,
      targetElementId: normalizedAction.targetIds[0],
      targetSelectors,
      submitSelector: targetSelectors[0],
      fields,
    });
  }

  for (const rawCollection of normalizedParsed.collections) {
    const candidate = (snapshot.collectionCandidates || []).find((item) => item.collectionId === rawCollection.collectionId);
    if (!candidate || candidate.itemCount < 2) continue;

    const itemRefField = inferItemReferenceField(rawCollection, candidate);
    const collectionTemplates = [];
    for (const template of rawCollection.actionTemplates || []) {
      const actionName = normalizeActionName({
        action: template.action,
        title: template.title || rawCollection.title || candidate.label || 'Collection action',
        description: template.description || '',
        intent: normalizeIntent(template.intent),
      }, normalizedParsed.pageType, seen);
      const groundedTargets = resolveGroundedCollectionTargets(template.targetRole, template.targetName, candidate);
      const representative = groundedTargets.representative;
      const supportRatio = candidate.items.length > 0 ? Object.keys(groundedTargets.byItem).length / candidate.items.length : 0;
      const supported = template.supported !== false && Boolean(representative) && supportRatio >= 0.5;
      const unsupportedReason = !representative || supportRatio < 0.5
        ? sanitizeUnsupportedReason(template.unsupportedReason) || 'Collection action could not be grounded within repeated items'
        : sanitizeUnsupportedReason(template.unsupportedReason);

      actions.push({
        action: actionName,
        title: template.title || rawCollection.title || actionName,
        description: template.description || '',
        supported,
        unsupportedReason,
        confidence: typeof template.confidence === 'number' ? template.confidence : rawCollection.confidence,
        source: 'llm',
        risk: 'low',
        confirmation: 'optional',
        intent: normalizeIntent(template.intent),
        targetElementId: representative?.elementId,
        targetSelectors: representative?.selector ? [representative.selector] : [],
        submitSelector: representative?.selector,
        fields: [{
          field: itemRefField,
          elementId: candidate.containerId,
          selector: candidate.selector,
          label: 'Item reference',
          controlType: 'text',
          required: true,
        }],
        collectionScope: {
          collectionId: candidate.collectionId,
          collectionSelector: candidate.selector,
          itemRefField,
          itemSelectorById: Object.fromEntries(candidate.items.map((item) => [item.itemId, item.selector])),
          groundedTargetSelectorByItem: groundedTargets.byItem,
          itemSummaries: candidate.items.map((item) => ({
            itemId: item.itemId,
            title: item.title || item.keyTexts[0] || item.summary,
            summary: item.summary,
            keyTexts: item.keyTexts,
          })),
          targetRole: template.targetRole,
          targetName: template.targetName,
        },
      });

      collectionTemplates.push({
        action: actionName,
        title: template.title || rawCollection.title || actionName,
        supported,
        confidence: typeof template.confidence === 'number' ? template.confidence : rawCollection.confidence,
        unsupportedReason,
      });
    }

    collections.push({
      collectionId: rawCollection.collectionId,
      title: rawCollection.title || candidate.label || 'Collection',
      confidence: rawCollection.confidence || 0,
      itemKeyFields: rawCollection.itemKeyFields?.length ? rawCollection.itemKeyFields : [itemRefField],
      items: candidate.items.map((item) => ({
        itemId: item.itemId,
        title: item.title,
        summary: item.summary,
      })),
      actionTemplates: collectionTemplates,
    });
  }

  return {
    url: snapshot.url,
    title: snapshot.title,
    discoveryMode: 'llm',
    pageContext: {
      siteType: normalizedParsed.siteType,
      pageType: normalizedParsed.pageType,
      summary: normalizedParsed.summary || snapshot.pageTextSummary || '',
      confidence: normalizedParsed.confidence,
    },
    actions,
    collections,
    snapshot,
  };
}

function buildPlannerPrompt(command, catalog) {
  return `Map a user command to one discovered page action.
Return EXACTLY one JSON object:
{
  "action": "search.submit",
  "args": {
    "query": "manchego cheese"
  }
}

Rules:
- Choose exactly one action from the provided catalog.
- Use only field names that belong to the chosen action.
- Prefer exact visible option values for select and radio-group fields when they are provided.
- Prefer supported actions over unsupported ones unless the unsupported action is clearly the only semantic match.
- If no good action exists, return:
  {
    "action": "none",
    "args": {}
  }

User command:
${JSON.stringify(command)}

Catalog:
${JSON.stringify({
  actions: (catalog?.actions || []).map((action) => ({
    action: action.action,
    title: action.title,
    description: action.description,
      supported: action.supported !== false,
      intent: action.intent,
      risk: action.risk,
      confirmation: action.confirmation,
      unsupportedReason: action.unsupportedReason,
      fields: (action.fields || []).map((field) => ({
        field: field.field,
        label: field.label,
        controlType: field.controlType,
        required: field.required,
        enumValues: field.enumValues || field.options || [],
      })),
      collectionScope: action.collectionScope
        ? {
          collectionId: action.collectionScope.collectionId,
          itemRefField: action.collectionScope.itemRefField,
          itemTitles: (action.collectionScope.itemSummaries || []).map((item) => item.title),
        }
        : undefined,
    })),
  }, null, 2)}`;
}

async function planCommand(command, catalog, settings) {
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
  const parsed = JSON.parse(content);
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
    const result = await sendMessage(tab.id, {
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
