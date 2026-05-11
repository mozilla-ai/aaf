import {
  DEFAULT_ELEMENT_ATTR_NAME,
  type BrowserCollectionCandidate,
  type BrowserDiscoverySnapshot,
  type BrowserInteractiveNode,
  type BrowserFormSummary,
  type BuildSnapshotOptions,
} from './types.js';

interface DomContext {
  document: Document;
  attrName: string;
  counter: { value: number };
}

function cssEscape(value: string, doc: Document): string {
  const win = doc.defaultView;
  if (win?.CSS?.escape) return win.CSS.escape(value);
  return value.replace(/["\\\]]/g, '\\$&');
}

function createDomContext(document: Document, attrName: string): DomContext {
  const existing = Array.from(document.querySelectorAll(`[${attrName}]`))
    .map((el) => el.getAttribute(attrName) || '')
    .map((value) => /^ext_(\d+)$/.exec(value)?.[1])
    .map((value) => (value ? Number(value) : 0));
  const maxExisting = existing.length > 0 ? Math.max(...existing) : 0;
  return {
    document,
    attrName,
    counter: { value: Number.isFinite(maxExisting) ? maxExisting : 0 },
  };
}

function nextId(ctx: DomContext): string {
  ctx.counter.value += 1;
  return `ext_${ctx.counter.value}`;
}

function ensureId(ctx: DomContext, el: Element): string {
  const existing = el.getAttribute(ctx.attrName);
  if (existing) return existing;
  const id = nextId(ctx);
  el.setAttribute(ctx.attrName, id);
  return id;
}

function textOf(el: Element | Node | null | undefined): string {
  if (!el || !('textContent' in el) || !el.textContent) return '';
  return el.textContent.replace(/\s+/g, ' ').trim().slice(0, 160);
}

function normalizedText(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function isVisible(el: Element): boolean {
  const win = el.ownerDocument.defaultView;
  if (!win) return true;
  const style = win.getComputedStyle(el);
  const rect = (el as HTMLElement).getBoundingClientRect?.();
  return style.display !== 'none'
    && style.visibility !== 'hidden'
    && el.getAttribute('aria-hidden') !== 'true'
    && !el.hasAttribute('hidden')
    && (!rect || (rect.width >= 0 && rect.height >= 0));
}

function receivesPointerEvents(el: Element): boolean {
  const win = el.ownerDocument.defaultView;
  return win ? win.getComputedStyle(el).pointerEvents !== 'none' : true;
}

function pointerCursor(el: Element): boolean {
  const win = el.ownerDocument.defaultView;
  return win ? win.getComputedStyle(el).cursor === 'pointer' : false;
}

function elementBox(el: Element) {
  const rect = (el as HTMLElement).getBoundingClientRect?.();
  return {
    x: Math.round(rect?.left || 0),
    y: Math.round(rect?.top || 0),
    width: Math.round(rect?.width || 0),
    height: Math.round(rect?.height || 0),
  };
}

function labelFor(ctx: DomContext, el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria.trim();

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => textOf(ctx.document.getElementById(id)))
      .filter(Boolean)
      .join(' ');
    if (text) return text;
  }

  if ((el as HTMLInputElement).id) {
    const label = ctx.document.querySelector(`label[for="${cssEscape((el as HTMLInputElement).id, ctx.document)}"]`);
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

function itemTitle(el: Element): string {
  const preferred = el.querySelector('h1, h2, h3, h4, h5, h6, [data-title], strong, b');
  const preferredText = textOf(preferred);
  if (preferredText) return preferredText;
  return textOf(el);
}

function getHeading(el: Element): string {
  const container = el.closest('section, article, form, dialog, [role="dialog"], main, aside');
  const heading = container ? container.querySelector('h1, h2, h3, h4, h5, h6') : null;
  return textOf(heading);
}

function getLandmark(el: Element): string {
  const landmark = el.closest('main, nav, aside, header, footer, form, section, [role="main"], [role="navigation"], [role="complementary"], [role="search"], [role="form"]');
  if (!landmark) return '';
  const role = landmark.getAttribute('role') || landmark.tagName.toLowerCase();
  const name = landmark.getAttribute('aria-label') || textOf(landmark.querySelector('h1, h2, h3'));
  return name ? `${role}:${name}` : role;
}

function collectionLabel(container: Element, items: Element[]): string {
  const aria = container.getAttribute('aria-label');
  if (aria && normalizedText(aria)) return normalizedText(aria);

  const itemSet = new Set(items);
  const directChildren = Array.from(container.children);
  for (const child of directChildren) {
    if (itemSet.has(child)) continue;
    const heading = child.matches('h1, h2, h3, h4, h5, h6')
      ? child
      : child.querySelector('h1, h2, h3, h4, h5, h6');
    const text = textOf(heading);
    if (text) return text;
  }

  let sibling = container.previousElementSibling;
  while (sibling) {
    const heading = sibling.matches('h1, h2, h3, h4, h5, h6')
      ? sibling
      : sibling.querySelector('h1, h2, h3, h4, h5, h6');
    const text = textOf(heading);
    if (text) return text;
    sibling = sibling.previousElementSibling;
  }

  const section = container.closest('section, main, article');
  if (section && section !== container) {
    for (const child of Array.from(section.children)) {
      if (child === container) break;
      const heading = child.matches('h1, h2, h3, h4, h5, h6')
        ? child
        : child.querySelector('h1, h2, h3, h4, h5, h6');
      const text = textOf(heading);
      if (text) return text;
    }
  }

  return '';
}

function structureSignature(el: Element, interactiveSelector: string): string {
  const directChildren = Array.from(el.children).slice(0, 8).map((child) => child.tagName.toLowerCase()).join(',');
  const roles = Array.from(el.querySelectorAll(interactiveSelector))
    .slice(0, 8)
    .map((node) => (node.getAttribute('role') || node.tagName.toLowerCase() || '').toLowerCase())
    .join(',');
  return [el.tagName.toLowerCase(), directChildren, roles].filter(Boolean).join('|');
}

function collectRadioGroups(ctx: DomContext): BrowserInteractiveNode[] {
  const groups: BrowserInteractiveNode[] = [];
  const seen = new Set<Element>();

  const nativeGroups = new Map<string, HTMLInputElement[]>();
  for (const radio of Array.from(ctx.document.querySelectorAll('input[type="radio"]')).filter(isVisible) as HTMLInputElement[]) {
    const name = (radio.getAttribute('name') || '').trim();
    if (!name) continue;
    const form = radio.closest('form');
    const key = `native::${form ? ensureId(ctx, form) : 'no-form'}::${name}`;
    const list = nativeGroups.get(key) || [];
    list.push(radio);
    nativeGroups.set(key, list);
  }

  const ariaGroups = new Map<string, Element[]>();
  for (const radio of Array.from(ctx.document.querySelectorAll('[role="radio"]')).filter(isVisible)) {
    const container = radio.closest('[role="radiogroup"]');
    if (!container) continue;
    const key = `aria::${ensureId(ctx, container)}`;
    const list = ariaGroups.get(key) || [];
    list.push(radio);
    ariaGroups.set(key, list);
  }

  function optionLabel(radio: Element): string {
    return labelFor(ctx, radio)
      || radio.getAttribute('aria-label')
      || textOf(radio.closest('label'))
      || textOf(radio.parentElement)
      || (radio.getAttribute('value') || '').trim();
  }

  function groupContainer(radios: Element[]): Element | null {
    const first = radios[0];
    if (!first) return null;
    return first.closest('[role="radiogroup"], fieldset') || first.parentElement;
  }

  function groupLabel(container: Element, radios: Element[]): string {
    return labelFor(ctx, container)
      || container.getAttribute('aria-label')
      || textOf(container.querySelector('legend, h1, h2, h3, h4, h5, h6'))
      || `Choose ${optionLabel(radios[0]) || 'option'}`;
  }

  for (const radioList of [...nativeGroups.values(), ...ariaGroups.values()]) {
    if (radioList.length < 2) continue;
    const container = groupContainer(radioList);
    if (!container || seen.has(container)) continue;
    seen.add(container);

    const options: string[] = [];
    const optionSelectors: Record<string, string> = {};
    for (const radio of radioList) {
      const name = optionLabel(radio);
      if (!name || optionSelectors[name]) continue;
      options.push(name);
      optionSelectors[name] = `[${ctx.attrName}="${ensureId(ctx, radio)}"]`;
    }
    if (!options.length) continue;

    const form = container.closest('form');
    groups.push({
      elementId: ensureId(ctx, container),
      tagName: container.tagName.toLowerCase(),
      role: 'radiogroup',
      name: groupLabel(container, radioList),
      type: 'radio-group',
      required: radioList.some((radio) => radio.hasAttribute('required')),
      disabled: radioList.every((radio) => radio.hasAttribute('disabled') || radio.getAttribute('aria-disabled') === 'true'),
      options,
      optionSelectors,
      formId: form ? ensureId(ctx, form) : undefined,
      visible: true,
      receivesPointerEvents: radioList.some(receivesPointerEvents),
      pointerCursor: radioList.some(pointerCursor),
      box: elementBox(container),
      selector: `[${ctx.attrName}="${ensureId(ctx, container)}"]`,
    });
  }

  return groups;
}

function collectInteractives(ctx: DomContext, maxNodes = 150): BrowserInteractiveNode[] {
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

  const nodes = Array.from(ctx.document.querySelectorAll(selector))
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
      const name = labelFor(ctx, el)
        || el.getAttribute('aria-label')
        || ((tag === 'button' || tag === 'a') ? textOf(el) : '')
        || el.getAttribute('placeholder')
        || '';
      const options = tag === 'select'
        ? Array.from((el as HTMLSelectElement).options || []).map((opt) => (opt.value || opt.textContent || '').trim()).filter(Boolean)
        : undefined;

      return {
        elementId: ensureId(ctx, el),
        tagName: tag,
        role,
        name,
        text: textOf(el),
        heading: getHeading(el),
        landmark: getLandmark(el),
        href: tag === 'a' ? el.getAttribute('href') || '' : '',
        type: inferControlType(el),
        required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
        disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
        checked: typeof (el as HTMLInputElement).checked === 'boolean'
          ? (el as HTMLInputElement).checked
          : el.getAttribute('aria-checked') === 'true',
        options,
        formId: form ? ensureId(ctx, form) : undefined,
        visible: true,
        receivesPointerEvents: receivesPointerEvents(el),
        pointerCursor: pointerCursor(el),
        box: elementBox(el),
        selector: `[${ctx.attrName}="${ensureId(ctx, el)}"]`,
      } satisfies BrowserInteractiveNode;
    });

  return [...nodes, ...collectRadioGroups(ctx)];
}

function collectForms(ctx: DomContext, interactives: BrowserInteractiveNode[]): BrowserFormSummary[] {
  return Array.from(ctx.document.querySelectorAll('form')).map((form) => {
    const formId = ensureId(ctx, form);
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
      heading: getHeading(form),
      fieldIds,
      submitIds,
    };
  });
}

