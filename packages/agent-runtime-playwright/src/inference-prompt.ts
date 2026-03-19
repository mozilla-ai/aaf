import type { DiscoveredAction, DiscoveredField } from '@agent-accessibility-framework/runtime-core';

export interface AccessibilityNodeSummary {
  role?: string;
  name?: string;
  value?: string;
  description?: string;
}

export interface InteractiveNode {
  elementId: string;
  role: string;
  name?: string;
  text?: string;
  href?: string;
  type?: string;
  required?: boolean;
  disabled?: boolean;
  checked?: boolean;
  options?: string[];
  formId?: string;
  heading?: string;
  landmark?: string;
  visible: boolean;
  selector: string;
}

export interface FormSummary {
  formId: string;
  name?: string;
  heading?: string;
  fieldIds: string[];
  submitIds: string[];
}

export interface DiscoverySnapshot {
  url: string;
  title: string;
  headings: Array<{ level: number; text: string }>;
  landmarks: Array<{ role: string; name?: string }>;
  forms: FormSummary[];
  interactives: InteractiveNode[];
  pageTextSummary: string;
  a11ySummary: AccessibilityNodeSummary[];
}

export interface RawInferredAction {
  action: string;
  title: string;
  description?: string;
  kind: 'action';
  intent: DiscoveredAction['intent'];
  targetIds: string[];
  fields: Array<{
    field: string;
    elementId: string;
    required?: boolean;
    schemaType?: string;
    enumValues?: string[];
    label?: string;
    controlType?: DiscoveredField['controlType'];
  }>;
  risk: 'none' | 'low' | 'high';
  confirmation: 'never' | 'optional' | 'review' | 'required';
  idempotent: boolean;
  confidence: number;
  expectedEffect: 'navigate' | 'submit' | 'mutate' | 'toggle' | 'open' | 'unknown';
  supported: boolean;
  unsupportedReason?: string;
  evidence: Array<{ kind: string; value: string }>;
}

export interface RawInferenceResult {
  siteType: string;
  pageType: string;
  summary: string;
  confidence: number;
  actions: RawInferredAction[];
}

export function buildInferenceSystemPrompt(snapshot: DiscoverySnapshot): string {
  return `You classify web pages and infer agent-safe actions from structured accessibility and DOM data.
Return EXACTLY one JSON object. Do not include markdown. Do not invent controls or element IDs.

Goals:
1. Classify the site and page.
2. Infer likely user-meaningful actions on this page.
3. Use contextual semantic action IDs with dot notation.
4. Include only actions grounded in the supplied interactives and forms.
5. Prefer one semantic action per form or region, not one action per field.

Output JSON shape:
{
  "siteType": "string",
  "pageType": "string",
  "summary": "string",
  "confidence": 0.0,
  "actions": [
    {
      "action": "search.submit",
      "title": "Search",
      "description": "optional",
      "kind": "action",
      "intent": "search",
      "targetIds": ["el_1"],
      "fields": [
        {
          "field": "query",
          "elementId": "el_2",
          "required": true,
          "schemaType": "string",
          "enumValues": [],
          "label": "Search",
          "controlType": "search"
        }
      ],
      "risk": "low",
      "confirmation": "optional",
      "idempotent": true,
      "confidence": 0.92,
      "expectedEffect": "submit",
      "supported": true,
      "unsupportedReason": "only include when supported is false",
      "evidence": [{"kind":"role","value":"button"}]
    }
  ]
}

Rules:
- Use ONLY supplied element IDs from interactives/forms.
- Omit uncertain actions instead of guessing.
- Use dot-separated semantic action names.
- Do not reference selectors, XPath, CSS, or DOM paths.
- Use contextual names based on page type and intent.
- Mark destructive, payment, or irreversible actions as unsupported.
- Use only these evidence kinds when possible: role, name, label, heading, landmark, url, text.

Snapshot:
${JSON.stringify(snapshot, null, 2)}`;
}
