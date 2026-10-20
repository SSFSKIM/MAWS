// Suite 1, DOM level: one subtree holding (a) a focused contenteditable with a non-collapsed selection, (b) a scrolled
// overflow container, (c) a same-origin iframe with state in its window, (d) a 2D canvas and a WebGL canvas, (e) an
// element under a running CSS transition, moved between two connected parents with `moveBefore` and, on a fresh copy,
// with `insertBefore`. Then two parkings (a connected display:none parent and an offscreen one) with moveBefore, the
// way a keeper would hold a body while no pane shows it, and the detached-node case.
import { el, errText, frames, insertBefore, moveBefore, sleep } from './util';

const IFRAME_DOC = '<!doctype html><body><p>frame</p><script>window.counter = 0; window.bornAt = performance.timeOrigin;</script></body>';

function buildSubject(tag: string) {
  const ce = el('div', { contentEditable: 'true', id: `ce-${tag}` }, document.createTextNode('The quick brown fox jumps over the lazy dog'));
  const scroller = el('div', { class: 'scroller' }, el('div', { class: 'tall' }));
  const iframe = el('iframe', { srcdoc: IFRAME_DOC }) as HTMLIFrameElement;
  const canvas = el('canvas', { width: 100, height: 50 }) as HTMLCanvasElement;
  const gl = el('canvas', { width: 50, height: 50 }) as HTMLCanvasElement;
  const anim = el('div', { class: 'anim' });
  const subject = el('div', { id: `subject-${tag}` }, ce, scroller, iframe, canvas, gl, anim);
  return { subject, ce, scroller, iframe, canvas, gl, anim };
}
type Subject = ReturnType<typeof buildSubject>;

/** Arms every probe on a subject already in the page and in its starting state; returns snapshot/drain helpers. */
async function arm(s: Subject, stage: HTMLElement) {
  const counts: Record<string, number> = {};
  const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
  let loads = 0;
  s.iframe.addEventListener('load', () => (loads += 1));
  await new Promise<void>((resolve) => {
    if (s.iframe.contentDocument?.readyState === 'complete' && (s.iframe.contentWindow as unknown as { counter?: number })?.counter === 0) resolve();
    else s.iframe.addEventListener('load', () => resolve(), { once: true });
  });
  const frameWindow = s.iframe.contentWindow as unknown as { counter: number; bornAt: number };
  frameWindow.counter = 42;

  const ctx = s.canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = 'rgb(255, 0, 0)';
  ctx.fillRect(0, 0, 100, 50);
  const glc = s.gl.getContext('webgl', { preserveDrawingBuffer: true });
  if (glc) {
    glc.clearColor(0, 1, 0, 1);
    glc.clear(glc.COLOR_BUFFER_BIT);
  }
  s.gl.addEventListener('webglcontextlost', () => bump('webglcontextlost'));
  s.gl.addEventListener('webglcontextrestored', () => bump('webglcontextrestored'));

  for (const type of ['transitionrun', 'transitionstart', 'transitionend', 'transitioncancel']) s.anim.addEventListener(type, () => bump(type));
  getComputedStyle(s.anim).transform; // flush the start style
  s.anim.style.transform = 'translateX(400px)';
  await sleep(300); // the transition runs

  s.scroller.scrollTop = 300;
  s.ce.focus();
  const range = document.createRange();
  range.setStart(s.ce.firstChild!, 4);
  range.setEnd(s.ce.firstChild!, 15); // "quick brown"
  const sel = getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  for (const type of ['focus', 'blur', 'focusin', 'focusout']) s.ce.addEventListener(type, () => bump(`ce.${type}`));
  for (const type of ['focusin', 'focusout']) document.addEventListener(type, () => bump(`document.${type}`));
  document.addEventListener('selectionchange', () => bump('selectionchange'));

  const mo = new MutationObserver(() => {});
  mo.observe(stage, { childList: true, subtree: true });
  const roEntries: string[] = [];
  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) roEntries.push(`${(entry.target as HTMLElement).tagName.toLowerCase()}${(entry.target as HTMLElement).className ? '.' + (entry.target as HTMLElement).className : ''}:${Math.round(entry.contentRect.width)}x${Math.round(entry.contentRect.height)}`);
  });
  for (const target of [s.subject, s.scroller, s.iframe, s.canvas]) ro.observe(target);
  await frames(3); // the initial observations
  roEntries.length = 0;
  for (const k of Object.keys(counts)) if (k === 'selectionchange') delete counts[k];

  const snapshot = () => {
    const sel = getSelection()!;
    const r = sel.rangeCount ? sel.getRangeAt(0) : null;
    const transitions = s.anim.getAnimations();
    const pixel = Array.from(ctx.getImageData(10, 10, 1, 1).data);
    let glPixel: number[] | null = null;
    if (glc) {
      const buf = new Uint8Array(4);
      glc.readPixels(1, 1, 1, 1, glc.RGBA, glc.UNSIGNED_BYTE, buf);
      glPixel = Array.from(buf);
    }
    return {
      parent: s.subject.parentElement?.id ?? null,
      activeElementIsCe: document.activeElement === s.ce,
      activeElement: document.activeElement?.tagName.toLowerCase() + (document.activeElement?.id ? '#' + document.activeElement.id : ''),
      selection: { rangeCount: sel.rangeCount, text: sel.toString(), collapsed: r?.collapsed ?? null, inCe: r ? s.ce.contains(r.startContainer) : null, start: r?.startOffset ?? null, end: r?.endOffset ?? null },
      liveRange: { text: range.toString(), collapsed: range.collapsed, startContainer: range.startContainer.nodeName, startOffset: range.startOffset },
      scrollTop: s.scroller.scrollTop,
      iframe: { sameWindow: s.iframe.contentWindow === (frameWindow as unknown as Window), counter: (s.iframe.contentWindow as unknown as { counter?: number })?.counter ?? null, loads },
      canvas2dPixel: pixel,
      webglPixel: glPixel,
      webglContextLost: glc?.isContextLost() ?? null,
      transition: { running: transitions.length, currentTime: transitions[0]?.currentTime ?? null, transform: getComputedStyle(s.anim).transform },
      events: { ...counts },
    };
  };
  const drain = () => {
    const records = mo.takeRecords().map((r) => `${r.type} target=${(r.target as HTMLElement).id || r.target.nodeName} +${r.addedNodes.length} -${r.removedNodes.length}`);
    return records;
  };
  const roDrain = () => roEntries.splice(0);
  return { snapshot, drain, roDrain, stop: () => (mo.disconnect(), ro.disconnect()) };
}

