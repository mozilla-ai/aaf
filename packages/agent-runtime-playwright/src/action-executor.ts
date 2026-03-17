import type { Page } from '@playwright/test';
import type { LlmBackend } from '@agent-accessibility-framework/planner-local';
import {
  SemanticParser,
  ManifestValidator,
  PolicyEngine,
  ExecutionLogger,
  coerceArgs,
  getPageForAction,
  type AgentManifest,
  type ExecutionLog,
  type AAFAdapter,
  type ActionCatalog,
  type AAFValidationResult,
  type ExecuteOptions,
  type ExecutionResult,
  type DiscoveredAction,
} from '@agent-accessibility-framework/runtime-core';
import { InferredActionDiscoverer } from './inferred-action-discoverer.js';
import { InferredActionExecutor, type ResolvedInferredAction } from './inferred-action-executor.js';

export interface ExecuteActionOptions {
  actionName: string;
  input: Record<string, unknown>;
  confirmed?: boolean;
  baseUrl: string;
  manifest: AgentManifest;
}

export interface PlaywrightAdapterOptions {
  llmBackend?: LlmBackend;
  discoveryMode?: 'aaf-preferred' | 'inferred-only';
  allowInferredExecution?: boolean;
  maxInteractiveNodes?: number;
}

export class ActionExecutor {
  private parser = new SemanticParser();
  private validator = new ManifestValidator();
  private policy = new PolicyEngine();

  async execute(page: Page, options: ExecuteActionOptions): Promise<{ status: string; log: ExecutionLog }> {
    const { actionName, input, confirmed, baseUrl, manifest } = options;
    const logger = new ExecutionLogger(actionName, 'ui');

    // 1. Get action from manifest
    const action = this.validator.getAction(manifest, actionName);

    // 2. Coerce + validate input against schema
    const { valid, errors, coerced, coercions } = this.validator.coerceAndValidate(action, input);
    logger.coerce(coercions);
    if (!valid) {
      logger.validate(`FAILED: ${errors.join(', ')}`);
      throw new Error(`Input validation failed: ${errors.join(', ')}`);
    }
    logger.validate('PASSED');

    // 3. Check policy
    const policyResult = this.policy.checkExecution(action, {
      confirmed,
      requiredFields: input,
    });
    if (!policyResult.allowed) {
      logger.policyCheck('BLOCKED', policyResult.reason);
      throw new Error(`Policy check failed: ${policyResult.reason}`);
    }
    logger.policyCheck('PASSED');

    // 4. Navigate to page
    const pagePath = getPageForAction(manifest, actionName);
    if (pagePath) {
      const url = `${baseUrl}${pagePath}`;
      logger.navigate(url);
      await page.goto(url, { waitUntil: 'networkidle' });
    }

    // 5. Discover actions on the page
    const discoveredActions = await page.evaluate(() => {
      // We need to replicate simple discovery in browser context
      const actionEls = document.querySelectorAll('[data-agent-kind="action"][data-agent-action]');
      const actions: Array<{ action: string; fields: Array<{ field: string }>; submitAction?: string }> = [];
      const seen = new Set<string>();
      actionEls.forEach((el) => {
        const name = el.getAttribute('data-agent-action')!;
        if (name.split('.').length > 2 || seen.has(name)) return;
        seen.add(name);
        const fields: Array<{ field: string }> = [];
        // Nested fields
        el.querySelectorAll('[data-agent-kind="field"]').forEach((f) => {
          fields.push({ field: f.getAttribute('data-agent-field')! });
        });
        // Linked fields
        document.querySelectorAll(`[data-agent-kind="field"][data-agent-for-action="${name}"]`).forEach((f) => {
          const fieldName = f.getAttribute('data-agent-field')!;
          if (!fields.some((x) => x.field === fieldName)) {
            fields.push({ field: fieldName });
          }
        });
        // Submit action
        let submitAction: string | undefined;
        el.querySelectorAll('[data-agent-kind="action"]').forEach((sub) => {
          const subAction = sub.getAttribute('data-agent-action');
          if (subAction && subAction.startsWith(name + '.')) {
            submitAction = subAction;
          }
        });
        actions.push({ action: name, fields, submitAction });
      });
      return actions;
    });

    const discovered = discoveredActions.find((a) => a.action === actionName);
    if (!discovered) {
      throw new Error(`Action "${actionName}" not found on page`);
    }

    // 6. Fill fields (use coerced args)
    for (const field of discovered.fields) {
      const value = coerced[field.field];
      if (value === undefined) continue;

      const fieldSelector = await page.evaluate(
        ({ name, field }) => {
          const actionRoot = document.querySelector(
            `[data-agent-kind="action"][data-agent-action="${name}"]`,
          );
          const fieldSelector = `[data-agent-kind="field"][data-agent-field="${field}"]`;
          const nested = actionRoot?.querySelector(fieldSelector) as Element | null;
          if (nested?.id) return `#${nested.id}`;

          const linked = document.querySelector(
            `${fieldSelector}[data-agent-for-action="${name}"]`,
          ) as Element | null;
          if (linked?.id) return `#${linked.id}`;

          return linked ? `${fieldSelector}[data-agent-for-action="${name}"]` : null;
        },
        { name: actionName, field: field.field }
      );
      if (!fieldSelector) continue;

      const tagName = await page.evaluate(
        (sel) => document.querySelector(sel)?.tagName.toLowerCase(),
        fieldSelector
      );

      if (tagName === 'select') {
        await page.selectOption(fieldSelector, String(value));
      } else if (tagName === 'textarea' || tagName === 'input') {
        await page.fill(fieldSelector, String(value));
      }
      logger.fill(field.field, value);
    }

    // 7. If confirmation is 'review', stop after filling — let the user submit manually
    if (action.confirmation === 'review') {
      return { status: 'awaiting_review', log: logger.toLog() };
    }

    // 8. Click submit
    if (discovered.submitAction) {
      const submitSelector = `[data-agent-action="${discovered.submitAction}"]`;
      await page.click(submitSelector);
      logger.click(discovered.submitAction);
    } else {
      // Click the action element itself (for buttons like workspace.delete)
      const actionSelector = `[data-agent-action="${actionName}"]`;
      await page.click(actionSelector);
      logger.click(actionName);
    }

    // 9. Wait a moment for status to update
    await page.waitForTimeout(500);

    // 10. Read status
    const statusPayload = await page.evaluate((name) => {
      const actionRoot = document.querySelector(
        `[data-agent-kind="action"][data-agent-action="${name}"]`,
      );
      const nested = actionRoot?.querySelector('[data-agent-kind="status"]');
      const linked = document.querySelector(
        `[data-agent-kind="status"][data-agent-for-action="${name}"]`,
      );
      const el = nested || linked;
      if (!el) return { text: '', output: '' };
      return {
        text: el.textContent?.trim() || '',
        output: el.getAttribute('data-agent-output') || '',
      };
    }, actionName);

    if (statusPayload.text) {
      logger.readStatus(statusPayload.output, statusPayload.text);
    }

    return { status: statusPayload.text, log: logger.toLog() };
  }
}

