import type { Page } from '@playwright/test';
import type { DiscoverySnapshot } from './inference-prompt.js';

const DOM_SNAPSHOT_SCRIPT = String.raw`
(maxNodes) => {
  const ATTR = 'data-aaf-inferred-id';
  let counter = 0;

  function nextId() {
    counter += 1;
    return 'el_' + counter;
  }

  function ensureId(el) {
    const existing = el.getAttribute(ATTR);
    if (existing)
      return existing;
    const id = nextId();
    el.setAttribute(ATTR, id);
    return id;
  }

  function textOf(el) {
    if (!el || !el.textContent)
      return undefined;
    const text = el.textContent.replace(/\s+/g, ' ').trim();
    return text ? text.slice(0, 120) : undefined;
  }

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && !el.hasAttribute('hidden')
      && el.getAttribute('aria-hidden') !== 'true'
      && rect.width >= 0
      && rect.height >= 0;
  }

  function getHeading(el) {
    const container = el.closest('section, article, form, dialog, [role="dialog"], main, aside');
    const heading = container ? container.querySelector('h1, h2, h3, h4, h5, h6') : null;
    return textOf(heading);
  }

  function getLandmark(el) {
    const landmark = el.closest('main, nav, aside, header, footer, form, section, [role="main"], [role="navigation"], [role="complementary"], [role="search"], [role="form"]');
    if (!landmark)
      return undefined;
    const role = landmark.getAttribute('role') || landmark.tagName.toLowerCase();
    const name = landmark.getAttribute('aria-label') || textOf(landmark.querySelector('h1, h2, h3'));
    return name ? role + ':' + name : role;
  }

  function labelFor(el) {
    const aria = el.getAttribute('aria-label');
    if (aria)
      return aria.trim();
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => textOf(document.getElementById(id)))
        .filter(Boolean)
        .join(' ');
      if (text)
        return text;
    }
    if (el.id) {
      const label = document.querySelector('label[for="' + el.id + '"]');
      const labelText = textOf(label);
      if (labelText)
        return labelText;
    }
    const wrapping = el.closest('label');
    const wrapText = textOf(wrapping);
    if (wrapText)
      return wrapText;
    return undefined;
  }

  const interactiveSelector = [
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
    '[role="combobox"]'
  ].join(', ');

  const interactives = Array.from(document.querySelectorAll(interactiveSelector))
    .filter((el) => isVisible(el))
    .slice(0, maxNodes)
    .map((el) => {
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute('role')
        || (tag === 'a' ? 'link' : tag === 'button' ? 'button' : tag === 'select' ? 'combobox' : tag === 'textarea' ? 'textbox' : tag === 'input' ? (el.type || 'textbox') : tag);
      const form = el.closest('form');
      const options = tag === 'select'
        ? Array.from(el.options).map((opt) => opt.value || opt.textContent || '').filter(Boolean)
        : undefined;
      const type = tag === 'input' ? (el.type || 'text') : tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : undefined;
      const text = textOf(el);
      const name = labelFor(el) || el.getAttribute('aria-label') || ((tag === 'button' || tag === 'a') ? text : undefined) || el.getAttribute('placeholder') || undefined;
      const heading = getHeading(el);
      const landmark = getLandmark(el);
      return {
        elementId: ensureId(el),
        role,
        ...(name ? { name } : {}),
        ...(text ? { text } : {}),
        ...(tag === 'a' && el.getAttribute('href') ? { href: el.getAttribute('href') || undefined } : {}),
        ...(type ? { type } : {}),
        required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
        disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
        checked: ('checked' in el) ? Boolean(el.checked) : el.getAttribute('aria-checked') === 'true',
        ...(options && options.length > 0 ? { options } : {}),
        ...(form ? { formId: ensureId(form) } : {}),
        ...(heading ? { heading } : {}),
        ...(landmark ? { landmark } : {}),
        visible: true,
        selector: '[' + ATTR + '="' + ensureId(el) + '"]',
      };
    });

  const forms = Array.from(document.querySelectorAll('form')).map((form) => {
    const formId = ensureId(form);
    const fieldIds = interactives
      .filter((node) => node.formId === formId && (
        ['input', 'search', 'email', 'password', 'number', 'date', 'select', 'textarea', 'checkbox', 'radio', 'textbox', 'combobox', 'switch'].includes(node.role)
        || ['text', 'search', 'email', 'password', 'number', 'date', 'select', 'textarea', 'checkbox', 'radio'].includes(node.type || '')
      ))
      .map((node) => node.elementId);
    const submitIds = interactives
      .filter((node) => node.formId === formId
        && (node.role === 'button' || node.role === 'link')
        && /submit|search|sign in|log in|continue|save|apply|send/i.test((node.name || '') + ' ' + (node.text || '')))
      .map((node) => node.elementId);
    const heading = textOf(form.querySelector('h1, h2, h3, h4, h5, h6'));
    const name = form.getAttribute('aria-label') || heading;
    return Object.assign({ formId, fieldIds, submitIds }, name ? { name } : {}, heading ? { heading } : {});
  });

  const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
    .map((heading) => ({
      level: Number(heading.tagName.slice(1)),
      text: (heading.textContent || '').replace(/\s+/g, ' ').trim(),
    }))
    .filter((heading) => heading.text)
    .slice(0, 40);

  const landmarks = Array.from(document.querySelectorAll('main, nav, aside, header, footer, section, [role]'))
    .map((el) => {
      const role = el.getAttribute('role') || el.tagName.toLowerCase();
      const name = el.getAttribute('aria-label') || textOf(el.querySelector('h1, h2, h3'));
      return Object.assign({ role }, name ? { name } : {});
    })
    .filter((landmark) => ['main', 'nav', 'aside', 'header', 'footer', 'search', 'form', 'navigation', 'complementary', 'region'].includes(landmark.role))
    .slice(0, 20);

  const pageTextSummary = Array.from(document.querySelectorAll('body *'))
    .map((el) => textOf(el))
    .filter(Boolean)
    .filter((text, index, arr) => arr.indexOf(text) === index)
    .join(' ')
    .slice(0, 3000);

  return {
    url: window.location.href,
    title: document.title,
    headings,
    landmarks,
    forms,
    interactives,
    pageTextSummary,
  };
}
`;

export async function extractDomSnapshot(page: Page, maxInteractiveNodes = 150): Promise<Omit<DiscoverySnapshot, 'a11ySummary'>> {
  return page.evaluate(
    ({ script, maxNodes }) => {
      const fn = globalThis.eval(script);
      return fn(maxNodes);
    },
    { script: DOM_SNAPSHOT_SCRIPT, maxNodes: maxInteractiveNodes },
  );
}
