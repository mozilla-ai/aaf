import type { Locator, Page } from '@playwright/test';
import type { ExecutionResult } from '@agent-accessibility-framework/runtime-core';

export interface ResolvedInferredField {
  field: string;
  selector: string;
  controlType: string;
  enumValues?: string[];
  required?: boolean;
  label?: string;
}

export interface ResolvedInferredCollectionScope {
  collectionId: string;
  collectionSelector: string;
  itemSelectorById: Record<string, string>;
  groundedTargetSelectorByItem?: Record<string, string>;
  itemSummaries: Array<{
    itemId: string;
    title: string;
    summary: string;
    keyTexts: string[];
    interactiveIds: string[];
  }>;
  itemRefField: string;
  targetRole?: string;
  targetName?: string;
}

export interface ResolvedInferredAction {
  action: string;
  title?: string;
  targetSelectors: string[];
  submitSelector?: string;
  fields: ResolvedInferredField[];
  intent?: string;
  risk?: 'none' | 'low' | 'high';
  supported: boolean;
  unsupportedReason?: string;
  collectionScope?: ResolvedInferredCollectionScope;
}

async function firstLocator(page: Page, selectors: string[]): Promise<Locator | null> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count() > 0) {
      return locator;
    }
  }
  return null;
}

async function describeLocator(locator: Locator, fallback: string): Promise<string> {
  try {
    const description = await locator.evaluate((el) => {
      const text = el.textContent?.replace(/\s+/g, ' ').trim();
      const aria = el.getAttribute('aria-label');
      const role = el.getAttribute('role') || el.tagName.toLowerCase();
      const name = aria || text || (el instanceof HTMLInputElement ? el.placeholder || el.name || el.id : el.id || '');
      return name ? `${role} "${name}"` : role;
    });
    return description || fallback;
  } catch {
    return fallback;
  }
}

