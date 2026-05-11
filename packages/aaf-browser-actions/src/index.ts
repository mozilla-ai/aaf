export { DEFAULT_ELEMENT_ATTR_NAME } from './types.js';
export type {
  BrowserAction,
  BrowserActionCatalog,
  BrowserActionConfirmation,
  BrowserActionIntent,
  BrowserActionRisk,
  BrowserCollection,
  BrowserCollectionCandidate,
  BrowserCollectionScope,
  BrowserControlType,
  BrowserDiscoverySnapshot,
  BrowserExecutionResult,
  BrowserField,
  BrowserFormSummary,
  BrowserInteractiveNode,
  BrowserRawInferenceResult,
  BuildSnapshotOptions,
} from './types.js';
export { buildSnapshot } from './snapshot.js';
export { buildInferencePrompt, normalizeInferenceResult, buildPlannerPrompt } from './inference.js';
export { executeGroundedAction } from './execution.js';
