import type {
  ActionCatalog,
  DiscoveredAction,
  DiscoveredCollection,
  DiscoveredCollectionActionTemplate,
  DiscoveredCollectionItem,
  DiscoveredField,
} from '@agent-accessibility-framework/runtime-core';
import type { LlmBackend } from '@agent-accessibility-framework/planner-local';
import {
  buildInferenceSystemPrompt,
  type CollectionCandidate,
  type CollectionCandidateItem,
  type DiscoverySnapshot,
  type RawInferenceResult,
  type RawInferredAction,
} from './inference-prompt.js';
import { extractAccessibilitySummary } from './accessibility-extractor.js';
import { extractDomSnapshot } from './dom-affordance-extractor.js';
import { applyInferenceRiskRules, sanitizeUnsupportedReason, toEvidence } from './inference-risk.js';
import type { Page } from '@playwright/test';
import type { ResolvedInferredAction, ResolvedInferredField } from './inferred-action-executor.js';

function slug(value: string): string {
  return value.toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

function normalizeIntent(intent: string | undefined): NonNullable<DiscoveredAction['intent']> {
  const value = (intent || 'unknown').toLowerCase().replace(/[\s-]+/g, '_');
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

function classifyPrefix(pageType: string, intent: string | undefined): string {
  const page = pageType.toLowerCase();
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

function normalizeActionName(raw: RawInferredAction, pageType: string, seen: Set<string>): string {
  const prefix = slug(classifyPrefix(pageType, raw.intent || undefined)) || 'page';
  const verb = slug(verbForIntent(raw.intent || undefined)) || 'act';
  const objectHint = slug(raw.title || raw.description || raw.action.split('.').slice(-1)[0] || 'task') || 'task';
  let candidate = `${prefix}.${verb}_${objectHint}`;
  if (/^[a-z0-9_]+\.[a-z0-9_]+$/.test(raw.action)) {
    candidate = raw.action.toLowerCase().replace(/[^a-z0-9._]+/g, '_').replace(/\.+/g, '.');
  }
  let deduped = candidate;
  let index = 2;
  while (seen.has(deduped)) {
    deduped = `${candidate}_${index++}`;
  }
  seen.add(deduped);
  return deduped;
}

function mapControlType(field: RawInferredAction['fields'][number], nodeType?: string): DiscoveredField['controlType'] {
  return field.controlType || (nodeType === 'select' ? 'select'
    : nodeType === 'textarea' ? 'textarea'
    : nodeType === 'email' ? 'email'
    : nodeType === 'password' ? 'password'
    : nodeType === 'search' ? 'search'
    : nodeType === 'number' ? 'number'
    : nodeType === 'date' ? 'date'
    : nodeType === 'checkbox' ? 'checkbox'
    : nodeType === 'radio' ? 'radio'
    : 'text');
}

export function parseInference(raw: string): RawInferenceResult {
  const parsed = JSON.parse(raw) as RawInferenceResult;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.actions)) {
    throw new Error('Inference response is missing actions array');
  }
  return {
    ...parsed,
    siteType: typeof parsed.siteType === 'string' ? parsed.siteType : 'unknown',
    pageType: typeof parsed.pageType === 'string' ? parsed.pageType : 'unknown',
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
    actions: parsed.actions
      .filter((action): action is RawInferredAction => Boolean(action && typeof action === 'object'))
      .map((action) => ({
        ...action,
        action: typeof action.action === 'string' ? action.action : 'page.act',
        title: typeof action.title === 'string' ? action.title : 'Unnamed action',
        kind: 'action',
        intent: normalizeIntent(action.intent),
        targetIds: Array.isArray(action.targetIds) ? action.targetIds.filter((id): id is string => typeof id === 'string') : [],
        fields: Array.isArray(action.fields) ? action.fields.filter((field): field is RawInferredAction['fields'][number] => Boolean(field && typeof field === 'object' && typeof field.field === 'string' && typeof field.elementId === 'string')) : [],
        risk: action.risk === 'high' || action.risk === 'none' ? action.risk : 'low',
        confirmation: action.confirmation === 'never' || action.confirmation === 'review' || action.confirmation === 'required'
          ? action.confirmation
          : 'optional',
        idempotent: Boolean(action.idempotent),
        confidence: typeof action.confidence === 'number' ? action.confidence : 0,
        expectedEffect: action.expectedEffect === 'navigate' || action.expectedEffect === 'submit' || action.expectedEffect === 'mutate' || action.expectedEffect === 'toggle' || action.expectedEffect === 'open'
          ? action.expectedEffect
          : 'unknown',
        supported: action.supported !== false,
        unsupportedReason: typeof action.unsupportedReason === 'string' ? sanitizeUnsupportedReason(action.unsupportedReason) : undefined,
        evidence: Array.isArray(action.evidence) ? action.evidence.filter((item): item is { kind: string; value: string } => Boolean(item && typeof item.kind === 'string' && typeof item.value === 'string')) : [],
      })),
    collections: Array.isArray(parsed.collections)
      ? parsed.collections
        .filter((collection) => Boolean(collection && typeof collection === 'object' && typeof collection.collectionId === 'string'))
        .map((collection) => ({
          collectionId: collection.collectionId,
          title: typeof collection.title === 'string' ? collection.title : 'Collection',
          ...(typeof collection.description === 'string' ? { description: collection.description } : {}),
          itemKeyFields: Array.isArray(collection.itemKeyFields)
            ? collection.itemKeyFields.filter((field): field is string => typeof field === 'string')
            : [],
          confidence: typeof collection.confidence === 'number' ? collection.confidence : 0,
          actionTemplates: Array.isArray(collection.actionTemplates)
            ? collection.actionTemplates
              .filter((template) => Boolean(template && typeof template === 'object' && typeof template.action === 'string'))
              .map((template) => ({
                action: template.action,
                title: typeof template.title === 'string' ? template.title : 'Item action',
                ...(typeof template.description === 'string' ? { description: template.description } : {}),
                intent: normalizeIntent(template.intent),
                ...(typeof template.targetRole === 'string' ? { targetRole: template.targetRole } : {}),
                ...(typeof template.targetName === 'string' ? { targetName: template.targetName } : {}),
                ...(typeof template.confidence === 'number' ? { confidence: template.confidence } : {}),
                supported: template.supported !== false,
                ...(typeof template.unsupportedReason === 'string'
                  ? { unsupportedReason: sanitizeUnsupportedReason(template.unsupportedReason) }
                  : {}),
              }))
            : [],
        }))
      : [],
  };
}

export interface InferredDiscoveryResult {
  catalog: ActionCatalog;
  resolvedActions: Map<string, ResolvedInferredAction>;
}

function normalized(value: string | undefined): string {
  return (value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function scoreGroundedInteractive(
  node: CollectionCandidateItem['interactives'][number],
  roleNeedle: string,
  nameNeedle: string,
): number {
  const nodeRole = normalized(node.role);
  const nodeName = normalized(node.name || node.text);
  const tagName = normalized(node.tagName);
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
  candidate: CollectionCandidate,
): {
  representative?: { selector: string; role?: string; name?: string };
  byItem: Record<string, string>;
} {
  const roleNeedle = normalized(targetRole);
  const nameNeedle = normalized(targetName);
  const byItem: Record<string, string> = {};
  let representative: { selector: string; role?: string; name?: string } | undefined;

  for (const item of candidate.items) {
    const ranked = item.interactives
      .map((node) => ({ node, score: scoreGroundedInteractive(node, roleNeedle, nameNeedle) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);
    const best = ranked[0]?.node;
    if (!best) continue;
    byItem[item.itemId] = best.selector;
    if (!representative) {
      representative = { selector: best.selector, role: best.role, name: best.name || best.text };
    }
  }

  return { representative, byItem };
}

function isLowValueNavigationAction(
  action: RawInferredAction,
  snapshot: DiscoverySnapshot,
): boolean {
  if (!(action.intent === 'navigate' || action.intent === 'open')) return false;
  if ((action.fields || []).length > 0) return false;
  if (action.targetIds.length !== 1) return false;

  const primary = snapshot.interactives.find((node) => node.elementId === action.targetIds[0]);
  if (!primary || primary.role !== 'link') return false;

  const title = normalized(action.title);
  const description = normalized(action.description);
  const targetName = normalized(primary.name || primary.text);
  const genericPattern = /^(link|open link|navigation link|go to link|learn more|read more|more|details?|view)$/i;
  const hasGenericLabel = genericPattern.test(title)
    || genericPattern.test(description)
    || genericPattern.test(targetName)
    || /\.link(?:_\d+)?$/.test(action.action);

  if (!hasGenericLabel) return false;

  const meaningfulCuePattern = /\b(apply|admissions?|curriculum|faculty|tuition|request|download|contact|sign in|log in|get started|start application|register|browse)\b/i;
  const evidenceText = [
    action.title,
    action.description,
    primary.name,
    primary.text,
    ...(action.evidence || []).map((item) => item.value),
  ].filter(Boolean).join(' ');

  return !meaningfulCuePattern.test(evidenceText);
}

function resolveTargetIds(action: RawInferredAction, snapshot: DiscoverySnapshot): string[] {
  const currentTargets = action.targetIds
    .map((id) => snapshot.interactives.find((node) => node.elementId === id))
    .filter((node): node is DiscoverySnapshot['interactives'][number] => Boolean(node));

  const currentLooksExecutable = currentTargets.some((node) =>
    (node.role === 'button' || node.role === 'link') && Boolean(node.name || node.text));
  if (currentLooksExecutable) {
    return action.targetIds;
  }

  if (!['search', 'submit', 'authenticate', 'create', 'update', 'filter'].includes(action.intent || '')) {
    return action.targetIds;
  }

  const fieldNodes = (action.fields || [])
    .map((field) => snapshot.interactives.find((node) => node.elementId === field.elementId))
    .filter((node): node is DiscoverySnapshot['interactives'][number] => Boolean(node));
  const formIds = Array.from(new Set(fieldNodes.map((node) => node.formId).filter((value): value is string => Boolean(value))));
  if (formIds.length !== 1) {
    return action.targetIds;
  }

  const form = snapshot.forms.find((item) => item.formId === formIds[0]);
  if (!form || form.submitIds.length !== 1) {
    return action.targetIds;
  }

  return [form.submitIds[0]];
}

export function normalizeInferenceResult(
  parsed: RawInferenceResult,
  snapshot: DiscoverySnapshot,
): InferredDiscoveryResult {
  const seen = new Set<string>();
  const resolvedActions = new Map<string, ResolvedInferredAction>();
  const collectionsById = new Map((snapshot.collectionCandidates || []).map((candidate) => [candidate.collectionId, candidate]));
  const baseActions: DiscoveredAction[] = parsed.actions.flatMap((action) => {
    const normalized = applyInferenceRiskRules({
      ...action,
      intent: normalizeIntent(action.intent),
      targetIds: resolveTargetIds({
        ...action,
        intent: normalizeIntent(action.intent),
      }, snapshot),
    }, snapshot);
    if (isLowValueNavigationAction(normalized, snapshot)) {
      return [];
    }
    const actionName = normalizeActionName(normalized, parsed.pageType, seen);
    const targetSelectors = normalized.targetIds
      .map((id) => snapshot.interactives.find((node) => node.elementId === id)?.selector)
      .filter((selector): selector is string => Boolean(selector));

    const fields: DiscoveredField[] = (normalized.fields || []).map((field) => {
      const node = snapshot.interactives.find((interactive) => interactive.elementId === field.elementId);
      return {
        field: field.field,
        tagName: node?.type === 'select' ? 'select' : node?.type === 'textarea' ? 'textarea' : 'input',
        ...(field.enumValues?.length ? { enumValues: field.enumValues } : {}),
        ...(field.schemaType ? { schemaType: field.schemaType } : {}),
        ...(field.required !== undefined ? { required: field.required } : {}),
        ...(field.label ? { label: field.label } : {}),
        controlType: mapControlType(field, node?.type),
      };
    });

      const resolvedFields: ResolvedInferredField[] = (normalized.fields || []).map((field) => {
        const selector = snapshot.interactives.find((interactive) => interactive.elementId === field.elementId)?.selector || '';
        return {
          field: field.field,
          selector,
          controlType: mapControlType(field, snapshot.interactives.find((interactive) => interactive.elementId === field.elementId)?.type),
          ...(field.enumValues?.length ? { enumValues: field.enumValues } : {}),
          ...(field.required !== undefined ? { required: field.required } : {}),
          ...(field.label ? { label: field.label } : {}),
        };
      });

      resolvedActions.set(actionName, {
        action: actionName,
        title: normalized.title,
        targetSelectors,
        submitSelector: targetSelectors[0],
        fields: resolvedFields,
        intent: normalized.intent || 'unknown',
        risk: normalized.risk,
        supported: normalized.supported,
        ...(normalized.supported === false && normalized.unsupportedReason ? { unsupportedReason: normalized.unsupportedReason } : {}),
      });

      return [{
      action: actionName,
      kind: 'action',
      danger: normalized.risk,
      confirm: normalized.confirmation,
      fields,
      statuses: [],
      title: normalized.title,
      ...(normalized.description ? { description: normalized.description } : {}),
      source: 'inferred',
      risk: normalized.risk,
        confirmation: normalized.confirmation,
        intent: normalized.intent || 'unknown',
        confidence: normalized.confidence,
        supported: normalized.supported,
        ...(normalized.supported === false && normalized.unsupportedReason ? { unsupportedReason: normalized.unsupportedReason } : {}),
        siteType: parsed.siteType,
        pageType: parsed.pageType,
      evidence: toEvidence(normalized),
      idempotent: normalized.idempotent ? 'true' : 'false',
    }];
  });
  const collectionActions: DiscoveredAction[] = [];

  const collections: DiscoveredCollection[] = (parsed.collections || [])
    .map((collection) => normalizeCollection(
      collection,
      collectionsById.get(collection.collectionId),
      parsed.pageType,
      parsed.siteType,
      seen,
      resolvedActions,
      collectionActions,
    ))
    .filter((collection): collection is DiscoveredCollection => Boolean(collection));
  const actions = [...baseActions, ...collectionActions];

  return {
    catalog: {
      actions,
      ...(collections.length > 0 ? { collections } : {}),
      url: snapshot.url,
      timestamp: new Date().toISOString(),
      discoveryMode: 'inferred',
      pageContext: {
        siteType: parsed.siteType,
        pageType: parsed.pageType,
        summary: parsed.summary,
        confidence: parsed.confidence,
      },
    },
    resolvedActions,
  };
}

function normalizeCollection(
  raw: NonNullable<RawInferenceResult['collections']>[number],
  candidate: CollectionCandidate | undefined,
  pageType: string,
  siteType: string,
  seen: Set<string>,
  resolvedActions: Map<string, ResolvedInferredAction>,
  collectionActions: DiscoveredAction[],
): DiscoveredCollection | null {
  if (!candidate || candidate.itemCount < 2) return null;

  const items: DiscoveredCollectionItem[] = candidate.items.map((item) => {
    const itemName = item.title || item.keyTexts[0] || item.summary;
    const keyFields: Record<string, string> = {};
    if (itemName) keyFields.item_name = itemName;
    const priceText = item.keyTexts.find((text) => /\$\s?\d|\d+\s?(usd|eur|gbp)/i.test(text));
    if (priceText) keyFields.price = priceText;
    return {
      itemId: item.itemId,
      ...(item.title ? { title: item.title } : {}),
      summary: item.summary,
      ...(Object.keys(keyFields).length > 0 ? { keyFields } : {}),
    };
  });

  const templates: DiscoveredCollectionActionTemplate[] = [];
  for (const template of raw.actionTemplates) {
    const actionName = normalizeCollectionActionName(template.action, raw.title, pageType, seen);
    const groundedTargets = resolveGroundedCollectionTargets(template.targetRole, template.targetName, candidate);
    const representative = groundedTargets.representative;
    const supportRatio = candidate.items.length > 0 ? Object.keys(groundedTargets.byItem).length / candidate.items.length : 0;
    const supported = template.supported !== false && Boolean(representative) && supportRatio >= 0.5;
    const unsupportedReason = !representative || supportRatio < 0.5
      ? template.unsupportedReason || 'Collection action could not be grounded within repeated items'
      : template.unsupportedReason;
    const templateIntent = normalizeIntent(template.intent);
    const itemField = inferItemReferenceField(raw, candidate);
    const title = template.title;

    resolvedActions.set(actionName, {
      action: actionName,
      title,
      targetSelectors: representative ? [representative.selector] : [],
      submitSelector: representative?.selector,
      fields: [{
        field: itemField,
        selector: candidate.selector,
        controlType: 'text',
        required: true,
        label: 'Item reference',
      }],
      intent: templateIntent,
      risk: 'low',
      supported,
      ...(unsupportedReason ? { unsupportedReason } : {}),
      collectionScope: {
        collectionId: candidate.collectionId,
        collectionSelector: candidate.selector,
        itemSelectorById: Object.fromEntries(candidate.items.map((item) => [item.itemId, item.selector])),
        groundedTargetSelectorByItem: groundedTargets.byItem,
        itemSummaries: candidate.items.map((item) => ({
          itemId: item.itemId,
          title: item.title || item.keyTexts[0] || item.summary,
          summary: item.summary,
          keyTexts: item.keyTexts,
          interactiveIds: item.interactiveIds,
        })),
        itemRefField: itemField,
        targetRole: representative?.role || template.targetRole,
        ...(representative?.name ? { targetName: representative.name } : template.targetName ? { targetName: template.targetName } : {}),
      },
    });

    templates.push({
      action: actionName,
      title,
      ...(template.description ? { description: template.description } : {}),
      intent: templateIntent,
      ...(representative?.role ? { targetRole: representative.role } : template.targetRole ? { targetRole: template.targetRole } : {}),
      ...(representative?.name ? { targetName: representative.name } : template.targetName ? { targetName: template.targetName } : {}),
      ...(template.confidence !== undefined ? { confidence: template.confidence } : {}),
      supported,
      ...(unsupportedReason ? { unsupportedReason } : {}),
    });

    actionsFromTemplate(actionName, title, template, itemField, raw, pageType, siteType, collectionActions, supported, unsupportedReason);
  }

  return {
    collectionId: raw.collectionId,
    title: raw.title,
    ...(raw.description ? { description: raw.description } : {}),
    confidence: raw.confidence,
    itemKeyFields: raw.itemKeyFields.length > 0 ? raw.itemKeyFields : [inferItemReferenceField(raw, candidate)],
    items,
    actionTemplates: templates,
  };
}

function actionsFromTemplate(
  actionName: string,
  title: string,
  template: NonNullable<NonNullable<RawInferenceResult['collections']>[number]['actionTemplates']>[number],
  itemField: string,
  rawCollection: NonNullable<RawInferenceResult['collections']>[number],
  pageType: string,
  siteType: string,
  actionList: DiscoveredAction[],
  supported: boolean,
  unsupportedReason?: string,
): void {
  actionList.push({
    action: actionName,
    kind: 'action',
    danger: 'low',
    confirm: 'optional',
    fields: [{
      field: itemField,
      tagName: 'input',
      required: true,
      schemaType: 'string',
      label: 'Item reference',
      controlType: 'text',
    }],
    statuses: [],
    title,
    ...(template.description ? { description: template.description } : {}),
    source: 'inferred',
    risk: 'low',
    confirmation: 'optional',
    intent: normalizeIntent(template.intent),
    confidence: template.confidence ?? rawCollection.confidence,
    supported,
    ...(unsupportedReason ? { unsupportedReason } : template.unsupportedReason ? { unsupportedReason: template.unsupportedReason } : {}),
    siteType,
    pageType,
    evidence: [
      ...(rawCollection.title ? [{ kind: 'heading' as const, value: rawCollection.title }] : []),
      ...(template.targetName ? [{ kind: 'name' as const, value: template.targetName }] : []),
    ],
    idempotent: 'false',
  });
}

function inferItemReferenceField(
  raw: NonNullable<RawInferenceResult['collections']>[number],
  candidate: CollectionCandidate,
): string {
  const explicit = raw.itemKeyFields.find((field) => field && field !== 'price');
  if (explicit) return explicit;
  const firstItem = candidate.items[0];
  if (firstItem?.title) return 'item_name';
  return 'item_ref';
}

function normalizeCollectionActionName(rawAction: string, title: string, pageType: string, seen: Set<string>): string {
  const synthetic: RawInferredAction = {
    action: rawAction,
    title,
    kind: 'action',
    intent: 'unknown',
    targetIds: [],
    fields: [],
    risk: 'low',
    confirmation: 'optional',
    idempotent: false,
    confidence: 0.8,
    expectedEffect: 'mutate',
    supported: true,
    evidence: [],
  };
  return normalizeActionName(synthetic, pageType, seen);
}

export class InferredActionDiscoverer {
  constructor(
    private page: Page,
    private backend: LlmBackend,
    private maxInteractiveNodes = 150,
  ) {}

  async discover(): Promise<InferredDiscoveryResult> {
    const [domSnapshot, a11ySummary] = await Promise.all([
      extractDomSnapshot(this.page, this.maxInteractiveNodes),
      extractAccessibilitySummary(this.page),
    ]);

    const snapshot: DiscoverySnapshot = {
      ...domSnapshot,
      a11ySummary,
    };

    const raw = await this.backend.generate(
      'Infer the supported semantic actions for this page.',
      buildInferenceSystemPrompt(snapshot),
      { json: true },
    );
    const parsed = parseInference(raw);
    return normalizeInferenceResult(parsed, snapshot);
  }
}
