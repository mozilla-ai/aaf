import { describe, expect, it, vi } from 'vitest';
import { InferredActionExecutor, canPartiallyExecute, type ResolvedInferredAction } from './inferred-action-executor.js';

describe('canPartiallyExecute', () => {
  it('allows low-risk unsupported actions with fields to proceed in partial mode', () => {
    const action: ResolvedInferredAction = {
      action: 'search.submit',
      fields: [{ field: 'query', selector: '#q', controlType: 'search' }],
      supported: false,
      unsupportedReason: 'Primary target lacks an accessible name',
      intent: 'search',
      risk: 'low',
      targetSelectors: [],
    };

    expect(canPartiallyExecute(action)).toBe(true);
  });

  it('blocks high-risk unsupported actions from partial mode', () => {
    const action: ResolvedInferredAction = {
      action: 'account.delete',
      fields: [{ field: 'confirm', selector: '#confirm', controlType: 'text' }],
      supported: false,
      unsupportedReason: 'High-risk inferred actions are blocked',
      intent: 'delete',
      risk: 'high',
      targetSelectors: [],
    };

    expect(canPartiallyExecute(action)).toBe(false);
  });
});

describe('InferredActionExecutor partial execution', () => {
  it('fills low-risk search fields and presses Enter when submit grounding is missing', async () => {
    const fill = vi.fn(async () => undefined);
    const press = vi.fn(async () => undefined);
    const count = vi.fn(async () => 1);
    const evaluate = vi.fn(async () => 'textbox "Search"');

    const locator = {
      first: () => locator,
      fill,
      press,
      count,
      evaluate,
    };

    const page = {
      locator: vi.fn(() => locator),
      waitForLoadState: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
    };

    const executor = new InferredActionExecutor();
    const action: ResolvedInferredAction = {
      action: 'search.submit',
      fields: [{ field: 'query', selector: '#q', controlType: 'search', label: 'Search' }],
      supported: false,
      unsupportedReason: 'Primary target lacks an accessible name',
      intent: 'search',
      risk: 'low',
      targetSelectors: [],
    };

    const result = await executor.execute(page as never, action, { query: 'manchego cheese' });

    expect(fill).toHaveBeenCalledWith('manchego cheese');
    expect(press).toHaveBeenCalledWith('Enter');
    expect(result.status).toBe('completed');
    expect(result.result).toContain('Enter fallback');
    expect(result.execution_details).toContain('filled query -> Search with "manchego cheese"');
    expect(result.execution_details).toContain('pressed Enter on Search');
  });

  it('fills low-risk unsupported fields and returns awaiting_review when Enter fallback does not apply', async () => {
    const fill = vi.fn(async () => undefined);
    const locator = {
      first: () => locator,
      fill,
    };

    const page = {
      locator: vi.fn(() => locator),
    };

    const executor = new InferredActionExecutor();
    const action: ResolvedInferredAction = {
      action: 'contact.submit',
      fields: [{ field: 'email', selector: '#email', controlType: 'email', label: 'Email' }],
      supported: false,
      unsupportedReason: 'Submit target could not be grounded',
      intent: 'submit',
      risk: 'low',
      targetSelectors: [],
    };

    const result = await executor.execute(page as never, action, { email: 'alice@example.com' });

    expect(fill).toHaveBeenCalledWith('alice@example.com');
    expect(result.status).toBe('awaiting_review');
    expect(result.result).toContain('manual review');
    expect(result.execution_details).toContain('filled email -> Email with "alice@example.com"');
    expect(result.execution_details).toContain('submit target unresolved; filled fields for manual review');
  });

  it('resolves collection item references before clicking an item-scoped target', async () => {
    const click = vi.fn(async () => undefined);
    const count = vi.fn(async () => 1);
    const evaluate = vi.fn(async () => 'button "Add to cart"');
    const pageEvaluate = vi.fn(async () => '[data-aaf-inferred-id="cart_2"]');

    const locator = {
      first: () => locator,
      count,
      evaluate,
      click,
    };

    const page = {
      locator: vi.fn(() => locator),
      evaluate: pageEvaluate,
      url: vi.fn(() => 'https://example.com/products'),
      waitForLoadState: vi.fn(async () => undefined),
      waitForURL: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
    };

    const executor = new InferredActionExecutor();
    const action: ResolvedInferredAction = {
      action: 'cart.add_item',
      fields: [{ field: 'item_name', selector: '#products', controlType: 'text', required: true }],
      supported: true,
      intent: 'create',
      risk: 'low',
      targetSelectors: ['[data-aaf-inferred-id="cart_1"]'],
      collectionScope: {
        collectionId: 'col_1',
        collectionSelector: '#products',
        itemSelectorById: {
          item_1: '[data-aaf-inferred-id="item_1"]',
          item_2: '[data-aaf-inferred-id="item_2"]',
        },
        itemSummaries: [
          { itemId: 'item_1', title: 'Widget Alpha', summary: 'Widget Alpha Add to cart', keyTexts: ['Widget Alpha'], interactiveIds: ['cart_1'] },
          { itemId: 'item_2', title: 'Widget Beta', summary: 'Widget Beta Add to cart', keyTexts: ['Widget Beta'], interactiveIds: ['cart_2'] },
        ],
        itemRefField: 'item_name',
        targetRole: 'button',
        targetName: 'Add to cart',
      },
    };

    const result = await executor.execute(page as never, action, { item_name: 'Widget Beta' });

    expect(pageEvaluate).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(result.status).toBe('completed');
    expect(result.execution_details).toContain('resolved item_name -> "Widget Beta"');
  });
});
