// Shared by the preload (the human's pick) and the CDP driver (the agent's ref): one way to name an element so both
// sides can compare. Plain CommonJS with no dependencies, so the preload can require it and the driver can evaluate
// its source in the page.

function cssEscape(s) {
  return String(s).replace(/([^\w-])/g, '\\$1');
}

// A CSS selector that is unique in the document: the nearest ancestor-or-self with an id, then nth-of-type steps.
function cssPath(el) {
  if (!(el instanceof Element)) return null;
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1 && node !== document.documentElement) {
    if (node.id && document.querySelectorAll(`#${cssEscape(node.id)}`).length === 1) {
      parts.unshift(`#${cssEscape(node.id)}`);
      return parts.join(' > ');
    }
    const tag = node.tagName.toLowerCase();
    const parent = node.parentElement;
    let step = tag;
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
      if (same.length > 1) step += `:nth-of-type(${same.indexOf(node) + 1})`;
    }
    parts.unshift(step);
    node = parent;
  }
  return parts.length ? parts.join(' > ') : 'html';
}

const IMPLICIT_ROLE = {
  a: (el) => (el.hasAttribute('href') ? 'link' : null),
  button: () => 'button',
  h1: () => 'heading', h2: () => 'heading', h3: () => 'heading', h4: () => 'heading', h5: () => 'heading', h6: () => 'heading',
  input: (el) => {
    const t = (el.getAttribute('type') || 'text').toLowerCase();
    if (t === 'checkbox') return 'checkbox';
    if (t === 'radio') return 'radio';
    if (t === 'button' || t === 'submit' || t === 'reset') return 'button';
    if (t === 'range') return 'slider';
    if (t === 'number') return 'spinbutton';
    if (t === 'search') return 'searchbox';
    if (t === 'hidden') return null;
    return 'textbox';
  },
  textarea: () => 'textbox',
  select: (el) => (el.multiple || el.size > 1 ? 'listbox' : 'combobox'),
  option: () => 'option',
  img: () => 'img',
  ul: () => 'list', ol: () => 'list', li: () => 'listitem',
  nav: () => 'navigation', main: () => 'main', header: () => 'banner', footer: () => 'contentinfo', aside: () => 'complementary',
  form: () => 'form', section: () => 'region', article: () => 'article',
  table: () => 'table', tr: () => 'row', td: () => 'cell', th: () => 'columnheader',
  p: () => 'paragraph', label: () => null, span: () => null, div: () => null,
};

function role(el) {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit.split(/\s+/)[0];
  const f = IMPLICIT_ROLE[el.tagName.toLowerCase()];
  return f ? f(el) : null;
}

function accessibleName(el) {
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const names = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim()).filter(Boolean);
    if (names.length) return names.join(' ');
  }
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();
  if (el.id) {
    const lab = document.querySelector(`label[for="${cssEscape(el.id)}"]`);
    if (lab) return lab.textContent.trim();
  }
  const wrappingLabel = el.closest('label');
  if (wrappingLabel && wrappingLabel !== el) return wrappingLabel.textContent.trim();
  if (el.tagName === 'IMG') return (el.getAttribute('alt') || '').trim();
  if (el.tagName === 'INPUT' && ['button', 'submit', 'reset'].includes((el.getAttribute('type') || '').toLowerCase())) return el.value;
  if (el.getAttribute('title')) return el.getAttribute('title').trim();
  return (el.textContent || '').trim().replace(/\s+/g, ' ');
}

// The accessibility path: role "name" segments from the outermost role-bearing ancestor down to the element. Matches
// the nesting an aria snapshot shows, which is what comment mode will store beside the CSS selector.
function a11yPath(el) {
  const segs = [];
  let node = el;
  while (node && node.nodeType === 1) {
    const r = role(node);
    if (r) {
      const name = accessibleName(node);
      segs.unshift(name && r !== 'list' && r !== 'listitem' && r !== 'main' && r !== 'form' ? `${r} "${name}"` : r);
    }
    node = node.parentElement;
  }
  return segs.join(' > ');
}

function describe(el) {
  const rect = el.getBoundingClientRect();
  return {
    css: cssPath(el),
    a11y: a11yPath(el),
    role: role(el),
    name: accessibleName(el),
    tag: el.tagName.toLowerCase(),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  };
}

module.exports = { cssPath, a11yPath, role, accessibleName, describe };
