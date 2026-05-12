import { describe, it, expect } from 'vitest';
import { applyInferenceRiskRules, sanitizeUnsupportedReason } from './inference-risk.js';
import type { DiscoverySnapshot, RawInferredAction } from './inference-prompt.js';

const SNAPSHOT: DiscoverySnapshot = {
  url: 'https://example.com/settings',
  title: 'Settings',
  headings: [{ level: 1, text: 'Settings' }],
  landmarks: [{ role: 'main', name: 'Settings' }],
  forms: [],
  interactives: [
    {
      elementId: 'el_1',
      role: 'button',
      name: 'Delete account',
      text: 'Delete account',
      visible: true,
      selector: '[data-aaf-inferred-id="el_1"]',
    },
    {
      elementId: 'el_2',
      role: 'checkbox',
      name: 'Marketing emails',
      visible: true,
      selector: '[data-aaf-inferred-id="el_2"]',
      type: 'checkbox',
      checked: false,
    },
  ],
  pageTextSummary: 'Settings page',
  a11ySummary: [{ role: 'button', name: 'Delete account' }],
};

describe('applyInferenceRiskRules', () => {
  it('drops placeholder unsupported reasons', () => {
    expect(sanitizeUnsupportedReason('optional')).toBeUndefined();
    expect(sanitizeUnsupportedReason('required')).toBeUndefined();
    expect(sanitizeUnsupportedReason('Primary target lacks an accessible name')).toBe('Primary target lacks an accessible name');
  });

  it('blocks high-risk destructive actions', () => {
    const action: RawInferredAction = {
      action: 'page.delete_account',
      title: 'Delete account',
      kind: 'action',
      intent: 'delete',
      targetIds: ['el_1'],
      fields: [],
      risk: 'low',
      confirmation: 'optional',
      idempotent: false,
      confidence: 0.95,
      expectedEffect: 'mutate',
      supported: true,
      evidence: [{ kind: 'text', value: 'Delete account' }],
    };

    const result = applyInferenceRiskRules(action, SNAPSHOT);
    expect(result.supported).toBe(false);
    expect(result.risk).toBe('high');
    expect(result.confirmation).toBe('required');
  });

  it('keeps safe toggle actions executable', () => {
    const action: RawInferredAction = {
      action: 'settings.toggle_marketing_emails',
      title: 'Marketing emails',
      kind: 'action',
      intent: 'toggle',
      targetIds: ['el_2'],
      fields: [],
      risk: 'low',
      confirmation: 'optional',
      idempotent: true,
      confidence: 0.91,
      expectedEffect: 'toggle',
      supported: true,
      evidence: [{ kind: 'label', value: 'Marketing emails' }],
    };

    const result = applyInferenceRiskRules(action, SNAPSHOT);
    expect(result.supported).toBe(true);
    expect(result.risk).toBe('low');
  });

  it('allows url fields for safe inferred form actions', () => {
    const action: RawInferredAction = {
      action: 'consent_check.start_analysis',
      title: 'Start analysis',
      kind: 'action',
      intent: 'submit',
      targetIds: ['el_1'],
      fields: [
        {
          field: 'website_url',
          elementId: 'el_2',
          controlType: 'url',
          required: true,
        },
      ],
      risk: 'low',
      confirmation: 'optional',
      idempotent: true,
      confidence: 0.96,
      expectedEffect: 'submit',
      supported: true,
      evidence: [{ kind: 'label', value: 'Website URL' }],
    };

    const result = applyInferenceRiskRules(action, {
      ...SNAPSHOT,
      interactives: [
        SNAPSHOT.interactives[0],
        {
          elementId: 'el_2',
          role: 'textbox',
          name: 'Website URL',
          visible: true,
          selector: '[data-aaf-inferred-id="el_2"]',
          type: 'url',
        },
      ],
      forms: [{ formId: 'form_1', fieldIds: ['el_2'], submitIds: ['el_1'] }],
    });

    expect(result.supported).toBe(true);
    expect(result.unsupportedReason).toBeUndefined();
  });

  it('allows radio-group fields for safe inferred form actions', () => {
    const action: RawInferredAction = {
      action: 'consent_check.start_analysis',
      title: 'Start analysis',
      kind: 'action',
      intent: 'submit',
      targetIds: ['el_1'],
      fields: [
        {
          field: 'consent_flow',
          elementId: 'el_2',
          controlType: 'radio-group',
          required: true,
          enumValues: ['Banner only', 'Full CMP'],
        },
      ],
      risk: 'low',
      confirmation: 'optional',
      idempotent: true,
      confidence: 0.96,
      expectedEffect: 'submit',
      supported: true,
      evidence: [{ kind: 'label', value: 'Consent flow' }],
    };

    const result = applyInferenceRiskRules(action, {
      ...SNAPSHOT,
      interactives: [
        SNAPSHOT.interactives[0],
        {
          elementId: 'el_2',
          role: 'radiogroup',
          name: 'Consent flow',
          visible: true,
          selector: '[data-aaf-inferred-id="el_2"]',
          type: 'radio-group',
          options: ['Banner only', 'Full CMP'],
        },
      ],
      forms: [{ formId: 'form_1', fieldIds: ['el_2'], submitIds: ['el_1'] }],
    });

    expect(result.supported).toBe(true);
    expect(result.unsupportedReason).toBeUndefined();
  });
});
