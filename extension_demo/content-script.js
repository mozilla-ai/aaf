(function installAafExtensionDemo() {
  if (window.__AAF_EXTENSION_DEMO_INSTALLED__) return;
  window.__AAF_EXTENSION_DEMO_INSTALLED__ = true;

  const ATTR = 'data-aaf-extension-id';
  let idCounter = 0;

  function nextId() {
    idCounter += 1;
    return `ext_${idCounter}`;
  }

  function ensureId(el) {
    const existing = el.getAttribute(ATTR);
    if (existing) return existing;
    const id = nextId();
    el.setAttribute(ATTR, id);
    return id;
  }

  function textOf(el) {
    if (!el || !el.textContent) return '';
    return el.textContent.replace(/\s+/g, ' ').trim().slice(0, 160);
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && el.getAttribute('aria-hidden') !== 'true'
      && !el.hasAttribute('hidden')
      && rect.width >= 0
      && rect.height >= 0;
  }

  function receivesPointerEvents(el) {
    return window.getComputedStyle(el).pointerEvents !== 'none';
  }

  function pointerCursor(el) {
    return window.getComputedStyle(el).cursor === 'pointer';
  }

  function elementBox(el) {
    const rect = el.getBoundingClientRect();
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }

  function slug(value) {
    return (value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/_+/g, '_');
  }

  function labelFor(el) {
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

    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      const text = textOf(label);
      if (text) return text;
    }

    const wrappingLabel = el.closest('label');
    const wrapped = textOf(wrappingLabel);
    if (wrapped) return wrapped;
    return '';
  }

  function inferControlType(el) {
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

  function collectRadioGroups() {
    const groups = [];
    const seen = new Set();

    const nativeGroups = new Map();
    for (const radio of Array.from(document.querySelectorAll('input[type="radio"]')).filter(isVisible)) {
      const name = (radio.getAttribute('name') || '').trim();
      if (!name) continue;
      const form = radio.closest('form');
      const key = `native::${form ? ensureId(form) : 'no-form'}::${name}`;
      const list = nativeGroups.get(key) || [];
      list.push(radio);
      nativeGroups.set(key, list);
    }

    const ariaGroups = new Map();
    for (const radio of Array.from(document.querySelectorAll('[role="radio"]')).filter(isVisible)) {
      const container = radio.closest('[role="radiogroup"]');
      if (!container) continue;
      const key = `aria::${ensureId(container)}`;
      const list = ariaGroups.get(key) || [];
      list.push(radio);
      ariaGroups.set(key, list);
    }

    function optionLabel(radio) {
      return labelFor(radio)
        || radio.getAttribute('aria-label')
        || textOf(radio.closest('label'))
        || textOf(radio.parentElement)
        || (radio.getAttribute('value') || '').trim();
    }

    function groupContainer(radios) {
      const first = radios[0];
      if (!first) return null;
      return first.closest('[role="radiogroup"], fieldset') || first.parentElement;
    }

    function groupLabel(container, radios) {
      return labelFor(container)
        || container.getAttribute('aria-label')
        || textOf(container.querySelector('legend, h1, h2, h3, h4, h5, h6'))
        || `Choose ${optionLabel(radios[0]) || 'option'}`;
    }

    for (const radioList of [...nativeGroups.values(), ...ariaGroups.values()]) {
      if (radioList.length < 2) continue;
      const container = groupContainer(radioList);
      if (!container || seen.has(container)) continue;
      seen.add(container);

      const options = [];
      const optionSelectors = {};
      for (const radio of radioList) {
        const name = optionLabel(radio);
        if (!name || optionSelectors[name]) continue;
        options.push(name);
        optionSelectors[name] = `[${ATTR}="${ensureId(radio)}"]`;
      }
      if (!options.length) continue;

      const form = container.closest('form');
      groups.push({
        elementId: ensureId(container),
        tagName: container.tagName.toLowerCase(),
        role: 'radiogroup',
        name: groupLabel(container, radioList),
        type: 'radio-group',
        required: radioList.some((radio) => radio.hasAttribute('required')),
        disabled: radioList.every((radio) => radio.hasAttribute('disabled') || radio.getAttribute('aria-disabled') === 'true'),
        options,
        optionSelectors,
        formId: form ? ensureId(form) : undefined,
        visible: true,
        receivesPointerEvents: radioList.some(receivesPointerEvents),
        pointerCursor: radioList.some(pointerCursor),
        box: elementBox(container),
        selector: `[${ATTR}="${ensureId(container)}"]`,
      });
    }

    return groups;
  }

  function collectInteractives(maxNodes = 150) {
    const selector = [
      'a[href]',
      'button',
      'input',
      'select',
      'textarea',
      '[role="button"]',
      '[role="link"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="switch"]',
      '[role="textbox"]',
      '[role="combobox"]',
    ].join(', ');

    const nodes = Array.from(document.querySelectorAll(selector))
      .filter(isVisible)
      .slice(0, maxNodes)
      .map((el) => {
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute('role')
          || (tag === 'a'
            ? 'link'
            : tag === 'button'
              ? 'button'
              : tag === 'select'
                ? 'combobox'
                : tag === 'textarea'
                  ? 'textbox'
                  : tag === 'input'
                    ? (el.getAttribute('type') || 'textbox')
                    : tag);
        const form = el.closest('form');
        const name = labelFor(el)
          || el.getAttribute('aria-label')
          || ((tag === 'button' || tag === 'a') ? textOf(el) : '')
          || el.getAttribute('placeholder')
          || '';
        const options = tag === 'select'
          ? Array.from(el.options || []).map((opt) => (opt.value || opt.textContent || '').trim()).filter(Boolean)
          : undefined;

        return {
          elementId: ensureId(el),
          tagName: tag,
          role,
          name,
          text: textOf(el),
          href: tag === 'a' ? el.getAttribute('href') || '' : '',
          type: inferControlType(el),
          required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
          disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
          checked: typeof el.checked === 'boolean' ? el.checked : el.getAttribute('aria-checked') === 'true',
          options,
          formId: form ? ensureId(form) : undefined,
          visible: true,
          receivesPointerEvents: receivesPointerEvents(el),
          pointerCursor: pointerCursor(el),
          box: elementBox(el),
          selector: `[${ATTR}="${ensureId(el)}"]`,
        };
      });

    return [...nodes, ...collectRadioGroups()];
  }

  function collectForms(interactives) {
    return Array.from(document.querySelectorAll('form')).map((form) => {
      const formId = ensureId(form);
      const fieldIds = interactives
        .filter((node) => node.formId === formId && (
          ['search', 'email', 'password', 'number', 'date', 'url', 'select', 'textarea', 'checkbox', 'radio', 'radio-group', 'textbox', 'combobox', 'radiogroup'].includes(node.role)
          || ['text', 'search', 'email', 'password', 'number', 'date', 'url', 'select', 'textarea', 'checkbox', 'radio', 'radio-group'].includes(node.type || '')
        ))
        .map((node) => node.elementId);
      const submitIds = interactives
        .filter((node) => node.formId === formId && (node.role === 'button' || node.role === 'link'))
        .filter((node) => /submit|search|sign in|log in|continue|save|apply|send|run|start|analy|check/i.test(`${node.name} ${node.text}`))
        .map((node) => node.elementId);
      return {
        formId,
        name: form.getAttribute('aria-label') || textOf(form.querySelector('h1, h2, h3, legend')),
        fieldIds,
        submitIds,
      };
    });
  }

  function buildSnapshot() {
    const interactives = collectInteractives();
    const forms = collectForms(interactives);
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
      .map((heading) => ({
        level: Number(heading.tagName.slice(1)),
        text: textOf(heading),
      }))
      .filter((item) => item.text)
      .slice(0, 40);
    const landmarks = Array.from(document.querySelectorAll('main, nav, aside, header, footer, section, [role]'))
      .map((el) => ({
        role: el.getAttribute('role') || el.tagName.toLowerCase(),
        name: el.getAttribute('aria-label') || textOf(el.querySelector('h1, h2, h3')),
      }))
      .filter((item) => ['main', 'nav', 'aside', 'header', 'footer', 'search', 'form', 'navigation', 'region', 'complementary'].includes(item.role))
      .slice(0, 20);
    const pageTextSummary = Array.from(document.querySelectorAll('body *'))
      .map((el) => textOf(el))
      .filter(Boolean)
      .slice(0, 60)
      .join(' ');

    return {
      url: window.location.href,
      title: document.title || '',
      headings,
      landmarks,
      forms,
      interactives,
      pageTextSummary,
    };
  }

  function dispatchTextInput(el, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (nativeSetter && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      nativeSetter.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setCheckboxLike(el, desired) {
    if (typeof el.checked === 'boolean') {
      el.checked = desired;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if (desired) el.click();
  }

  function resolveElementById(elementId) {
    if (!elementId) return null;
    return document.querySelector(`[${ATTR}="${CSS.escape(elementId)}"]`);
  }

  function explicitAafActions() {
    const roots = Array.from(document.querySelectorAll('[data-agent-kind="action"][data-agent-action]'));
    const seen = new Set();
    const actions = [];

    for (const root of roots) {
      const actionName = root.getAttribute('data-agent-action') || '';
      if (!actionName || actionName.split('.').length > 2 || seen.has(actionName)) continue;
      seen.add(actionName);

      const fields = [];
      const fieldEls = root.querySelectorAll('[data-agent-kind="field"], [data-agent-for-action]');
      for (const fieldEl of fieldEls) {
        const fieldName = fieldEl.getAttribute('data-agent-field');
        if (!fieldName || fields.some((item) => item.field === fieldName)) continue;
        const controlType = inferControlType(fieldEl);
        const options = controlType === 'select'
          ? Array.from(fieldEl.querySelectorAll('option')).map((opt) => (opt.getAttribute('value') || textOf(opt))).filter(Boolean)
          : undefined;
        fields.push({
          field: fieldName,
          elementId: ensureId(fieldEl),
          controlType,
          label: labelFor(fieldEl) || fieldName,
          required: fieldEl.hasAttribute('required') || fieldEl.getAttribute('aria-required') === 'true',
          options,
          optionSelectors: fieldEl.getAttribute('role') === 'radiogroup' ? collectRadioGroups().find((group) => group.elementId === ensureId(fieldEl))?.optionSelectors : undefined,
        });
      }

      actions.push({
        action: actionName,
        title: textOf(root) || actionName,
        description: `Explicit AAF action declared on the page.`,
        source: 'aaf',
        supported: true,
        targetElementId: ensureId(root),
        fields,
      });
    }

    return actions;
  }

  function inferFormAction(form, snapshot) {
    const fieldNodes = form.fieldIds
      .map((id) => snapshot.interactives.find((node) => node.elementId === id))
      .filter(Boolean);
    if (!fieldNodes.length) return null;

    const submit = snapshot.interactives.find((node) => form.submitIds.includes(node.elementId))
      || snapshot.interactives.find((node) => node.formId === form.formId && (node.role === 'button' || node.role === 'link'));
    const submitText = `${submit?.name || ''} ${submit?.text || ''}`.trim();
    const textBlob = `${form.name || ''} ${submitText} ${fieldNodes.map((node) => `${node.name} ${node.type}`).join(' ')}`.toLowerCase();

    let action = '';
    let title = submitText || form.name || 'Submit form';
    let description = form.name
      ? `Form action inferred from "${form.name}".`
      : 'Form action inferred from the current page.';

    const hasSearch = fieldNodes.some((node) => node.type === 'search' || /search/.test(`${node.name} ${node.text}`));
    const hasEmail = fieldNodes.some((node) => node.type === 'email');
    const hasPassword = fieldNodes.some((node) => node.type === 'password');
    const hasUrl = fieldNodes.some((node) => node.type === 'url');

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
      source: 'heuristic',
      supported: Boolean(submit),
      targetElementId: submit?.elementId,
      fields: fieldNodes.map((node) => ({
        field: slug(node.name || node.elementId) || node.elementId,
        elementId: node.elementId,
        controlType: node.type || 'text',
        label: node.name || node.elementId,
        required: Boolean(node.required),
        options: node.options,
        optionSelectors: node.optionSelectors,
      })),
    };
  }

  function inferStandaloneActions(snapshot) {
    const candidates = snapshot.interactives
      .filter((node) => !node.formId && (node.role === 'button' || node.role === 'link'))
      .filter((node) => Boolean(node.name || node.text))
      .slice(0, 12);

    const actions = [];
    const seen = new Set();

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
        fields: [],
      });
    }

    return actions;
  }

  function heuristicDiscovery(snapshot) {
    const formActions = snapshot.forms
      .map((form) => inferFormAction(form, snapshot))
      .filter(Boolean);
    const actions = [...formActions, ...inferStandaloneActions(snapshot)];
    const deduped = [];
    const seen = new Set();
    for (const action of actions) {
      if (!action.action || seen.has(action.action)) continue;
      seen.add(action.action);
      deduped.push(action);
    }

    return {
      url: snapshot.url,
      title: snapshot.title,
      discoveryMode: 'heuristic',
      pageContext: {
        summary: snapshot.pageTextSummary.slice(0, 280),
      },
      actions: deduped,
      snapshot,
    };
  }

  function discoverPage() {
    const explicitActions = explicitAafActions();
    if (explicitActions.length > 0) {
      return {
        url: window.location.href,
        title: document.title || '',
        discoveryMode: 'aaf',
        pageContext: {
          summary: 'Explicit AAF actions discovered from page annotations.',
        },
        actions: explicitActions,
        snapshot: buildSnapshot(),
      };
    }

    return heuristicDiscovery(buildSnapshot());
  }

  function executeAafAction(action, args) {
    const root = document.querySelector(`[data-agent-kind="action"][data-agent-action="${action.action}"]`);
    if (!root) {
      return { status: 'execution_error', error: `AAF action "${action.action}" not found on page.` };
    }

    const executionDetails = [];
    for (const field of action.fields || []) {
      const value = args[field.field];
      if (value === undefined) continue;

      let fieldEl = root.querySelector(`[data-agent-kind="field"][data-agent-field="${field.field}"]`);
      if (!fieldEl) {
        fieldEl = document.querySelector(`[data-agent-kind="field"][data-agent-field="${field.field}"][data-agent-for-action="${action.action}"]`);
      }
      if (!fieldEl) continue;

      if (field.controlType === 'select') {
        fieldEl.value = String(value);
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
      return { status: 'execution_error', error: `Click target for "${action.action}" not found.` };
    }
    clickTarget.click();
    executionDetails.push(`clicked target -> ${textOf(clickTarget) || action.action}`);
    return { status: 'completed', executionDetails };
  }

  function executeGroundedAction(action, args) {
    const executionDetails = [];

    for (const field of action.fields || []) {
      const value = args[field.field];
      if (value === undefined) continue;
      const el = resolveElementById(field.elementId);
      if (!el) {
        return { status: 'execution_error', error: `Field "${field.field}" is no longer available on the page.` };
      }

      if (field.controlType === 'select') {
        el.value = String(value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        executionDetails.push(`filled ${field.field} -> ${JSON.stringify(String(value))}`);
      } else if (field.controlType === 'radio-group') {
        const desired = String(value).trim().toLowerCase();
        const optionEntries = Object.entries(field.optionSelectors || {});
        const match = optionEntries.find(([label]) => label.trim().toLowerCase() === desired)
          || optionEntries.find(([label]) => label.trim().toLowerCase().includes(desired) || desired.includes(label.trim().toLowerCase()));
        if (!match) {
          return { status: 'validation_error', error: `Could not resolve option ${JSON.stringify(String(value))} for "${field.field}".` };
        }
        const optionEl = document.querySelector(match[1]);
        if (!(optionEl instanceof HTMLElement)) {
          return { status: 'execution_error', error: `Radio option target for "${field.field}" is no longer available.` };
        }
        if (typeof optionEl.checked === 'boolean') {
          optionEl.checked = true;
          optionEl.dispatchEvent(new Event('input', { bubbles: true }));
          optionEl.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          optionEl.click();
        }
        executionDetails.push(`selected ${field.field} -> ${JSON.stringify(match[0])}`);
      } else if (field.controlType === 'checkbox' || field.controlType === 'radio') {
        setCheckboxLike(el, typeof value === 'boolean' ? value : String(value).toLowerCase() !== 'false');
        executionDetails.push(`set ${field.field}`);
      } else {
        dispatchTextInput(el, String(value));
        executionDetails.push(`filled ${field.field} -> ${JSON.stringify(String(value))}`);
      }
    }

    const target = resolveElementById(action.targetElementId);
    if (target instanceof HTMLElement) {
      target.click();
      executionDetails.push(`clicked target -> ${textOf(target) || action.action}`);
      return { status: 'completed', executionDetails };
    }

    const firstField = action.fields?.[0] ? resolveElementById(action.fields[0].elementId) : null;
    if (firstField instanceof HTMLElement && action.action === 'search.submit') {
      firstField.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      firstField.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));
      firstField.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
      executionDetails.push('pressed Enter fallback on primary field');
      return { status: 'completed', executionDetails };
    }

    return {
      status: 'awaiting_review',
      executionDetails: [...executionDetails, 'submit target unresolved; fields filled for manual review'],
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    try {
      if (message?.type === 'AAF_EXTENSION_PING') {
        sendResponse({ ok: true });
        return;
      }
      if (message?.type === 'AAF_EXTENSION_DISCOVER') {
        sendResponse(discoverPage());
        return;
      }
      if (message?.type === 'AAF_EXTENSION_GET_SNAPSHOT') {
        sendResponse(buildSnapshot());
        return;
      }
      if (message?.type === 'AAF_EXTENSION_EXECUTE') {
        const action = message.action;
        const args = message.args && typeof message.args === 'object' ? message.args : {};
        if (!action || typeof action.action !== 'string') {
          sendResponse({ error: 'No action payload was provided.' });
          return;
        }
        const result = action.source === 'aaf'
          ? executeAafAction(action, args)
          : executeGroundedAction(action, args);
        sendResponse(result);
        return;
      }
    } catch (error) {
      sendResponse({ error: error instanceof Error ? error.message : String(error) });
    }
  });
})();
