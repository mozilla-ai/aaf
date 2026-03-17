import type { Locator, Page } from '@playwright/test';
import type { ExecutionResult } from '@agent-accessibility-framework/runtime-core';

export interface ResolvedInferredField {
  field: string;
  selector: string;
  controlType: string;
  enumValues?: string[];
  required?: boolean;
}

export interface ResolvedInferredAction {
  action: string;
  title?: string;
  targetSelectors: string[];
  submitSelector?: string;
  fields: ResolvedInferredField[];
  intent?: string;
  supported: boolean;
  unsupportedReason?: string;
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

export class InferredActionExecutor {
  async execute(
    page: Page,
    action: ResolvedInferredAction,
    args: Record<string, unknown>,
  ): Promise<ExecutionResult> {
    if (!action.supported) {
      return { status: 'execution_error', error: action.unsupportedReason || 'Inferred action is not supported' };
    }

    for (const field of action.fields) {
      const value = args[field.field];
      if (value === undefined) continue;
      const locator = page.locator(field.selector).first();
      if (field.controlType === 'select') {
        await locator.selectOption({ value: String(value) }).catch(async () => {
          await locator.selectOption({ label: String(value) });
        });
      } else if (field.controlType === 'checkbox' || field.controlType === 'radio') {
        const desired = typeof value === 'boolean' ? value : String(value).toLowerCase() !== 'false';
        if (desired) {
          await locator.check();
        } else {
          await locator.uncheck().catch(() => Promise.resolve());
        }
      } else {
        await locator.fill(String(value));
      }
    }

    if (action.intent === 'toggle' && action.fields.length === 0) {
      const locator = await firstLocator(page, action.targetSelectors);
      if (!locator) return { status: 'execution_error', error: `Target for "${action.action}" not found` };
      const checked = await locator.isChecked().catch(() => false);
      if (checked) {
        await locator.uncheck().catch(async () => {
          await locator.click();
        });
      } else {
        await locator.check().catch(async () => {
          await locator.click();
        });
      }
      return { status: 'completed', result: `toggled inferred action "${action.action}"` };
    }

    const clickSelector = action.submitSelector ?? action.targetSelectors[0];
    const locator = await firstLocator(page, clickSelector ? [clickSelector] : action.targetSelectors);
    if (!locator) return { status: 'execution_error', error: `Target for "${action.action}" not found` };

    const beforeUrl = page.url();
    await locator.click();
    await Promise.race([
      page.waitForLoadState('networkidle').catch(() => Promise.resolve()),
      page.waitForURL((url) => url.toString() !== beforeUrl).catch(() => Promise.resolve()),
      page.waitForTimeout(300),
    ]);

    return { status: 'completed', result: `submitted inferred action "${action.action}"` };
  }
}