/**
 * AAFAdapter implementation using Playwright for headless browser testing.
 * Wraps the existing ActionExecutor with the standardized AAFAdapter interface.
 */
export class PlaywrightAdapter implements AAFAdapter {
  private page: Page;
  private baseUrl: string;
  private manifest?: AgentManifest;
  private parser = new SemanticParser();
  private validator = new ManifestValidator();
  private policy = new PolicyEngine();
  private executor = new ActionExecutor();
  private inferredExecutor = new InferredActionExecutor();
  private llmBackend?: LlmBackend;
  private discoveryMode: 'aaf-preferred' | 'inferred-only';
  private allowInferredExecution: boolean;
  private maxInteractiveNodes: number;
  private lastCatalog?: ActionCatalog;
  private inferredExecutionMap = new Map<string, ResolvedInferredAction>();

  constructor(page: Page, baseUrl: string, manifest?: AgentManifest, options?: PlaywrightAdapterOptions) {
    this.page = page;
    this.baseUrl = baseUrl;
    this.manifest = manifest;
    this.llmBackend = options?.llmBackend;
    this.discoveryMode = options?.discoveryMode || 'aaf-preferred';
    this.allowInferredExecution = options?.allowInferredExecution ?? true;
    this.maxInteractiveNodes = options?.maxInteractiveNodes ?? 150;
  }

  async detect(): Promise<boolean> {
    const hasAaf = await this.page.evaluate(() => document.querySelectorAll('[data-agent-kind]').length > 0);
    if (hasAaf && this.discoveryMode !== 'inferred-only') return true;
    if (!this.llmBackend) return false;
    const catalog = await this.discover();
    return catalog.actions.length > 0;
  }

