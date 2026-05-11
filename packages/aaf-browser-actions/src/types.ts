export const DEFAULT_ELEMENT_ATTR_NAME = 'data-aaf-extension-id';

export type BrowserActionIntent =
  | 'navigate'
  | 'search'
  | 'authenticate'
  | 'create'
  | 'update'
  | 'delete'
  | 'filter'
  | 'sort'
  | 'toggle'
  | 'submit'
  | 'open'
  | 'close'
  | 'download'
  | 'unknown';

export type BrowserActionRisk = 'none' | 'low' | 'high';
export type BrowserActionConfirmation = 'never' | 'optional' | 'review' | 'required';
export type BrowserControlType =
  | 'text'
  | 'email'
  | 'password'
  | 'search'
  | 'number'
  | 'date'
  | 'url'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'radio-group'
  | 'textarea'
  | 'unknown';

export interface BrowserInteractiveNode {
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

export interface BrowserFormSummary {
  formId: string;
  name?: string;
  heading?: string;
  fieldIds: string[];
  submitIds: string[];
}

export interface BrowserCollectionCandidateItemInteractive {
  elementId: string;
  tagName?: string;
  role: string;
  name?: string;
  text?: string;
  heading?: string;
  landmark?: string;
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

export interface BrowserCollectionCandidateItem {
  itemId: string;
  selector: string;
  title?: string;
  summary: string;
  heading?: string;
  landmark?: string;
  keyTexts: string[];
  interactiveIds: string[];
  interactives: BrowserCollectionCandidateItemInteractive[];
}

export interface BrowserCollectionCandidate {
  collectionId: string;
  containerId: string;
  selector: string;
  label?: string;
  itemIds: string[];
  itemCount: number;
  structureSignature: string;
  items: BrowserCollectionCandidateItem[];
}

export interface BrowserDiscoverySnapshot {
  url: string;
  title: string;
  elementAttribute: string;
  headings: Array<{ level: number; text: string }>;
  landmarks: Array<{ role: string; name?: string }>;
  forms: BrowserFormSummary[];
  interactives: BrowserInteractiveNode[];
  collectionCandidates?: BrowserCollectionCandidate[];
  pageTextSummary: string;
}

export interface BrowserField {
  field: string;
  elementId: string;
  selector?: string;
  label?: string;
  controlType?: BrowserControlType;
  required?: boolean;
  options?: string[];
  enumValues?: string[];
  optionSelectors?: Record<string, string>;
}

export interface BrowserCollectionScope {
  collectionId: string;
  collectionSelector: string;
  itemRefField: string;
  itemSelectorById: Record<string, string>;
  groundedTargetSelectorByItem?: Record<string, string>;
  itemSummaries: Array<{
    itemId: string;
    title: string;
    summary: string;
    keyTexts: string[];
  }>;
  targetRole?: string;
  targetName?: string;
}

export interface BrowserAction {
  action: string;
  title?: string;
  description?: string;
  source?: 'aaf' | 'heuristic' | 'llm' | 'inferred';
  supported?: boolean;
  unsupportedReason?: string;
  confidence?: number;
  risk?: BrowserActionRisk;
  confirmation?: BrowserActionConfirmation;
  intent?: BrowserActionIntent;
  targetElementId?: string;
  targetSelectors?: string[];
  submitSelector?: string;
  elementAttribute?: string;
  fields: BrowserField[];
  collectionScope?: BrowserCollectionScope;
}

export interface BrowserCollection {
  collectionId: string;
  title: string;
  confidence: number;
  itemKeyFields: string[];
  items: Array<{
    itemId: string;
    title?: string;
    summary: string;
  }>;
  actionTemplates: Array<{
    action: string;
    title: string;
    supported?: boolean;
    confidence?: number;
    unsupportedReason?: string;
  }>;
}

export interface BrowserActionCatalog {
  url: string;
  title?: string;
  discoveryMode?: 'aaf' | 'heuristic' | 'llm' | 'inferred';
  pageContext?: {
    siteType: string;
    pageType: string;
    summary: string;
    confidence: number;
  };
  actions: BrowserAction[];
  collections?: BrowserCollection[];
  snapshot?: BrowserDiscoverySnapshot;
}

export interface BrowserExecutionResult {
  status: 'completed' | 'awaiting_review' | 'validation_error' | 'execution_error';
  result?: string;
  error?: string;
  executionDetails?: string[];
}

export interface BrowserRawInferredAction {
  action: string;
  title: string;
  description?: string;
  kind?: 'action';
  intent?: BrowserActionIntent;
  targetIds: string[];
  fields: Array<{
    field: string;
    elementId: string;
    required?: boolean;
    schemaType?: string;
    enumValues?: string[];
    label?: string;
    controlType?: BrowserControlType;
  }>;
  risk?: BrowserActionRisk;
  confirmation?: BrowserActionConfirmation;
  idempotent?: boolean;
  confidence?: number;
  expectedEffect?: 'navigate' | 'submit' | 'mutate' | 'toggle' | 'open' | 'unknown';
  supported?: boolean;
  unsupportedReason?: string;
  evidence?: Array<{
    kind: 'role' | 'name' | 'label' | 'heading' | 'landmark' | 'url' | 'text' | string;
    value: string;
  }>;
}

export interface BrowserRawInferredCollectionActionTemplate {
  action: string;
  title: string;
  description?: string;
  intent?: BrowserActionIntent;
  targetRole?: string;
  targetName?: string;
  confidence?: number;
  supported?: boolean;
  unsupportedReason?: string;
}

export interface BrowserRawInferredCollection {
  collectionId: string;
  title: string;
  description?: string;
  itemKeyFields: string[];
  confidence: number;
  actionTemplates: BrowserRawInferredCollectionActionTemplate[];
}

export interface BrowserRawInferenceResult {
  siteType: string;
  pageType: string;
  summary: string;
  confidence: number;
  actions: BrowserRawInferredAction[];
  collections?: BrowserRawInferredCollection[];
}

export interface BuildSnapshotOptions {
  maxInteractiveNodes?: number;
  attrName?: string;
}