async function moveRun(mode: 'moveBefore' | 'insertBefore') {
  const stage = el('div', { id: `stage-${mode}` });
  const a = el('div', { class: 'pane', id: `A-${mode}` });
  const b = el('div', { class: 'pane', id: `B-${mode}` });
  stage.append(a, b);
  document.body.append(stage);
  const s = buildSubject(mode);
  a.append(s.subject);
  const probe = await arm(s, stage);
  const before = probe.snapshot();
  const mover = mode === 'moveBefore' ? moveBefore : insertBefore;
  let error: string | null = null;
  try {
    mover(b, s.subject);
  } catch (e) {
    error = errText(e);
  }
  const syncAfter = probe.snapshot();
  const mutationRecordsSync = probe.drain();
  await frames(3);
  await sleep(400); // an iframe reload, a transition's next state
  await frames(2);
  const after = probe.snapshot();
  const resizeEntries = probe.roDrain();
  probe.stop();
  return { error, before, syncAfter, mutationRecordsSync, after, resizeEntries, s, stage, b };
}

/** Moves a live subject (focused, scrolled, iframe with state) into a connected parking parent and back, with frames between. */
async function parkRun(kind: 'parking-none' | 'parking-off') {
  const stage = el('div', { id: `stage-${kind}` });
  const a = el('div', { class: 'pane', id: `A-${kind}` });
  const b = el('div', { class: 'pane', id: `B-${kind}` });
  const parking = el('div', { class: kind, id: `P-${kind}` });
  stage.append(a, b, parking);
  document.body.append(stage);
  const s = buildSubject(kind);
  a.append(s.subject);
  const probe = await arm(s, stage);
  const before = probe.snapshot();
  moveBefore(parking, s.subject);
  await frames(3);
  await sleep(200);
  const parked = probe.snapshot();
  moveBefore(b, s.subject);
  await frames(3);
  await sleep(200);
  const back = probe.snapshot();
  const resizeEntries = probe.roDrain();
  probe.drain();
  probe.stop();
  stage.remove();
  return { before, parked, back, resizeEntries };
}

export async function domSuite() {
  const available = typeof (Element.prototype as unknown as { moveBefore?: unknown }).moveBefore === 'function';
  const out: Record<string, unknown> = { moveBeforeAvailable: available, documentHasFocus: document.hasFocus() };
  if (!available) return out;
  const mb = await moveRun('moveBefore');
  const ib = await moveRun('insertBefore');
  const strip = ({ s: _s, stage: _st, b: _b, ...rest }: Awaited<ReturnType<typeof moveRun>>) => rest;
  out.moveBefore = strip(mb);
  out.insertBefore = strip(ib);
  mb.stage.remove();
  ib.stage.remove();
  out.parkDisplayNone = await parkRun('parking-none');
  out.parkOffscreen = await parkRun('parking-off');

  // A detached node (never in the document, as a keeper's fresh host is) into a connected parent; and a connected node
  // into a detached parent.
  const detached = el('div');
  const target = el('div');
  document.body.append(target);
  const tries: Record<string, string> = {};
  try {
    moveBefore(target, detached);
    tries.detachedIntoConnected = 'ok';
  } catch (e) {
    tries.detachedIntoConnected = errText(e);
  }
  const connected = el('div');
  document.body.append(connected);
  try {
    moveBefore(el('div'), connected);
    tries.connectedIntoDetached = 'ok';
  } catch (e) {
    tries.connectedIntoDetached = errText(e);
  }
  target.remove();
  connected.remove();
  out.preconditions = tries;
  out.scrollContainerAsMovedRoot = await scrollRootCase();
  out.scrollWithSelectionInside = await scrollSelectionCase();
  return out;
}

