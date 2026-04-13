import { describe, expect, it } from 'vitest';
import { normalizeInferenceResult, parseInference } from './inferred-action-discoverer.js';
import type { DiscoverySnapshot } from './inference-prompt.js';

const SNAPSHOT: DiscoverySnapshot = {
  url: 'https://example.com/login',
  title: 'Login',
  headings: [{ level: 1, text: 'Sign in' }],
  landmarks: [{ role: 'main', name: 'Sign in' }],
  forms: [{ formId: 'form_1', name: 'Sign in', fieldIds: ['el_1', 'el_2'], submitIds: ['el_3'] }],
  collectionCandidates: [],
  interactives: [
    {
      elementId: 'el_1',
      role: 'email',
      name: 'Email',
      type: 'email',
      visible: true,
      selector: '[data-aaf-inferred-id="el_1"]',
      formId: 'form_1',
    },
    {
      elementId: 'el_2',
      role: 'password',
      name: 'Password',
      type: 'password',
      visible: true,
      selector: '[data-aaf-inferred-id="el_2"]',
      formId: 'form_1',
    },
    {
      elementId: 'el_3',
      role: 'button',
      name: 'Sign in',
      text: 'Sign in',
      visible: true,
      selector: '[data-aaf-inferred-id="el_3"]',
      formId: 'form_1',
    },
  ],
  pageTextSummary: 'Sign in to continue',
  a11ySummary: [{ role: 'button', name: 'Sign in' }],
};

describe('parseInference', () => {
  it('rejects malformed JSON payloads', () => {
    expect(() => parseInference('{"siteType":"x"}')).toThrow('missing actions array');
  });
});

