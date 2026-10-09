// The bridge script (E2 execution document, Design §10): MAWS's own script, which the `maws-deliverable:` handler puts
// as the first element of every artifact's HTML it serves (`protocol.ts`, `insertBridgeScript`), so it runs before the
// artifact's own scripts, inline under the artifact's policy. The frame is an opaque origin, so whatever needs the
// page's cooperation happens here. A delivered HTML file never carries it.
//
// The element picker for comment mode: it listens to `message` events from `window.parent` alone; `{ type: 'maws:pick',
// on: true | false }` turns picking on or off. While on, an overlay of its own follows the element under the pointer: a
// `maws-pick-overlay` element whose inline styles are all `!important` (no transition), so the page's CSS neither hides
// nor animates it, placed from `getBoundingClientRect` and again on scroll and resize, the element's styles never
// touched. The pointer's presses and clicks are swallowed in the capture phase on `window` (registered before the
// page's own scripts run, so first); a click posts
// `{ type: 'maws:picked', selector, label, text, rect }` to the parent and ends picking (one pick per Comment), Escape
// posts `{ type: 'maws:pick-cancelled' }`. `targetOrigin` is `'*'`: the frame cannot know the app's origin, and the
// message says nothing the parent did not ask for. `selector` is the element's id when it is unique, else a
// `tag:nth-of-type(k)` chain from `body` or from the nearest ancestor with a unique id, at most twelve steps (an element
// nested deeper gets its innermost twelve, unanchored); `label` is `<tag>#<id>`, `<tag>.<first class>` or `<tag>`; `text`
// is the element's text with whitespace collapsed, cut at 200 characters (the app cuts it again for the label, and
// treats every field as the page's: a page can post the same shapes itself). Nothing is written to the page's state
// but the overlay, which leaves with picking.
//
// Re-pin (P2-E1 document, D8): `{ type: 'maws:locate', selector }` from the parent is answered with
// `{ type: 'maws:located', selector, rect }`, the rect `getBoundingClientRect` of `document.querySelector(selector)`, or
// null when the selector matches nothing or is invalid (a throwing selector is caught). A locate never starts picking
// and leaves nothing in the page. The capture window loads the page top-level, where there is no parent to
// listen to, so the script does nothing there.
//
// A plain string, not a stringified function: a bundler's helpers (esbuild's `__name`) would not exist in the page.
// Served as one line: it goes ahead of the artifact's own scripts, so a line of its own would move every line number
// Chromium reports for the page's console errors away from the agent's file. The source below is written so that
// joining its lines changes nothing (no `//` comments, every statement ended by its semicolon).
const SOURCE = String.raw`(function () {
  'use strict';
  var host = window.parent;
  if (!host || host === window) return;
  var MAX_STEPS = 12;
  var SAFE_ID = /^[A-Za-z_][\w-]*$/;
  var SAFE_TAG = /^[A-Za-z][\w-]*$/;
  var picking = false;
  var overlay = null;
  var shown = null;

  function post(message) { host.postMessage(message, '*'); }

  function uniqueId(el) {
    var id = el.getAttribute('id');
    return id && SAFE_ID.test(id) && document.querySelectorAll('#' + id).length === 1 ? id : null;
  }

  function step(el) {
    var tag = el.localName;
    var k = 1;
    for (var s = el.previousElementSibling; s; s = s.previousElementSibling) {
      if (!SAFE_TAG.test(tag) || s.localName === tag) k += 1;
    }
    return (SAFE_TAG.test(tag) ? tag + ':nth-of-type(' : '*:nth-child(') + k + ')';
  }

  function selectorOf(el) {
    var own = uniqueId(el);
    if (own) return '#' + own;
    var steps = [];
    for (var node = el; node; node = node.parentElement) {
      if (node === document.body) { steps.unshift('body'); break; }
      if (node === document.documentElement) { steps.unshift('html'); break; }
      var anchor = node === el ? null : uniqueId(node);
      if (anchor) { steps.unshift('#' + anchor); break; }
      if (steps.length === MAX_STEPS) break;
      steps.unshift(step(node));
    }
    return steps.join(' > ');
  }

  function labelOf(el) {
    var id = el.getAttribute('id');
    if (id) return el.localName + '#' + id;
    var first = el.classList && el.classList[0];
    return first ? el.localName + '.' + first : el.localName;
  }

  function textOf(el) {
    var text = typeof el.innerText === 'string' ? el.innerText : el.textContent || '';
    return text.replace(/\s+/g, ' ').trim().slice(0, 200);
  }

  function set(name, value) { overlay.style.setProperty(name, value, 'important'); }

  function place(el) {
    shown = el;
    if (!overlay) {
      overlay = document.createElement('maws-pick-overlay');
      overlay.setAttribute('data-maws-pick-overlay', '');
      set('position', 'fixed');
      set('pointer-events', 'none');
      set('z-index', '2147483647');
      set('box-sizing', 'border-box');
      set('margin', '0');
      set('padding', '0');
      set('border', '2px solid #2f6feb');
      set('border-radius', '2px');
      set('background', 'rgba(47, 111, 235, 0.12)');
      set('transition', 'none');
      set('animation', 'none');
      set('transform', 'none');
      set('opacity', '1');
      set('visibility', 'visible');
      document.documentElement.appendChild(overlay);
    }
    var r = el.getBoundingClientRect();
    set('left', r.left + 'px');
    set('top', r.top + 'px');
    set('width', r.width + 'px');
    set('height', r.height + 'px');
    set('display', 'block');
  }

  function stop() {
    picking = false;
    shown = null;
    if (overlay) { overlay.remove(); overlay = null; }
  }

  function swallow(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  window.addEventListener('message', function (event) {
    if (event.source !== host) return;
    var data = event.data;
    if (!data || typeof data !== 'object' || data.type !== 'maws:pick') return;
    if (data.on === true) picking = true;
    else if (data.on === false) stop();
  });

  window.addEventListener('message', function (event) {
    if (event.source !== host) return;
    var data = event.data;
    if (!data || typeof data !== 'object' || data.type !== 'maws:locate' || typeof data.selector !== 'string') return;
    var rect = null;
    try {
      var el = document.querySelector(data.selector);
      if (el) { var r = el.getBoundingClientRect(); rect = { x: r.left, y: r.top, width: r.width, height: r.height }; }
    } catch (error) { rect = null; }
    post({ type: 'maws:located', selector: data.selector, rect: rect });
  });

  window.addEventListener('mousemove', function (event) {
    if (picking && event.target instanceof Element) place(event.target);
  }, true);

  window.addEventListener('mouseout', function (event) {
    if (picking && !event.relatedTarget && overlay) { set('display', 'none'); shown = null; }
  }, true);

  function follow() { if (picking && shown) place(shown); }
  window.addEventListener('scroll', follow, true);
  window.addEventListener('resize', follow);

  ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'auxclick', 'dblclick', 'contextmenu'].forEach(function (type) {
    window.addEventListener(type, function (event) { if (picking) swallow(event); }, true);
  });

  window.addEventListener('click', function (event) {
    if (!picking) return;
    swallow(event);
    var el = event.target instanceof Element ? event.target : null;
    if (!el) return;
    var r = el.getBoundingClientRect();
    var picked = { type: 'maws:picked', selector: selectorOf(el), label: labelOf(el), text: textOf(el), rect: { x: r.left, y: r.top, width: r.width, height: r.height } };
    stop();
    post(picked);
  }, true);

  window.addEventListener('keydown', function (event) {
    if (!picking || event.key !== 'Escape') return;
    swallow(event);
    stop();
    post({ type: 'maws:pick-cancelled' });
  }, true);
})();`;

export const BRIDGE_SCRIPT = SOURCE.split('\n')
  .map((line) => line.trim())
  .join(' ');
