import type { DiscoveredAction } from '@agent-accessibility-framework/runtime-core';
import type { DiscoverySnapshot, RawInferredAction } from './inference-prompt.js';

const HIGH_RISK_PATTERN = /\b(delete|remove|destroy|logout|sign out|pay|purchase|buy now|place order|checkout|confirm transfer|close account|reset|revoke)\b/i;
const SUPPORTED_CONTROL_TYPES = new Set(['text', 'email', 'password', 'search', 'number', 'date', 'textarea', 'select', 'checkbox', 'radio']);
const PLACEHOLDER_UNSUPPORTED_REASONS = new Set(['optional', 'never', 'review', 'required', 'true', 'false', 'n/a', 'none']);

export function sanitizeUnsupportedReason(reason: string | undefined): string | undefined {
  if (!reason) return undefined;
  const normalized = reason.trim();
  if (!normalized) return undefined;
  if (PLACEHOLDER_UNSUPPORTED_REASONS.has(normalized.toLowerCase())) return undefined;
  return normalized;
}

export function applyInferenceRiskRules(
  action: RawInferredAction,
  snapshot: DiscoverySnapshot,
): RawInferredAction {
  const seedReason = sanitizeUnsupportedReason(action.unsupportedReason);
  const targetNodes = action.targetIds
    .map((id) => snapshot.interactives.find((node) => node.elementId === id))
    .filter((node): node is DiscoverySnapshot['interactives'][number] => Boolean(node));
  const targetText = [
    action.title,
    action.description,
    ...(action.evidence || []).map((item) => item.value),
    ...targetNodes.flatMap((node) => [node?.name, node?.text, node?.href]),
  ].filter(Boolean).join(' ');

  const next: RawInferredAction = {
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

  if (next.confidence < 0.7) {
    next.supported = false;
    next.unsupportedReason = next.unsupportedReason || 'Low-confidence inferred action';
  }

  const primary = targetNodes[0];
  if (!primary?.name && !primary?.text) {
    next.supported = false;
    next.unsupportedReason = next.unsupportedReason || 'Primary target lacks an accessible name';
  }

  if (targetNodes.length !== next.targetIds.length) {
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

  if ((next.intent === 'search' || next.intent === 'submit' || next.intent === 'authenticate' || next.intent === 'create' || next.intent === 'update' || next.intent === 'filter')
    && next.targetIds.length !== 1) {
    next.supported = false;
    next.unsupportedReason = next.unsupportedReason || 'Form actions require exactly one submit target';
  }

  if (next.intent === 'toggle') {
    const toggleTarget = primary;
    const toggleRole = toggleTarget?.role || toggleTarget?.type;
    if (!toggleRole || !['checkbox', 'radio', 'switch'].includes(toggleRole)) {
      next.supported = false;
      next.unsupportedReason = next.unsupportedReason || 'Toggle actions require checkbox, radio, or switch targets';
    }
  }

  return next;
}

export function toEvidence(
  action: RawInferredAction,
): DiscoveredAction['evidence'] {
  return (action.evidence || [])
    .filter((entry): entry is { kind: 'role' | 'name' | 'label' | 'heading' | 'landmark' | 'url' | 'text'; value: string } =>
      ['role', 'name', 'label', 'heading', 'landmark', 'url', 'text'].includes(entry.kind) && Boolean(entry.value))
    .map((entry) => ({ kind: entry.kind, value: entry.value }));
}
