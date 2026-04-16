import type { DiscoveredAction, DiscoveredField } from '@agent-accessibility-framework/runtime-core';

export interface AccessibilityNodeSummary {
  role?: string;
  name?: string;
  value?: string;
  description?: string;
}

export interface InteractiveNode {
  elementId: string;
  tagName?: string;
  role: string;
  name?: string;
  text?: string;
  href?: string;
  type?: string;
  required?: boolean;
  disabled?: boolean;
  checked?: boolean;
  options?: string[];
  optionSelectors?: Record<string, string>;
  formId?: string;
  heading?: string;
  landmark?: string;
  visible: boolean;
  receivesPointerEvents?: boolean;
  pointerCursor?: boolean;
  box?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  selector: string;
}

export interface FormSummary {
  formId: string;
  name?: string;
  heading?: string;
  fieldIds: string[];
  submitIds: string[];
}

export interface CollectionCandidateItem {
  itemId: string;
  selector: string;
  title?: string;
  summary: string;
  keyTexts: string[];
  interactiveIds: string[];
  interactives: Array<{
    elementId: string;
    tagName?: string;
    role: string;
    name?: string;
    text?: string;
    receivesPointerEvents?: boolean;
    pointerCursor?: boolean;
    box?: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    selector: string;
  }>;
}

export interface CollectionCandidate {
  collectionId: string;
  containerId: string;
  selector: string;
  label?: string;
  itemIds: string[];
  itemCount: number;
  structureSignature: string;
  items: CollectionCandidateItem[];
}

export interface DiscoverySnapshot {
  url: string;
  title: string;
  headings: Array<{ level: number; text: string }>;
  landmarks: Array<{ role: string; name?: string }>;
  forms: FormSummary[];
  interactives: InteractiveNode[];
  collectionCandidates?: CollectionCandidate[];
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
  collections?: RawInferredCollection[];
}

export interface RawInferredCollectionActionTemplate {
  action: string;
  title: string;
  description?: string;
  intent?: DiscoveredAction['intent'];
  targetRole?: string;
  targetName?: string;
  confidence?: number;
  supported?: boolean;
  unsupportedReason?: string;
}

export interface RawInferredCollection {
  collectionId: string;
  title: string;
  description?: string;
  itemKeyFields: string[];
  confidence: number;
  actionTemplates: RawInferredCollectionActionTemplate[];
}

export function buildInferenceSystemPrompt(snapshot: DiscoverySnapshot): string {
  return `You classify web pages and infer agent-safe actions from structured accessibility and DOM data.
Return EXACTLY one JSON object. Do not include markdown. Do not invent controls or element IDs.

Goals:
1. Classify the site and page.
2. Infer likely user-meaningful actions on this page.
3. Detect repeated collections and infer shared item-level action templates once per collection.
3. Use contextual semantic action IDs with dot notation.
4. Include only actions grounded in the supplied interactives and forms.
5. Prefer one semantic action per form or region, not one action per field.
6. For repeated product/list/card/table structures, prefer collection-level templates instead of duplicating one action per repeated item.
7. Include plausible low-confidence actions when they are grounded in visible controls, but mark them with lower confidence and supported=false instead of omitting them.

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
  ],
  "collections": [
    {
      "collectionId": "col_1",
      "title": "Product listing",
      "description": "optional",
      "itemKeyFields": ["product_name", "price"],
      "confidence": 0.88,
      "actionTemplates": [
        {
          "action": "cart.add_item",
          "title": "Add item to cart",
          "description": "optional",
          "intent": "create",
          "targetRole": "button",
          "targetName": "Add to cart",
          "confidence": 0.9,
          "supported": true,
          "unsupportedReason": "only include when supported is false"
        }
      ]
    }
  ]
}

Rules:
- Use ONLY supplied element IDs from interactives/forms.
- Do not invent actions, but do include plausible low-confidence actions when grounded in visible controls.
- For low-confidence or weakly grounded actions, set supported to false and provide unsupportedReason instead of omitting them.
- Use dot-separated semantic action names.
- Do not reference selectors, XPath, CSS, or DOM paths.
- Use contextual names based on page type and intent.
- Mark destructive, payment, or irreversible actions as unsupported.
- Use only these evidence kinds when possible: role, name, label, heading, landmark, url, text.
- Do not emit generic brochure-site navigation links like "link" or "learn more" unless they are clearly primary CTAs or workflow entry points.
- Only emit collections for repeated structures present in collectionCandidates.
- Prefer collection templates for repeated item-local actions instead of one duplicated action per item.
- Collection action templates must describe an action that is available on most or all items in the collection.

Snapshot:
${JSON.stringify(snapshot, null, 2)}`;
}
