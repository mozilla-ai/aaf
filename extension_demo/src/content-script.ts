import {
  DEFAULT_ELEMENT_ATTR_NAME,
  buildSnapshot,
  executeGroundedAction,
  type BrowserActionCatalog,
  type BrowserDiscoverySnapshot,
} from '@agent-accessibility-framework/browser-actions';

declare global {
  interface Window {
    __AAF_EXTENSION_DEMO_INSTALLED__?: boolean;
  }
}

function installAafExtensionDemo() {
  if (window.__AAF_EXTENSION_DEMO_INSTALLED__) return;
  window.__AAF_EXTENSION_DEMO_INSTALLED__ = true;

  function textOf(el: Element | Node | null | undefined): string {
    if (!el || !('textContent' in el) || !el.textContent) return '';
    return el.textContent.replace(/\s+/g, ' ').trim().slice(0, 160);
  }

  function cssEscape(value: string): string {
    if (window.CSS?.escape) return window.CSS.escape(value);
    return value.replace(/["\\\]]/g, '\\$&');
  }

  function ensureLocalId(el: Element): string {
    const existing = el.getAttribute(DEFAULT_ELEMENT_ATTR_NAME);
    if (existing) return existing;
    const existingIds = Array.from(document.querySelectorAll(`[${DEFAULT_ELEMENT_ATTR_NAME}]`))
      .map((node) => node.getAttribute(DEFAULT_ELEMENT_ATTR_NAME) || '')
      .map((value) => /^ext_(\d+)$/.exec(value)?.[1])
      .map((value) => (value ? Number(value) : 0));
    const next = (existingIds.length > 0 ? Math.max(...existingIds) : 0) + 1;
    const id = `ext_${next}`;
    el.setAttribute(DEFAULT_ELEMENT_ATTR_NAME, id);
    return id;
  }

  function labelFor(el: Element): string {
    const aria = el.getAttribute('aria-label');
    if (aria) return aria.trim();

    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => textOf(document.getElementById(id)))
        .filter(Boolean)
        .join(' ');
      if (text) return text;
    }

    if ((el as HTMLInputElement).id) {
      const label = document.querySelector(`label[for="${cssEscape((el as HTMLInputElement).id)}"]`);
      const text = textOf(label);
      if (text) return text;
    }

    const wrappingLabel = el.closest('label');
    const wrapped = textOf(wrappingLabel);
    if (wrapped) return wrapped;
    return '';
  }

  function inferControlType(el: Element): string {
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'textarea';
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (['search', 'email', 'password', 'number', 'date', 'url', 'checkbox', 'radio'].includes(type)) return type;
      return 'text';
    }
    if (el.getAttribute('role') === 'radiogroup') return 'radio-group';
    return 'text';
  }

  function dispatchTextInput(el: Element, value: string) {
    const nativeSetter = el instanceof HTMLInputElement
      ? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      : el instanceof HTMLTextAreaElement
        ? Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        : undefined;
    if (nativeSetter && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      nativeSetter.call(el, value);
    } else if ('value' in (el as HTMLInputElement)) {
      (el as HTMLInputElement).value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setCheckboxLike(el: Element, desired: boolean) {
    if (typeof (el as HTMLInputElement).checked === 'boolean') {
      (el as HTMLInputElement).checked = desired;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if (desired && el instanceof HTMLElement) el.click();
  }

  function explicitAafActions(snapshot: BrowserDiscoverySnapshot): BrowserActionCatalog['actions'] {
    const roots = Array.from(document.querySelectorAll('[data-agent-kind="action"][data-agent-action]'));
    const seen = new Set<string>();
    const actions: BrowserActionCatalog['actions'] = [];

    for (const root of roots) {
      const actionName = root.getAttribute('data-agent-action') || '';
      if (!actionName || actionName.split('.').length > 2 || seen.has(actionName)) continue;
      seen.add(actionName);

      const fields = [];
      const fieldEls = root.querySelectorAll('[data-agent-kind="field"], [data-agent-for-action]');
      for (const fieldEl of fieldEls) {
        const fieldName = fieldEl.getAttribute('data-agent-field');
        if (!fieldName || fields.some((item) => item.field === fieldName)) continue;
        const fieldId = ensureLocalId(fieldEl);
        const controlType = inferControlType(fieldEl);
        const options = controlType === 'select'
          ? Array.from(fieldEl.querySelectorAll('option')).map((opt) => (opt.getAttribute('value') || textOf(opt))).filter(Boolean)
          : undefined;
        const snapshotNode = snapshot.interactives.find((node) => node.elementId === fieldId);
        fields.push({
          field: fieldName,
          elementId: fieldId,
          selector: `[${DEFAULT_ELEMENT_ATTR_NAME}="${fieldId}"]`,
          controlType,
          label: labelFor(fieldEl) || fieldName,
          required: fieldEl.hasAttribute('required') || fieldEl.getAttribute('aria-required') === 'true',
          options,
          optionSelectors: snapshotNode?.optionSelectors,
        });
      }

      const rootId = ensureLocalId(root);
      actions.push({
        action: actionName,
        title: textOf(root) || actionName,
        description: 'Explicit AAF action declared on the page.',
        source: 'aaf',
        supported: true,
        targetElementId: rootId,
        targetSelectors: [`[${DEFAULT_ELEMENT_ATTR_NAME}="${rootId}"]`],
        elementAttribute: DEFAULT_ELEMENT_ATTR_NAME,
        fields,
      });
    }

    return actions;
  }

  function slug(value: string) {
    return (value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/_+/g, '_');
  }

  function inferFormAction(form: BrowserDiscoverySnapshot['forms'][number], snapshot: BrowserDiscoverySnapshot) {
    const fieldNodes = form.fieldIds
      .map((id) => snapshot.interactives.find((node) => node.elementId === id))
      .filter(Boolean);
    if (!fieldNodes.length) return null;

    const submit = snapshot.interactives.find((node) => form.submitIds.includes(node.elementId))
      || snapshot.interactives.find((node) => node.formId === form.formId && (node.role === 'button' || node.role === 'link'));
    const submitText = `${submit?.name || ''} ${submit?.text || ''}`.trim();
    const textBlob = `${form.name || ''} ${submitText} ${fieldNodes.map((node) => `${node?.name} ${node?.type}`).join(' ')}`.toLowerCase();

    let action = '';
    let title = submitText || form.name || 'Submit form';
    let description = form.name
      ? `Form action inferred from "${form.name}".`
      : 'Form action inferred from the current page.';

    const hasSearch = fieldNodes.some((node) => node?.type === 'search' || /search/.test(`${node?.name} ${node?.text}`));
    const hasEmail = fieldNodes.some((node) => node?.type === 'email');
    const hasPassword = fieldNodes.some((node) => node?.type === 'password');
    const hasUrl = fieldNodes.some((node) => node?.type === 'url');

    if (hasSearch || /search/.test(textBlob)) {
      action = 'search.submit';
      title = 'Search';
      description = 'Search form inferred from the page.';
    } else if (hasEmail && hasPassword && /(sign in|log in|login)/.test(textBlob)) {
      action = 'auth.login';
      title = 'Sign in';
      description = 'Login form inferred from the page.';
    } else if (hasEmail && hasPassword && /(sign up|register|create account)/.test(textBlob)) {
      action = 'auth.register';
      title = 'Register';
      description = 'Registration form inferred from the page.';
    } else if (/(filter|apply)/.test(textBlob)) {
      action = 'filters.apply';
      title = 'Apply filters';
      description = 'Filter form inferred from the page.';
    } else if (hasUrl && /(analy|check|scan|run|start)/.test(textBlob)) {
      action = 'website.run_analysis';
      title = submitText || 'Run analysis';
      description = 'URL-driven analysis form inferred from the page.';
    } else if (/(subscribe|newsletter)/.test(textBlob)) {
      action = 'newsletter.subscribe';
      title = submitText || 'Subscribe';
      description = 'Subscription form inferred from the page.';
    } else {
      action = `form.${slug(submitText || form.name || 'submit') || 'submit'}`;
    }

    return {
      action,
      title,
      description,
      source: 'heuristic' as const,
      supported: Boolean(submit),
      targetElementId: submit?.elementId,
      targetSelectors: submit?.selector ? [submit.selector] : [],
      elementAttribute: snapshot.elementAttribute,
      fields: fieldNodes.map((node) => ({
        field: slug(node?.name || node?.elementId || '') || node?.elementId || 'field',
        elementId: node?.elementId || 'field',
        selector: node?.selector,
        controlType: (node?.type || 'text') as never,
        label: node?.name || node?.elementId,
        required: Boolean(node?.required),
        options: node?.options,
        optionSelectors: node?.optionSelectors,
      })),
    };
  }

  function inferStandaloneActions(snapshot: BrowserDiscoverySnapshot) {
    const candidates = snapshot.interactives
      .filter((node) => !node.formId && (node.role === 'button' || node.role === 'link'))
      .filter((node) => Boolean(node.name || node.text))
      .slice(0, 12);

    const actions: BrowserActionCatalog['actions'] = [];
    const seen = new Set<string>();

    for (const node of candidates) {
      const label = (node.name || node.text || '').trim();
      const lower = label.toLowerCase();
      let action = '';
      let description = 'Standalone action inferred from a visible control.';

      if (/(sign in|log in|login)/.test(lower)) action = 'auth.login';
      else if (/(sign up|register|create account)/.test(lower)) action = 'auth.register';
      else if (/pricing/.test(lower)) action = 'billing.view_pricing';
      else if (/api/.test(lower)) action = 'docs.view_api';
      else if (/docs|documentation/.test(lower)) action = 'docs.view';
      else if (/cart/.test(lower)) action = 'cart.view';
      else if (/account/.test(lower)) action = 'account.view';
      else if (node.role === 'link') action = `page.open_${slug(label) || 'link'}`;
      else action = `page.act_${slug(label) || 'action'}`;

      if (seen.has(action)) continue;
      seen.add(action);
      actions.push({
        action,
        title: label,
        description,
        source: 'heuristic',
        supported: true,
        targetElementId: node.elementId,
        targetSelectors: node.selector ? [node.selector] : [],
        elementAttribute: snapshot.elementAttribute,
        fields: [],
      });
    }

    return actions;
  }

  function heuristicDiscovery(snapshot: BrowserDiscoverySnapshot): BrowserActionCatalog {
    const formActions = snapshot.forms
      .map((form) => inferFormAction(form, snapshot))
      .filter(Boolean);
    const actions = [...formActions, ...inferStandaloneActions(snapshot)];
    const deduped: BrowserActionCatalog['actions'] = [];
    const seen = new Set<string>();
    for (const action of actions) {
      if (!action?.action || seen.has(action.action)) continue;
      seen.add(action.action);
      deduped.push(action);
    }

    return {
      url: snapshot.url,
      title: snapshot.title,
      discoveryMode: 'heuristic',
      pageContext: {
        siteType: 'unknown',
        pageType: 'unknown',
        summary: snapshot.pageTextSummary.slice(0, 280),
        confidence: 0,
      },
      actions: deduped,
      snapshot,
    };
  }

  function discoverPage() {
    const snapshot = buildSnapshot(document);
    const explicitActions = explicitAafActions(snapshot);
    if (explicitActions.length > 0) {
      return {
        url: window.location.href,
        title: document.title || '',
        discoveryMode: 'aaf' as const,
        pageContext: {
          siteType: 'aaf',
          pageType: 'annotated_page',
          summary: 'Explicit AAF actions discovered from page annotations.',
          confidence: 1,
        },
        actions: explicitActions,
        snapshot,
      };
    }

    return heuristicDiscovery(snapshot);
  }

  function executeAafAction(action: BrowserActionCatalog['actions'][number], args: Record<string, unknown>) {
    const root = document.querySelector(`[data-agent-kind="action"][data-agent-action="${action.action}"]`);
    if (!root) {
      return { status: 'execution_error' as const, error: `AAF action "${action.action}" not found on page.` };
    }

    const executionDetails: string[] = [];
    for (const field of action.fields || []) {
      const value = args[field.field];
      if (value === undefined) continue;

      let fieldEl = root.querySelector(`[data-agent-kind="field"][data-agent-field="${field.field}"]`);
      if (!fieldEl) {
        fieldEl = document.querySelector(`[data-agent-kind="field"][data-agent-field="${field.field}"][data-agent-for-action="${action.action}"]`);
      }
      if (!fieldEl) continue;

      if (field.controlType === 'select') {
        (fieldEl as HTMLSelectElement).value = String(value);
        fieldEl.dispatchEvent(new Event('input', { bubbles: true }));
        fieldEl.dispatchEvent(new Event('change', { bubbles: true }));
        executionDetails.push(`filled ${field.field} -> ${JSON.stringify(String(value))}`);
      } else if (field.controlType === 'checkbox' || field.controlType === 'radio') {
        setCheckboxLike(fieldEl, typeof value === 'boolean' ? value : String(value).toLowerCase() !== 'false');
        executionDetails.push(`set ${field.field}`);
      } else {
        dispatchTextInput(fieldEl, String(value));
        executionDetails.push(`filled ${field.field} -> ${JSON.stringify(String(value))}`);
      }
    }

    const nestedSubmit = root.querySelector('[data-agent-kind="action"][data-agent-action]');
    const clickTarget = nestedSubmit || root;
    if (!(clickTarget instanceof HTMLElement)) {
      return { status: 'execution_error' as const, error: `Click target for "${action.action}" not found.` };
    }
    clickTarget.click();
    executionDetails.push(`clicked target -> ${textOf(clickTarget) || action.action}`);
    return { status: 'completed' as const, executionDetails };
  }

  chrome.runtime.onMessage.addListener((message: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
    try {
      const incoming = message as { type?: string; action?: BrowserActionCatalog['actions'][number]; args?: Record<string, unknown> } | undefined;
      if (incoming?.type === 'AAF_EXTENSION_PING') {
        sendResponse({ ok: true });
        return;
      }
      if (incoming?.type === 'AAF_EXTENSION_DISCOVER') {
        sendResponse(discoverPage());
        return;
      }
      if (incoming?.type === 'AAF_EXTENSION_GET_SNAPSHOT') {
        sendResponse(buildSnapshot(document));
        return;
      }
      if (incoming?.type === 'AAF_EXTENSION_EXECUTE') {
        const action = incoming.action;
        const args = incoming.args && typeof incoming.args === 'object' ? incoming.args : {};
        if (!action || typeof action.action !== 'string') {
          sendResponse({ error: 'No action payload was provided.' });
          return;
        }
        const result = action.source === 'aaf'
          ? executeAafAction(action, args)
          : executeGroundedAction(document, action, args);
        sendResponse(result);
      }
    } catch (error) {
      sendResponse({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}

installAafExtensionDemo();
