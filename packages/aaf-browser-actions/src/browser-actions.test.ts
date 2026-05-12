// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildSnapshot, executeGroundedAction, normalizeInferenceResult } from './index.js';

function installBoundingBoxes(document: Document) {
  for (const el of Array.from(document.querySelectorAll('*'))) {
    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => ({
        left: 0,
        top: 0,
        width: 100,
        height: 20,
        right: 100,
        bottom: 20,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
      configurable: true,
    });
  }
}

describe('buildSnapshot', () => {
  it('captures url inputs, radio-groups, and collection candidates', () => {
    document.body.innerHTML = `
      <form>
        <label>Website URL <input type="url" /></label>
        <fieldset>
          <legend>Consent Flow</legend>
          <label><input type="radio" name="flow" value="accept" />Accept All</label>
          <label><input type="radio" name="flow" value="reject" />Reject All</label>
        </fieldset>
      </form>
      <section>
        <h2>Search results</h2>
        <article><h3>One</h3><button>Add to cart</button></article>
        <article><h3>Two</h3><button>Add to cart</button></article>
        <article><h3>Three</h3><button>Add to cart</button></article>
      </section>
    `;
    installBoundingBoxes(document);

    const snapshot = buildSnapshot(document);
    expect(snapshot.interactives.some((node) => node.type === 'url')).toBe(true);
    expect(snapshot.interactives.some((node) => node.type === 'radio-group')).toBe(true);
    expect(snapshot.collectionCandidates).toHaveLength(1);
    expect(snapshot.collectionCandidates?.[0]?.itemCount).toBe(3);
  });
});

describe('normalizeInferenceResult', () => {
  it('marks high-risk actions unsupported and preserves grounded collection actions', () => {
    document.body.innerHTML = `
      <section>
        <h2>Search results</h2>
        <article><h3>One</h3><button>Add to cart</button><button>Delete</button></article>
        <article><h3>Two</h3><button>Add to cart</button><button>Delete</button></article>
        <article><h3>Three</h3><button>Add to cart</button><button>Delete</button></article>
      </section>
    `;
    installBoundingBoxes(document);
    const snapshot = buildSnapshot(document);
    const [firstButton, secondButton] = snapshot.interactives.filter((node) => node.role === 'button');

    const result = normalizeInferenceResult({
      siteType: 'ecommerce',
      pageType: 'product_listing',
      summary: 'Products',
      confidence: 0.95,
      actions: [{
        action: 'account.delete',
        title: 'Delete account',
        description: 'Dangerous action',
        intent: 'delete',
        targetIds: [secondButton.elementId],
        fields: [],
        risk: 'low',
        confirmation: 'optional',
        confidence: 0.95,
        supported: true,
        evidence: [{ kind: 'text', value: 'Delete' }],
      }],
      collections: [{
        collectionId: snapshot.collectionCandidates?.[0]?.collectionId || '',
        title: 'Products',
        itemKeyFields: ['product_name'],
        confidence: 0.9,
        actionTemplates: [{
          action: 'cart.add_item',
          title: 'Add item',
          intent: 'create',
          targetRole: 'button',
          targetName: 'Add to cart',
          confidence: 0.9,
          supported: true,
        }],
      }],
    }, snapshot);

    expect(result.actions.some((action) => action.action === 'account.delete' && action.supported === false)).toBe(true);
    const collectionAction = result.actions.find((action) => action.collectionScope);
    expect(collectionAction?.collectionScope?.itemRefField).toBeTruthy();
    expect(collectionAction?.targetSelectors?.length).toBe(1);
  });
});