/**
 * A scroll container whose content holds the focus or the selection (as an editor's does), moved with moveBefore
 * through a wrapper: which of focus, editability and a selection inside the container costs its scroll offset.
 */
async function scrollSelectionCase() {
  const a = el('div', { class: 'pane' });
  const b = el('div', { class: 'pane' });
  document.body.prepend(a, b);
  const lines = () => Array.from({ length: 80 }, (_, i) => el('p', {}, document.createTextNode(`line ${i + 1} of the tall content`)));
  const variants: Record<string, (content: HTMLElement, input: HTMLInputElement) => void> = {
    editableNoFocusNoSelection: () => {},
    editableFocusedCaretInside: (content) => {
      content.focus({ preventScroll: true });
      getSelection()!.collapse(content.children[40].firstChild!, 3);
    },
    editableFocusedRangeInside: (content) => {
      content.focus({ preventScroll: true });
      getSelection()!.setBaseAndExtent(content.children[40].firstChild!, 0, content.children[40].firstChild!, 6);
    },
    plainRangeInsideNoFocus: (content) => {
      content.contentEditable = 'false';
      getSelection()!.setBaseAndExtent(content.children[40].firstChild!, 0, content.children[40].firstChild!, 6);
    },
    plainFocusedInputInsideNoSelection: (content, input) => {
      content.contentEditable = 'false';
      input.focus({ preventScroll: true });
    },
  };
  const result: Record<string, unknown> = {};
  for (const [name, setup] of Object.entries(variants)) {
    getSelection()!.removeAllRanges();
    const content = el('div', { contentEditable: 'true' }, ...lines());
    const input = el('input') as HTMLInputElement;
    const scroller = el('div', { class: 'scroller' }, input, content);
    const wrapper = el('div', {}, scroller);
    a.append(wrapper);
    await frames(2);
    setup(content, input);
    scroller.scrollTop = 300;
    await frames(2);
    const before = { scrollTop: scroller.scrollTop, selection: getSelection()!.toString(), active: document.activeElement?.tagName };
    moveBefore(b, wrapper);
    const sync = scroller.scrollTop;
    const syncSelection = { rangeCount: getSelection()!.rangeCount, collapsed: getSelection()!.isCollapsed, inside: scroller.contains(getSelection()!.anchorNode) };
    await frames(3);
    result[name] = { before, syncScrollTop: sync, syncSelection, afterFramesScrollTop: scroller.scrollTop, activeAfter: document.activeElement?.tagName };
    wrapper.remove();
  }
  // Where the focused element sits decides whether this is a reset or a scroll to the focused element: an input
  // below the fold, and one in view at the offset.
  for (const where of ['focusedInputBelowTheFold', 'focusedInputInView'] as const) {
    getSelection()!.removeAllRanges();
    const input = el('input') as HTMLInputElement;
    const all = lines();
    const scroller = el('div', { class: 'scroller' }, ...(where === 'focusedInputBelowTheFold' ? [...all, input] : [...all.slice(0, 10), input, ...all.slice(10)]));
    const wrapper = el('div', {}, scroller);
    a.append(wrapper);
    await frames(2);
    input.focus({ preventScroll: true });
    scroller.scrollTop = where === 'focusedInputBelowTheFold' ? 300 : input.offsetTop - scroller.offsetTop - 40;
    await frames(2);
    const before = scroller.scrollTop;
    moveBefore(b, wrapper);
    const sync = scroller.scrollTop;
    await frames(3);
    result[where] = { before, syncScrollTop: sync, afterFramesScrollTop: scroller.scrollTop, inputOffsetTop: input.offsetTop - scroller.offsetTop, scrollHeight: scroller.scrollHeight, activeIsInput: document.activeElement === input };
    wrapper.remove();
  }
  getSelection()!.removeAllRanges();
  a.remove();
  b.remove();
  return result;
}

/** The scroll container itself as the moved node (the case above moves an ancestor of it), plain and wrapped. */
async function scrollRootCase() {
  const a = el('div', { class: 'pane' });
  const b = el('div', { class: 'pane' });
  document.body.prepend(a, b);
  const result: Record<string, unknown> = {};
  for (const wrapped of [false, true]) {
    const scroller = el('div', { class: 'scroller' }, el('div', { class: 'tall' }));
    const moved = wrapped ? el('div', {}, scroller) : scroller;
    a.append(moved);
    await frames(2);
    scroller.scrollTop = 300;
    await frames(2);
    const before = scroller.scrollTop;
    moveBefore(b, moved);
    const sync = scroller.scrollTop;
    await frames(3);
    result[wrapped ? 'wrapped' : 'scrollerItself'] = { before, sync, afterFrames: scroller.scrollTop };
    moved.remove();
  }
  a.remove();
  b.remove();
  return result;
}