function normalize(value: string | undefined): string {
  return (value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function findCollectionItem(
  scope: ResolvedInferredCollectionScope,
  rawValue: unknown,
): ResolvedInferredCollectionScope['itemSummaries'][number] | null {
  const needle = normalize(typeof rawValue === 'string' ? rawValue : String(rawValue ?? ''));
  if (!needle) return null;

  const exact = scope.itemSummaries.find((item) =>
    [item.title, item.summary, ...item.keyTexts].some((value) => normalize(value) === needle));
  if (exact) return exact;

  const partialMatches = scope.itemSummaries.filter((item) =>
    [item.title, item.summary, ...item.keyTexts].some((value) => normalize(value).includes(needle)));
  if (partialMatches.length === 1) return partialMatches[0];
  return null;
}

export function canPartiallyExecute(action: ResolvedInferredAction): boolean {
  return action.supported === false
    && !action.collectionScope
    && action.risk !== 'high'
    && action.fields.length > 0;
}

export class InferredActionExecutor {
  async execute(
    page: Page,
    action: ResolvedInferredAction,
    args: Record<string, unknown>,
  ): Promise<ExecutionResult> {
    const partialMode = canPartiallyExecute(action);
    if (!action.supported && !partialMode) {
      return { status: 'execution_error', error: action.unsupportedReason || 'Inferred action is not supported' };
    }

    const executionDetails: string[] = [];
    let targetSelectors = action.targetSelectors;
    let submitSelector = action.submitSelector;

    if (action.collectionScope) {
      const itemRef = args[action.collectionScope.itemRefField];
      const match = findCollectionItem(action.collectionScope, itemRef);
      if (!match) {
        return {
          status: 'validation_error',
          error: `Could not uniquely resolve item reference for "${action.action}"`,
        };
      }
      const itemSelector = action.collectionScope.itemSelectorById[match.itemId];
      if (!itemSelector) {
        return {
          status: 'execution_error',
          error: `Resolved item target missing for "${action.action}"`,
        };
      }

      const scopedSelector = action.collectionScope.groundedTargetSelectorByItem?.[match.itemId];

      if (!scopedSelector) {
        return {
          status: 'execution_error',
          error: `Could not locate scoped collection target for "${action.action}"`,
        };
      }

      targetSelectors = [scopedSelector];
      submitSelector = scopedSelector;
      executionDetails.push(`resolved ${action.collectionScope.itemRefField} -> ${JSON.stringify(match.title)}`);
    }

    for (const field of action.fields) {
      if (action.collectionScope && field.field === action.collectionScope.itemRefField) continue;
      const value = args[field.field];
      if (value === undefined) continue;
      const locator = page.locator(field.selector).first();
      const label = field.label || await describeLocator(locator, field.selector);
      if (field.controlType === 'select') {
        await locator.selectOption({ value: String(value) }).catch(async () => {
          await locator.selectOption({ label: String(value) });
        });
        executionDetails.push(`filled ${field.field} -> ${label} with ${JSON.stringify(String(value))}`);
      } else if (field.controlType === 'checkbox' || field.controlType === 'radio') {
        const desired = typeof value === 'boolean' ? value : String(value).toLowerCase() !== 'false';
        if (desired) {
          await locator.check();
        } else {
          await locator.uncheck().catch(() => Promise.resolve());
        }
        executionDetails.push(`set ${field.field} -> ${label} to ${JSON.stringify(desired)}`);
      } else {
        await locator.fill(String(value));
        executionDetails.push(`filled ${field.field} -> ${label} with ${JSON.stringify(String(value))}`);
      }
    }

    if (partialMode && action.intent === 'search' && action.fields.length > 0) {
      const primaryField = action.fields[0];
      const locator = page.locator(primaryField.selector).first();
      const label = primaryField.label || await describeLocator(locator, primaryField.selector);
      await locator.press('Enter').catch(() => Promise.resolve());
      executionDetails.push(`pressed Enter on ${label}`);
      await Promise.race([
        page.waitForLoadState('networkidle').catch(() => Promise.resolve()),
        page.waitForTimeout(300),
      ]);
      return {
        status: 'completed',
        result: `submitted inferred action "${action.action}" via Enter fallback`,
        execution_details: executionDetails,
      };
    }

    if (partialMode) {
      executionDetails.push(`submit target unresolved; filled fields for manual review`);
      return {
        status: 'awaiting_review',
        result: `filled inferred action "${action.action}" for manual review`,
        execution_details: executionDetails,
      };
    }

    if (action.intent === 'toggle' && action.fields.length === 0) {
      const locator = await firstLocator(page, action.targetSelectors);
      if (!locator) return { status: 'execution_error', error: `Target for "${action.action}" not found` };
      const checked = await locator.isChecked().catch(() => false);
      const label = await describeLocator(locator, action.targetSelectors[0] || action.action);
      if (checked) {
        await locator.uncheck().catch(async () => {
          await locator.click();
        });
      } else {
        await locator.check().catch(async () => {
          await locator.click();
        });
      }
      executionDetails.push(`toggled target -> ${label}`);
      return { status: 'completed', result: `toggled inferred action "${action.action}"`, execution_details: executionDetails };
    }

    const clickSelector = submitSelector ?? targetSelectors[0];
    const locator = await firstLocator(page, clickSelector ? [clickSelector] : targetSelectors);
    if (!locator) return { status: 'execution_error', error: `Target for "${action.action}" not found` };
    const label = await describeLocator(locator, clickSelector || targetSelectors[0] || action.action);

    const beforeUrl = page.url();
    await locator.click();
    executionDetails.push(`clicked target -> ${label}`);
    await Promise.race([
      page.waitForLoadState('networkidle').catch(() => Promise.resolve()),
      page.waitForURL((url) => url.toString() !== beforeUrl).catch(() => Promise.resolve()),
      page.waitForTimeout(300),
    ]);

    return { status: 'completed', result: `submitted inferred action "${action.action}"`, execution_details: executionDetails };
  }
}
