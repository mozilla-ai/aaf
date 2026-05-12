import { DEFAULT_ELEMENT_ATTR_NAME, type BrowserAction, type BrowserExecutionResult } from './types.js';

function textOf(el: Element | null | undefined): string {
  if (!el || !el.textContent) return '';
  return el.textContent.replace(/\s+/g, ' ').trim().slice(0, 160);
}

function resolveFirstElement(document: Document, selectors: string[] | undefined): Element | null {
  for (const selector of selectors || []) {
    if (!selector) continue;
    const el = document.querySelector(selector);
    if (el) return el;
  }
  return null;
}

function normalize(value: unknown): string {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function resolveOptionSelector(optionSelectors: Record<string, string> | undefined, rawValue: unknown): { label: string; selector: string } | null {
  if (!optionSelectors) return null;
  const entries = Object.entries(optionSelectors);
  const needle = normalize(typeof rawValue === 'string' ? rawValue : String(rawValue ?? ''));
  if (!needle) return null;

  const exact = entries.find(([label]) => normalize(label) === needle);
  if (exact) return { label: exact[0], selector: exact[1] };

  const partialMatches = entries.filter(([label]) =>
    normalize(label).includes(needle) || needle.includes(normalize(label)));
  if (partialMatches.length === 1) {
    return { label: partialMatches[0][0], selector: partialMatches[0][1] };
  }
  return null;
}

function findCollectionItem(scope: NonNullable<BrowserAction['collectionScope']>, rawValue: unknown) {
  const needle = normalize(rawValue);
  if (!needle) return null;
  const exact = scope.itemSummaries.find((item) =>
    [item.title, item.summary, ...(item.keyTexts || [])].some((value) => normalize(value) === needle));
  if (exact) return exact;
  const partialMatches = scope.itemSummaries.filter((item) =>
    [item.title, item.summary, ...(item.keyTexts || [])].some((value) => normalize(value).includes(needle)));
  return partialMatches.length === 1 ? partialMatches[0] : null;
}

function canPartiallyExecute(action: BrowserAction): boolean {
  return action.supported === false
    && !action.collectionScope
    && action.risk !== 'high'
    && Array.isArray(action.fields)
    && action.fields.length > 0;
}

function dispatchTextInput(el: Element, value: string) {
  const input = el as HTMLInputElement | HTMLTextAreaElement;
  const setter = el instanceof HTMLInputElement
    ? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    : el instanceof HTMLTextAreaElement
      ? Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      : undefined;
  if (setter && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
    setter.call(input, value);
  } else if ('value' in input) {
    input.value = value;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function setCheckboxLike(el: Element, desired: boolean) {
  const input = el as HTMLInputElement;
  if (typeof input.checked === 'boolean') {
    input.checked = desired;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  if (desired && el instanceof HTMLElement) el.click();
}

function resolveElementById(document: Document, elementId: string | undefined, elementAttribute: string | undefined): Element | null {
  if (!elementId) return null;
  const attr = elementAttribute || DEFAULT_ELEMENT_ATTR_NAME;
  return document.querySelector(`[${attr}="${elementId.replace(/["\\\]]/g, '\\$&')}"]`);
}

export function executeGroundedAction(
  document: Document,
  action: BrowserAction,
  args: Record<string, unknown>,
): BrowserExecutionResult {
  const partialMode = canPartiallyExecute(action);
  if (action.supported === false && !partialMode) {
    return { status: 'execution_error', error: action.unsupportedReason || 'Inferred action is not supported' };
  }

  const executionDetails: string[] = [];
  let target = resolveFirstElement(document, action.targetSelectors) || resolveElementById(document, action.targetElementId, action.elementAttribute);
  if (action.collectionScope) {
    const itemRef = args[action.collectionScope.itemRefField];
    const match = findCollectionItem(action.collectionScope, itemRef);
    if (!match) {
      return { status: 'validation_error', error: `Could not uniquely resolve item reference for "${action.action}".` };
    }
    const selector = action.collectionScope.groundedTargetSelectorByItem?.[match.itemId];
    if (!selector) {
      return { status: 'execution_error', error: `Could not locate scoped collection target for "${action.action}".` };
    }
    target = document.querySelector(selector);
    executionDetails.push(`resolved ${action.collectionScope.itemRefField} -> ${JSON.stringify(match.title)}`);
  }

  for (const field of action.fields || []) {
    if (action.collectionScope && field.field === action.collectionScope.itemRefField) continue;
    const value = args[field.field];
    if (value === undefined) continue;
    const el = resolveFirstElement(document, field.selector ? [field.selector] : undefined)
      || resolveElementById(document, field.elementId, action.elementAttribute);
    if (!el) {
      return { status: 'execution_error', error: `Field "${field.field}" is no longer available on the page.` };
    }

    if (field.controlType === 'select') {
      const desired = String(value).trim();
      if (!(el instanceof HTMLSelectElement)) {
        return { status: 'execution_error', error: `Field "${field.field}" is not a selectable control.` };
      }
      const exact = Array.from(el.options).find((option) =>
        option.value === desired || option.textContent?.trim() === desired);
      const fuzzy = exact || Array.from(el.options).find((option) => {
        const optionValue = normalize(option.value);
        const optionLabel = normalize(option.textContent || '');
        const needle = normalize(desired);
        return optionValue === needle || optionLabel === needle || optionValue.includes(needle) || optionLabel.includes(needle);
      });
      el.value = fuzzy?.value || desired;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      executionDetails.push(`filled ${field.field} -> ${JSON.stringify(fuzzy?.textContent?.trim() || desired)}`);
    } else if (field.controlType === 'radio-group') {
      const match = resolveOptionSelector(field.optionSelectors, value);
      if (!match) {
        return { status: 'validation_error', error: `Could not resolve option ${JSON.stringify(String(value))} for "${field.field}".` };
      }
      const optionEl = document.querySelector(match.selector);
      if (!(optionEl instanceof HTMLElement)) {
        return { status: 'execution_error', error: `Radio option target for "${field.field}" is no longer available.` };
      }
      if (typeof (optionEl as HTMLInputElement).checked === 'boolean') {
        (optionEl as HTMLInputElement).checked = true;
        optionEl.dispatchEvent(new Event('input', { bubbles: true }));
        optionEl.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        optionEl.click();
      }
      executionDetails.push(`selected ${field.field} -> ${JSON.stringify(match.label)}`);
    } else if (field.controlType === 'checkbox' || field.controlType === 'radio') {
      setCheckboxLike(el, typeof value === 'boolean' ? value : String(value).toLowerCase() !== 'false');
      executionDetails.push(`set ${field.field}`);
    } else {
      dispatchTextInput(el, String(value));
      executionDetails.push(`filled ${field.field} -> ${JSON.stringify(String(value))}`);
    }
  }

  if (action.intent === 'toggle' && (!action.fields || action.fields.length === 0) && target instanceof HTMLElement) {
    if (typeof (target as HTMLInputElement).checked === 'boolean') {
      setCheckboxLike(target, !(target as HTMLInputElement).checked);
    } else {
      target.click();
    }
    executionDetails.push(`toggled target -> ${textOf(target) || action.action}`);
    return { status: 'completed', executionDetails };
  }

  if (target instanceof HTMLElement) {
    target.click();
    executionDetails.push(`clicked target -> ${textOf(target) || action.action}`);
    return { status: 'completed', executionDetails };
  }

  const firstField = action.fields?.[0]
    ? resolveFirstElement(document, action.fields[0].selector ? [action.fields[0].selector] : undefined)
      || resolveElementById(document, action.fields[0].elementId, action.elementAttribute)
    : null;
  if (partialMode && firstField instanceof HTMLElement && action.intent === 'search') {
    firstField.focus?.();
    firstField.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    firstField.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));
    firstField.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
    executionDetails.push('pressed Enter fallback on primary field');
    return { status: 'completed', executionDetails };
  }

  if (partialMode) {
    return {
      status: 'awaiting_review',
      executionDetails: [...executionDetails, 'submit target unresolved; fields filled for manual review'],
    };
  }

  return {
    status: 'awaiting_review',
    executionDetails: [...executionDetails, 'submit target unresolved; fields filled for manual review'],
  };
}
