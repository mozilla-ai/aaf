import type {
  BrowserAction,
  BrowserActionCatalog,
  BrowserActionIntent,
  BrowserCollection,
  BrowserControlType,
  BrowserDiscoverySnapshot,
  BrowserRawInferenceResult,
} from './types.js';

const HIGH_RISK_PATTERN = /\b(delete|remove|destroy|logout|sign out|pay|purchase|buy now|place order|checkout|confirm transfer|close account|reset|revoke)\b/i;
const SUPPORTED_CONTROL_TYPES = new Set<BrowserControlType>(['text', 'email', 'password', 'search', 'number', 'date', 'url', 'textarea', 'select', 'checkbox', 'radio', 'radio-group']);
const PLACEHOLDER_UNSUPPORTED_REASONS = new Set(['optional', 'never', 'review', 'required', 'true', 'false', 'n/a', 'none']);

function slug(value: string | undefined): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

function normalizeText(value: string | undefined): string {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function sanitizeUnsupportedReason(reason: string | undefined): string | undefined {
  if (!reason) return undefined;
  const normalized = String(reason).trim();
  if (!normalized) return undefined;
  if (PLACEHOLDER_UNSUPPORTED_REASONS.has(normalized.toLowerCase())) return undefined;
  return normalized;
}

function normalizeIntent(intent: string | undefined): BrowserActionIntent {
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

function classifyPrefix(pageType: string | undefined, intent: string | undefined): string {
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

function verbForIntent(intent: string | undefined): string {
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

function normalizeActionName(rawAction: Pick<BrowserAction, 'action' | 'title' | 'description' | 'intent'>, pageType: string | undefined, seen: Set<string>): string {
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

function mapControlType(field: { controlType?: BrowserControlType }, nodeType?: string): BrowserControlType {
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

export function buildInferencePrompt(snapshot: BrowserDiscoverySnapshot): string {
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

function parseInference(rawOrParsed: string | BrowserRawInferenceResult): BrowserRawInferenceResult {
  const parsed = typeof rawOrParsed === 'string'
    ? JSON.parse(rawOrParsed) as BrowserRawInferenceResult
    : rawOrParsed;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.actions)) {
    throw new Error('Inference response is missing an actions array.');
  }
  return parsed;
}

function resolveTargetIds(action: BrowserRawInferenceResult['actions'][number], snapshot: BrowserDiscoverySnapshot): string[] {
  const currentTargets = (action.targetIds || [])
    .map((id) => snapshot.interactives.find((node) => node.elementId === id))
    .filter(Boolean);
  const currentLooksExecutable = currentTargets.some((node) =>
    (node?.role === 'button' || node?.role === 'link') && Boolean(node.name || node.text));
  if (currentLooksExecutable) return action.targetIds || [];
  if (!['search', 'submit', 'authenticate', 'create', 'update', 'filter'].includes(action.intent || '')) return action.targetIds || [];

  const fieldNodes = (action.fields || [])
    .map((field) => snapshot.interactives.find((node) => node.elementId === field.elementId))
    .filter(Boolean);
  const formIds = [...new Set(fieldNodes.map((node) => node?.formId).filter(Boolean))];
  if (formIds.length !== 1) return action.targetIds || [];
  const form = snapshot.forms.find((item) => item.formId === formIds[0]);
  if (!form || form.submitIds.length !== 1) return action.targetIds || [];
  return [form.submitIds[0]];
}

function applyInferenceRiskRules(action: BrowserAction & { evidence?: Array<{ kind: string; value: string }> }, snapshot: BrowserDiscoverySnapshot): BrowserAction {
  const seedReason = sanitizeUnsupportedReason(action.unsupportedReason);
  const targetNodes = (action.targetElementId ? [action.targetElementId] : [])
    .map((id) => snapshot.interactives.find((node) => node.elementId === id))
    .filter(Boolean);
  const targetText = [
    action.title,
    action.description,
    ...(action as { evidence?: Array<{ kind: string; value: string }> }).evidence?.map((item) => item.value) || [],
    ...targetNodes.flatMap((node) => [node?.name, node?.text, node?.href]),
  ].filter(Boolean).join(' ');

  const next: BrowserAction = {
    ...action,
    fields: action.fields || [],
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
  if (targetNodes.length !== (action.targetSelectors || []).length && (action.targetSelectors || []).length > 0) {
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
    && (action.targetSelectors || []).length !== 1) {
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

function isLowValueNavigationAction(action: BrowserAction & { evidence?: Array<{ kind: string; value: string }> }, snapshot: BrowserDiscoverySnapshot): boolean {
  if (!(action.intent === 'navigate' || action.intent === 'open')) return false;
  if ((action.fields || []).length > 0) return false;
  if ((action.targetSelectors || []).length !== 1 || !action.targetElementId) return false;
  const primary = snapshot.interactives.find((node) => node.elementId === action.targetElementId);
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

function scoreGroundedInteractive(
  node: NonNullable<BrowserDiscoverySnapshot['collectionCandidates']>[number]['items'][number]['interactives'][number],
  roleNeedle: string,
  nameNeedle: string,
): number {
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

function resolveGroundedCollectionTargets(
  targetRole: string | undefined,
  targetName: string | undefined,
  candidate: NonNullable<BrowserDiscoverySnapshot['collectionCandidates']>[number],
): {
  representative?: { selector: string; elementId: string; role?: string; name?: string };
  byItem: Record<string, string>;
} {
  const roleNeedle = normalizeText(targetRole);
  const nameNeedle = normalizeText(targetName);
  const byItem: Record<string, string> = {};
  let representative: { selector: string; elementId: string; role?: string; name?: string } | undefined;
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

function inferItemReferenceField(
  rawCollection: NonNullable<BrowserRawInferenceResult['collections']>[number],
  candidate: NonNullable<BrowserDiscoverySnapshot['collectionCandidates']>[number],
): string {
  const explicit = (rawCollection.itemKeyFields || []).find((field) => field && field !== 'price');
  if (explicit) return explicit;
  const firstItem = candidate.items[0];
  if (firstItem?.title) return 'item_name';
  return 'item_ref';
}

export function normalizeInferenceResult(
  rawOrParsed: string | BrowserRawInferenceResult,
  snapshot: BrowserDiscoverySnapshot,
): BrowserActionCatalog {
  const parsed = parseInference(rawOrParsed);
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

  const seen = new Set<string>();
  const actions: BrowserAction[] = [];
  const collections: BrowserCollection[] = [];

  for (const action of normalizedParsed.actions) {
    const targetIds = resolveTargetIds(action, snapshot);
    const targetSelectors = targetIds
      .map((id) => snapshot.interactives.find((interactive) => interactive.elementId === id)?.selector)
      .filter((value): value is string => Boolean(value));
    const normalizedAction = applyInferenceRiskRules({
      action: action.action,
      title: action.title,
      description: action.description || '',
      supported: action.supported,
      unsupportedReason: action.unsupportedReason,
      confidence: action.confidence,
      source: 'llm',
      risk: action.risk,
      confirmation: action.confirmation,
      intent: normalizeIntent(action.intent),
      targetElementId: targetIds[0],
      targetSelectors,
      submitSelector: targetSelectors[0],
      elementAttribute: snapshot.elementAttribute,
      fields: (action.fields || []).map((field) => {
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
      }),
      evidence: action.evidence,
    }, snapshot);
    if (isLowValueNavigationAction({ ...normalizedAction, evidence: action.evidence }, snapshot)) continue;

    actions.push({
      ...normalizedAction,
      action: normalizeActionName(normalizedAction, normalizedParsed.pageType, seen),
    });
  }

  for (const rawCollection of normalizedParsed.collections) {
    const candidate = (snapshot.collectionCandidates || []).find((item) => item.collectionId === rawCollection.collectionId);
    if (!candidate || candidate.itemCount < 2) continue;

    const itemRefField = inferItemReferenceField(rawCollection, candidate);
    const collectionTemplates: BrowserCollection['actionTemplates'] = [];
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
        elementAttribute: snapshot.elementAttribute,
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

export function buildPlannerPrompt(command: string, catalog: BrowserActionCatalog): string {
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