  async discover(): Promise<ActionCatalog> {
    const hasAaf = await this.page.evaluate(() => document.querySelectorAll('[data-agent-kind]').length > 0);
    if (hasAaf && this.discoveryMode !== 'inferred-only') {
      const actions = await this.page.evaluate(() => {
        const actionEls = document.querySelectorAll('[data-agent-kind="action"][data-agent-action]');
        const results: Array<{
          action: string;
          kind: 'action';
          danger?: string;
          confirm?: string;
          scope?: string;
          idempotent?: string;
          fields: Array<{ field: string; tagName: string; forAction?: string }>;
          statuses: Array<{ output: string; tagName: string }>;
          submitAction?: string;
          source: 'aaf';
        }> = [];
        const seen = new Set<string>();

        actionEls.forEach((el) => {
          const name = el.getAttribute('data-agent-action')!;
          if (name.split('.').length > 2 || seen.has(name)) return;
          seen.add(name);

          const fields: Array<{ field: string; tagName: string; forAction?: string }> = [];
          el.querySelectorAll('[data-agent-kind="field"]').forEach((f) => {
            fields.push({
              field: f.getAttribute('data-agent-field')!,
              tagName: f.tagName.toLowerCase(),
            });
          });
          document.querySelectorAll(`[data-agent-kind="field"][data-agent-for-action="${name}"]`).forEach((f) => {
            const fieldName = f.getAttribute('data-agent-field')!;
            if (!fields.some((x) => x.field === fieldName)) {
              fields.push({
                field: fieldName,
                tagName: f.tagName.toLowerCase(),
                forAction: name,
              });
            }
          });

          const statuses: Array<{ output: string; tagName: string }> = [];
          el.querySelectorAll('[data-agent-kind="status"]').forEach((s) => {
            statuses.push({
              output: s.getAttribute('data-agent-output')!,
              tagName: s.tagName.toLowerCase(),
            });
          });

          let submitAction: string | undefined;
          el.querySelectorAll('[data-agent-kind="action"]').forEach((sub) => {
            const subAction = sub.getAttribute('data-agent-action');
            if (subAction && subAction.startsWith(name + '.')) {
              submitAction = subAction;
            }
          });

          results.push({
            action: name,
            kind: 'action',
            danger: el.getAttribute('data-agent-danger') ?? undefined,
            confirm: el.getAttribute('data-agent-confirm') ?? undefined,
            scope: el.getAttribute('data-agent-scope') ?? undefined,
            idempotent: el.getAttribute('data-agent-idempotent') ?? undefined,
            fields,
            statuses,
            submitAction,
            source: 'aaf',
          });
        });

        return results;
      });

      const catalog = {
        actions,
        url: this.page.url(),
        timestamp: new Date().toISOString(),
        discoveryMode: 'aaf' as const,
      };
      this.lastCatalog = catalog;
      this.inferredExecutionMap.clear();
      return catalog;
    }

    if (!this.llmBackend) {
      const empty = { actions: [], url: this.page.url(), timestamp: new Date().toISOString() };
      this.lastCatalog = empty;
      this.inferredExecutionMap.clear();
      return empty;
    }

    const discoverer = new InferredActionDiscoverer(this.page, this.llmBackend, this.maxInteractiveNodes);
    const inferred = await discoverer.discover();
    this.lastCatalog = inferred.catalog;
    this.inferredExecutionMap = inferred.resolvedActions;
    return inferred.catalog;
  }

  validate(actionName: string, args: Record<string, unknown>, manifest?: AgentManifest): AAFValidationResult {
    const catalogAction = this.lastCatalog?.actions.find((action) => action.action === actionName);
    if (catalogAction?.source === 'inferred') {
      return this.validateInferred(catalogAction, args);
    }

    const m = manifest || this.manifest;
    if (!m) {
      return { valid: false, errors: [`No manifest available for action "${actionName}"`] };
    }
    try {
      const action = this.validator.getAction(m, actionName);
      const result = this.validator.validateInput(action, args);
      if (!result.valid) {
        return { valid: false, errors: result.errors };
      }

      // Check required fields
      const schema = action.inputSchema as { required?: string[] };
      if (schema.required) {
        const missing = schema.required.filter((f) => args[f] === undefined || args[f] === '');
        if (missing.length > 0) {
          return { valid: false, errors: [`Missing required fields: ${missing.join(', ')}`], missing_fields: missing };
        }
      }

      return { valid: true, errors: [] };
    } catch (err) {
      return { valid: false, errors: [(err as Error).message] };
    }
  }