describe('normalizeInferenceResult', () => {
  it('normalizes auth actions and maps fields', () => {
    const result = normalizeInferenceResult({
      siteType: 'saas',
      pageType: 'login page',
      summary: 'Login form',
      confidence: 0.9,
      actions: [
        {
          action: 'bad custom name',
          title: 'Sign in',
          kind: 'action',
          intent: 'authenticate',
          targetIds: ['el_3'],
          fields: [
            { field: 'email', elementId: 'el_1', required: true, schemaType: 'string', label: 'Email', controlType: 'email' },
            { field: 'password', elementId: 'el_2', required: true, schemaType: 'string', label: 'Password', controlType: 'password' },
          ],
          risk: 'low',
          confirmation: 'optional',
          idempotent: false,
          confidence: 0.93,
          expectedEffect: 'submit',
          supported: true,
          evidence: [{ kind: 'heading', value: 'Sign in' }],
        },
      ],
    }, SNAPSHOT);

    expect(result.catalog.discoveryMode).toBe('inferred');
    expect(result.catalog.pageContext?.pageType).toBe('login page');
    expect(result.catalog.actions[0].action).toMatch(/^auth\./);
    expect(result.catalog.actions[0].fields.map((field) => field.field)).toEqual(['email', 'password']);
    expect(result.resolvedActions.get(result.catalog.actions[0].action)?.targetSelectors).toEqual(['[data-aaf-inferred-id="el_3"]']);
  });

  it('blocks actions that reference unknown elements', () => {
    const result = normalizeInferenceResult({
      siteType: 'saas',
      pageType: 'settings page',
      summary: 'Settings form',
      confidence: 0.9,
      actions: [
        {
          action: 'settings.save',
          title: 'Save settings',
          kind: 'action',
          intent: 'update',
          targetIds: ['missing'],
          fields: [],
          risk: 'low',
          confirmation: 'optional',
          idempotent: false,
          confidence: 0.99,
          expectedEffect: 'submit',
          supported: true,
          evidence: [{ kind: 'text', value: 'Save' }],
        },
      ],
    }, SNAPSHOT);

    expect(result.catalog.actions[0].supported).toBe(false);
  });

  it('filters low-value generic navigation links on informational pages', () => {
    const result = normalizeInferenceResult({
      siteType: 'educational',
      pageType: 'programs overview',
      summary: 'Program overview page',
      confidence: 0.95,
      actions: [
        {
          action: 'navigation.link',
          title: 'Link',
          kind: 'action',
          intent: 'navigate',
          targetIds: ['el_3'],
          fields: [],
          risk: 'low',
          confirmation: 'optional',
          idempotent: true,
          confidence: 0.95,
          expectedEffect: 'navigate',
          supported: true,
          evidence: [{ kind: 'name', value: 'Learn more' }],
        },
      ],
    }, {
      ...SNAPSHOT,
      url: 'https://example.edu/programs',
      title: 'Programs',
      interactives: [
        {
          elementId: 'el_3',
          role: 'link',
          name: 'Learn more',
          text: 'Learn more',
          visible: true,
          selector: '[data-aaf-inferred-id="el_3"]',
        },
      ],
      forms: [],
      headings: [{ level: 1, text: 'Programs' }],
      landmarks: [{ role: 'main', name: 'Programs' }],
      pageTextSummary: 'Learn more about the program',
      a11ySummary: [{ role: 'link', name: 'Learn more' }],
    });

    expect(result.catalog.actions).toHaveLength(0);
  });

  it('normalizes repeated collections into parameterized item actions', () => {
    const result = normalizeInferenceResult({
      siteType: 'commerce',
      pageType: 'product listing',
      summary: 'Product cards',
      confidence: 0.92,
      actions: [],
      collections: [
        {
          collectionId: 'col_1',
          title: 'Products',
          itemKeyFields: ['item_name'],
          confidence: 0.9,
          actionTemplates: [
            {
              action: 'cart.add_item',
              title: 'Add item to cart',
              intent: 'create',
              targetRole: 'button',
              targetName: 'Add to cart',
              confidence: 0.94,
              supported: true,
            },
          ],
        },
      ],
    }, {
      ...SNAPSHOT,
      url: 'https://example.com/products',
      title: 'Products',
      collectionCandidates: [
        {
          collectionId: 'col_1',
          containerId: 'container_1',
          selector: '[data-aaf-inferred-id="container_1"]',
          label: 'Products',
          itemIds: ['item_1', 'item_2', 'item_3'],
          itemCount: 3,
          structureSignature: 'div|button',
          items: [
            {
              itemId: 'item_1',
              selector: '[data-aaf-inferred-id="item_1"]',
              title: 'Widget Alpha',
              summary: 'Widget Alpha Add to cart',
              keyTexts: ['Widget Alpha'],
              interactiveIds: ['cart_1'],
              interactives: [{ elementId: 'cart_1', role: 'button', name: 'Add to cart', text: 'Add to cart', selector: '[data-aaf-inferred-id="cart_1"]' }],
            },
            {
              itemId: 'item_2',
              selector: '[data-aaf-inferred-id="item_2"]',
              title: 'Widget Beta',
              summary: 'Widget Beta Add to cart',
              keyTexts: ['Widget Beta'],
              interactiveIds: ['cart_2'],
              interactives: [{ elementId: 'cart_2', role: 'button', name: 'Add to cart', text: 'Add to cart', selector: '[data-aaf-inferred-id="cart_2"]' }],
            },
            {
              itemId: 'item_3',
              selector: '[data-aaf-inferred-id="item_3"]',
              title: 'Widget Gamma',
              summary: 'Widget Gamma Add to cart',
              keyTexts: ['Widget Gamma'],
              interactiveIds: ['cart_3'],
              interactives: [{ elementId: 'cart_3', role: 'button', name: 'Add to cart', text: 'Add to cart', selector: '[data-aaf-inferred-id="cart_3"]' }],
            },
          ],
        },
      ],
      interactives: [
        {
          elementId: 'cart_1',
          role: 'button',
          name: 'Add to cart',
          text: 'Add to cart',
          visible: true,
          selector: '[data-aaf-inferred-id="cart_1"]',
        },
        {
          elementId: 'cart_2',
          role: 'button',
          name: 'Add to cart',
          text: 'Add to cart',
          visible: true,
          selector: '[data-aaf-inferred-id="cart_2"]',
        },
        {
          elementId: 'cart_3',
          role: 'button',
          name: 'Add to cart',
          text: 'Add to cart',
          visible: true,
          selector: '[data-aaf-inferred-id="cart_3"]',
        },
      ],
      forms: [],
      headings: [{ level: 1, text: 'Products' }],
      landmarks: [{ role: 'main', name: 'Products' }],
      pageTextSummary: 'Products Widget Alpha Widget Beta Widget Gamma',
      a11ySummary: [{ role: 'button', name: 'Add to cart' }],
    });

    expect(result.catalog.collections).toHaveLength(1);
    expect(result.catalog.collections?.[0].items).toHaveLength(3);
    expect(result.catalog.actions[0].action).toBe('cart.add_item');
    expect(result.catalog.actions[0].fields[0].field).toBe('item_name');
    expect(result.resolvedActions.get('cart.add_item')?.collectionScope?.itemSummaries[1].title).toBe('Widget Beta');
    expect(result.resolvedActions.get('cart.add_item')?.collectionScope?.groundedTargetSelectorByItem?.item_2).toBe('[data-aaf-inferred-id="cart_2"]');
  });
});
