import type { ActionCatalog, DiscoveredAction, DiscoveredField } from '@agent-accessibility-framework/runtime-core';
import type { LlmBackend } from '@agent-accessibility-framework/planner-local';
import { buildInferenceSystemPrompt, type DiscoverySnapshot, type RawInferenceResult, type RawInferredAction } from './inference-prompt.js';
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
  };
}

export interface InferredDiscoveryResult {
  catalog: ActionCatalog;
  resolvedActions: Map<string, ResolvedInferredAction>;
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

  const actions: DiscoveredAction[] = parsed.actions.map((action) => {
    const normalized = applyInferenceRiskRules({
      ...action,
      intent: normalizeIntent(action.intent),
      targetIds: resolveTargetIds({
        ...action,
        intent: normalizeIntent(action.intent),
      }, snapshot),
    }, snapshot);
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

      return {
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
    };
  });

  return {
    catalog: {
      actions,
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
