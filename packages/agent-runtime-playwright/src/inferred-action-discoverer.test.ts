import { describe, expect, it } from 'vitest';
import { normalizeInferenceResult, parseInference } from './inferred-action-discoverer.js';
import type { DiscoverySnapshot } from './inference-prompt.js';

const SNAPSHOT: DiscoverySnapshot = {
  url: 'https://example.com/login',
  title: 'Login',
  headings: [{ level: 1, text: 'Sign in' }],
  landmarks: [{ role: 'main', name: 'Sign in' }],
  forms: [{ formId: 'form_1', name: 'Sign in', fieldIds: ['el_1', 'el_2'], submitIds: ['el_3'] }],
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
});