  async execute(options: ExecuteOptions): Promise<ExecutionResult> {
    const { actionName, args, confirmed } = options;
    const manifest = options.manifest || this.manifest;
    if (!this.lastCatalog) {
      await this.discover();
    }

    const catalogAction = this.lastCatalog?.actions.find((action) => action.action === actionName);
    if (catalogAction?.source === 'inferred') {
      if (!this.allowInferredExecution) {
        return { status: 'execution_error', error: 'Inferred action execution is disabled' };
      }
      const validation = this.validate(actionName, args);
      if (!validation.valid) {
        if (validation.missing_fields?.length) {
          return { status: 'missing_required_fields', missing_fields: validation.missing_fields, error: validation.errors.join(', ') };
        }
        return { status: 'validation_error', error: validation.errors.join(', ') };
      }
      const resolved = this.inferredExecutionMap.get(actionName);
      if (!resolved) {
        return { status: 'execution_error', error: `Inferred action "${actionName}" is not available` };
      }
      return this.inferredExecutor.execute(this.page, resolved, args);
    }

    try {
      if (!manifest) {
        return { status: 'execution_error', error: `No manifest available for action "${actionName}"` };
      }
      const action = this.validator.getAction(manifest, actionName);

      // Coerce args before policy/validation
      const { args: coerced, coercions } = coerceArgs(args, action.inputSchema);

      // Check confirmation policy
      const policyResult = this.policy.checkExecution(action, {
        confirmed,
        requiredFields: coerced,
      });

      if (!policyResult.allowed) {
        if (action.risk === 'high' && action.confirmation === 'required' && !confirmed) {
          return {
            status: 'needs_confirmation',
            confirmation_metadata: {
              action: actionName,
              risk: action.risk,
              scope: action.scope,
              title: action.title,
            },
          };
        }

        // Check for missing required fields
        const schema = action.inputSchema as { required?: string[] };
        if (schema.required) {
          const missing = schema.required.filter((f) => coerced[f] === undefined || coerced[f] === '');
          if (missing.length > 0) {
            return {
              status: 'missing_required_fields',
              missing_fields: missing,
              error: policyResult.reason,
            };
          }
        }

        return { status: 'execution_error', error: policyResult.reason };
      }

      // Validate coerced input
      const validation = this.validate(actionName, coerced, manifest);
      if (!validation.valid) {
        if (validation.missing_fields) {
          return { status: 'missing_required_fields', missing_fields: validation.missing_fields, error: validation.errors.join(', ') };
        }
        return { status: 'validation_error', error: validation.errors.join(', ') };
      }

      // Execute via the wrapped ActionExecutor (input is coerced inside ActionExecutor too)
      const { status, log } = await this.executor.execute(this.page, {
        actionName,
        input: coerced,
        confirmed,
        baseUrl: this.baseUrl,
        manifest,
      });

      return { status: 'completed', result: status, log };
    } catch (err) {
      return { status: 'execution_error', error: (err as Error).message };
    }
  }

  private validateInferred(action: DiscoveredAction, args: Record<string, unknown>): AAFValidationResult {
    if (action.supported === false) {
      return { valid: false, errors: [action.unsupportedReason || 'Inferred action is not supported'] };
    }

    const fieldMap = new Map(action.fields.map((field) => [field.field, field]));
    const extraFields = Object.keys(args).filter((key) => !fieldMap.has(key));
    if (extraFields.length > 0) {
      return { valid: false, errors: [`Unknown fields: ${extraFields.join(', ')}`] };
    }

    const missing = action.fields
      .filter((field) => field.required && (args[field.field] === undefined || args[field.field] === ''))
      .map((field) => field.field);
    if (missing.length > 0) {
      return { valid: false, errors: [`Missing required fields: ${missing.join(', ')}`], missing_fields: missing };
    }

    for (const field of action.fields) {
      const value = args[field.field];
      if (value === undefined) continue;
      if (field.enumValues?.length && !field.enumValues.includes(String(value))) {
        return { valid: false, errors: [`Field "${field.field}" must be one of: ${field.enumValues.join(', ')}`] };
      }
      if ((field.schemaType === 'number' || field.controlType === 'number') && Number.isNaN(Number(value))) {
        return { valid: false, errors: [`Field "${field.field}" must be a number`] };
      }
      if ((field.format === 'email' || field.controlType === 'email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) {
        return { valid: false, errors: [`Field "${field.field}" must be an email`] };
      }
      if ((field.controlType === 'checkbox' || field.controlType === 'radio') && typeof value !== 'boolean' && typeof value !== 'string') {
        return { valid: false, errors: [`Field "${field.field}" must be a boolean or string`] };
      }
    }

    return { valid: true, errors: [] };
  }
}