export function buildSnapshot(
  document: Document,
  options: BuildSnapshotOptions = {},
): BrowserDiscoverySnapshot {
  const attrName = options.attrName || DEFAULT_ELEMENT_ATTR_NAME;
  const maxInteractiveNodes = options.maxInteractiveNodes ?? 150;
  const ctx = createDomContext(document, attrName);
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
    '[role="combobox"]',
  ].join(', ');

  const interactives = collectInteractives(ctx, maxInteractiveNodes);
  const forms = collectForms(ctx, interactives);
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
    .filter((text, index, arr) => arr.indexOf(text) === index)
    .join(' ')
    .slice(0, 3000);

  const collectionCandidates = Array.from(document.querySelectorAll('body *'))
    .map((container) => {
      const children = Array.from(container.children).filter((child) => isVisible(child));
      if (children.length < 3) return null;

      const groups = new Map<string, Element[]>();
      for (const child of children) {
        const descendantInteractives = Array.from(child.querySelectorAll(interactiveSelector))
          .filter((node) => isVisible(node));
        const signature = [
          child.tagName.toLowerCase(),
          descendantInteractives.length,
          descendantInteractives
            .slice(0, 6)
            .map((node) => (node.getAttribute('role') || node.tagName.toLowerCase()).toLowerCase())
            .join(','),
        ].join('|');
        if (!groups.has(signature)) groups.set(signature, []);
        groups.get(signature)?.push(child);
      }

      let bestGroup: Element[] | null = null;
      for (const group of groups.values()) {
        if (group.length < 3) continue;
        if (!bestGroup || group.length > bestGroup.length) bestGroup = group;
      }
      if (!bestGroup) return null;

      const items = bestGroup.map((child) => {
        const itemId = ensureId(ctx, child);
        const localInteractives = Array.from(child.querySelectorAll(interactiveSelector))
          .filter((node) => isVisible(node))
          .map((node) => {
            const tag = node.tagName.toLowerCase();
            const text = textOf(node);
            const name = labelFor(ctx, node) || node.getAttribute('aria-label') || ((tag === 'button' || tag === 'a') ? text : '') || node.getAttribute('placeholder') || '';
            const role = node.getAttribute('role')
              || (tag === 'a' ? 'link' : tag === 'button' ? 'button' : tag === 'select' ? 'combobox' : tag === 'textarea' ? 'textbox' : tag === 'input' ? ((node as HTMLInputElement).type || 'textbox') : tag);
            const elementId = ensureId(ctx, node);
            return {
              elementId,
              tagName: tag,
              role,
              name,
              text,
              heading: getHeading(node),
              landmark: getLandmark(node),
              receivesPointerEvents: receivesPointerEvents(node),
              pointerCursor: pointerCursor(node),
              box: elementBox(node),
              selector: `[${ctx.attrName}="${elementId}"]`,
            };
          });
        const interactiveIds = localInteractives.map((node) => node.elementId);
        const textSummary = normalizedText(child.textContent || '').slice(0, 240);
        const keyTexts = Array.from(child.querySelectorAll('h1, h2, h3, h4, h5, h6, strong, b, [aria-label], img[alt]'))
          .map((node) => {
            const aria = node.getAttribute ? node.getAttribute('aria-label') : '';
            const alt = node.getAttribute ? node.getAttribute('alt') : '';
            return normalizedText(aria || node.textContent || alt || '');
          })
          .filter(Boolean)
          .slice(0, 6);
        return {
          itemId,
          selector: `[${ctx.attrName}="${itemId}"]`,
          title: itemTitle(child),
          summary: textSummary || itemTitle(child) || child.tagName.toLowerCase(),
          heading: getHeading(child),
          landmark: getLandmark(child),
          keyTexts: keyTexts.length > 0 ? keyTexts : [textSummary || itemTitle(child) || child.tagName.toLowerCase()],
          interactiveIds,
          interactives: localInteractives,
        };
      }).filter((item) => item.interactiveIds.length > 0 || item.summary);

      if (items.length < 3) return null;
      const uniqueInteractiveLabels = new Set(items.flatMap((item) => item.interactives.map((node) => normalizedText(node.name || node.text || '')).filter(Boolean)));
      if (uniqueInteractiveLabels.size === 0) return null;

      const collectionId = ensureId(ctx, container);
      return {
        collectionId,
        containerId: collectionId,
        selector: `[${ctx.attrName}="${collectionId}"]`,
        label: collectionLabel(container, bestGroup),
        itemIds: items.map((item) => item.itemId),
        itemCount: items.length,
        structureSignature: structureSignature(bestGroup[0], interactiveSelector),
        items,
      } satisfies BrowserCollectionCandidate;
    })
    .filter((candidate, index, arr): candidate is BrowserCollectionCandidate =>
      Boolean(candidate) && arr.findIndex((other) => other && other.collectionId === candidate.collectionId) === index)
    .slice(0, 12);

  return {
    url: document.defaultView?.location?.href || '',
    title: document.title || '',
    elementAttribute: attrName,
    headings,
    landmarks,
    forms,
    interactives,
    collectionCandidates,
    pageTextSummary,
  };
}