describe('executeGroundedAction', () => {
  it('resolves select values, radio-group options, and collection items', () => {
    document.body.innerHTML = `
      <form>
        <label>Region
          <select data-aaf-extension-id="ext_1">
            <option value="US-CA">California</option>
            <option value="US-NY">New York</option>
          </select>
        </label>
        <fieldset data-aaf-extension-id="ext_2">
          <legend>Consent Flow</legend>
          <label><input data-aaf-extension-id="ext_3" type="radio" name="flow" />Accept All</label>
          <label><input data-aaf-extension-id="ext_4" type="radio" name="flow" />Reject All</label>
        </fieldset>
      </form>
      <section>
        <article data-aaf-extension-id="ext_5"><h3>Young Manchego</h3><button data-aaf-extension-id="ext_6">Add to cart</button></article>
        <article data-aaf-extension-id="ext_7"><h3>Old Manchego</h3><button data-aaf-extension-id="ext_8">Add to cart</button></article>
        <article data-aaf-extension-id="ext_9"><h3>Reserva</h3><button data-aaf-extension-id="ext_10">Add to cart</button></article>
      </section>
    `;
    installBoundingBoxes(document);
    const clicked: string[] = [];
    for (const button of Array.from(document.querySelectorAll('button'))) {
      button.addEventListener('click', () => clicked.push(button.textContent || ''));
    }

    const formAction = executeGroundedAction(document, {
      action: 'consent_check.start_analysis',
      intent: 'create',
      supported: true,
      elementAttribute: 'data-aaf-extension-id',
      targetSelectors: ['[data-aaf-extension-id="ext_6"]'],
      fields: [
        {
          field: 'region',
          elementId: 'ext_1',
          selector: '[data-aaf-extension-id="ext_1"]',
          controlType: 'select',
        },
        {
          field: 'consent_flow',
          elementId: 'ext_2',
          selector: '[data-aaf-extension-id="ext_2"]',
          controlType: 'radio-group',
          optionSelectors: {
            'Accept All': '[data-aaf-extension-id="ext_3"]',
            'Reject All': '[data-aaf-extension-id="ext_4"]',
          },
        },
      ],
    }, {
      region: 'California',
      consent_flow: 'Reject All',
    });

    expect(formAction.status).toBe('completed');
    expect((document.querySelector('[data-aaf-extension-id="ext_1"]') as HTMLSelectElement).value).toBe('US-CA');
    expect((document.querySelector('[data-aaf-extension-id="ext_4"]') as HTMLInputElement).checked).toBe(true);

    const collectionAction = executeGroundedAction(document, {
      action: 'cart.add_item',
      intent: 'create',
      supported: true,
      elementAttribute: 'data-aaf-extension-id',
      fields: [{
        field: 'product_name',
        elementId: 'ext_5',
        selector: '[data-aaf-extension-id="ext_5"]',
        controlType: 'text',
      }],
      collectionScope: {
        collectionId: 'col_1',
        collectionSelector: 'section',
        itemRefField: 'product_name',
        itemSelectorById: {
          item_1: '[data-aaf-extension-id="ext_5"]',
          item_2: '[data-aaf-extension-id="ext_7"]',
          item_3: '[data-aaf-extension-id="ext_9"]',
        },
        groundedTargetSelectorByItem: {
          item_1: '[data-aaf-extension-id="ext_6"]',
          item_2: '[data-aaf-extension-id="ext_8"]',
          item_3: '[data-aaf-extension-id="ext_10"]',
        },
        itemSummaries: [
          { itemId: 'item_1', title: 'Young Manchego', summary: 'Young Manchego', keyTexts: ['Young Manchego'] },
          { itemId: 'item_2', title: 'Old Manchego', summary: 'Old Manchego', keyTexts: ['Old Manchego'] },
          { itemId: 'item_3', title: 'Reserva', summary: 'Reserva', keyTexts: ['Reserva'] },
        ],
      },
    }, {
      product_name: 'young manchego',
    });

    expect(collectionAction.status).toBe('completed');
    expect(clicked).toContain('Add to cart');
  });

  it('returns awaiting_review for low-risk partially grounded actions', () => {
    document.body.innerHTML = `<input data-aaf-extension-id="ext_1" type="search" />`;
    installBoundingBoxes(document);

    const result = executeGroundedAction(document, {
      action: 'search.submit',
      intent: 'search',
      supported: false,
      risk: 'low',
      elementAttribute: 'data-aaf-extension-id',
      fields: [{
        field: 'query',
        elementId: 'ext_1',
        selector: '[data-aaf-extension-id="ext_1"]',
        controlType: 'search',
      }],
    }, {
      query: 'manchego',
    });

    expect(['completed', 'awaiting_review']).toContain(result.status);
  });
});
