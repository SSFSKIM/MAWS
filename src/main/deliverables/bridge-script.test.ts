// E2 (M6): the bridge script's element picker (Design §10), evaluated in a happy-dom document standing in for an
// artifact's frame: `maws:pick` from the parent turns picking on, the pointer draws the overlay, a click posts
// `maws:picked` with a selector that resolves to the clicked element and reaches none of the page's own handlers,
// Escape posts `maws:pick-cancelled`, and a message from anywhere but the parent changes nothing. Each case runs the
// script in a fresh happy-dom window whose `parent` is a stand-in recording what the script posts.
import { Window, type Element as DomElement } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BRIDGE_SCRIPT } from './bridge-script';

interface Posted {
  type: string;
  selector?: string;
  label?: string;
  text?: string;
  rect?: { x: number; y: number; width: number; height: number };
  origin?: string;
}

let win: Window;
let posted: Posted[];
let parent: { postMessage(data: Posted, origin: string): void };
beforeEach(() => {
  win = new Window();
  posted = [];
  parent = { postMessage: (data, origin) => void posted.push({ ...data, origin }) };
  Object.defineProperty(win, 'parent', { configurable: true, get: () => parent });
});
afterEach(async () => {
  await win.happyDOM.close();
});

const $ = (selector: string) => win.document.querySelector(selector)!;
const $$ = (selector: string) => Array.from(win.document.querySelectorAll(selector));
function page(html: string) {
  win.document.body.innerHTML = html;
  new Function('window', 'document', 'Element', BRIDGE_SCRIPT)(win, win.document, win.Element);
}
const fromParent = (data: unknown, source: unknown = parent) => win.dispatchEvent(new win.MessageEvent('message', { data, source: source as never }));
const overlay = () =>
  win.document.querySelector('[data-maws-pick-overlay]') as unknown as { localName: string; style: { getPropertyValue(name: string): string; getPropertyPriority(name: string): string } } | null;
const hover = (target: DomElement) => target.dispatchEvent(new win.MouseEvent('mousemove', { bubbles: true }));
const click = (target: DomElement) => target.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
const escape = () => win.document.body.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
const pickOn = () => fromParent({ type: 'maws:pick', on: true });

describe('the bridge script (E2 Design §10)', () => {
  // one line, so an artifact's own console errors keep the line numbers of the agent's file (the script goes ahead of them)
  it('is one inline-safe line: no newline, no closing script tag, no comment opener', () => {
    expect(BRIDGE_SCRIPT).not.toMatch(/\n|\r|<\/script|<!--/i);
  });

  it('does nothing until the parent turns picking on: no overlay, clicks reach the page', () => {
    page('<button id="go">Go</button>');
    const own = vi.fn();
    $('#go').addEventListener('click', own);
    hover($('#go'));
    click($('#go'));
    expect(overlay()).toBeNull();
    expect(own).toHaveBeenCalledTimes(1);
    expect(posted).toEqual([]);
  });

  it('picks: hover draws the overlay, a click posts maws:picked to the parent and reaches no page handler', () => {
    page('<main><section><p>one</p><p class="lead big">  Second\n paragraph  </p></section></main>');
    const target = $$('p')[1]!;
    const own = vi.fn();
    target.addEventListener('click', own);
    win.document.addEventListener('click', own, true);
    pickOn();
    hover(target);
    expect(overlay()).not.toBeNull();
    // its own element name and important inline styles, so the page's CSS can neither hide it nor animate it
    expect(overlay()!.localName).toBe('maws-pick-overlay');
    for (const [name, value] of [['display', 'block'], ['pointer-events', 'none'], ['position', 'fixed'], ['transition', 'none']]) {
      expect(overlay()!.style.getPropertyValue(name), name).toBe(value);
      expect(overlay()!.style.getPropertyPriority(name), name).toBe('important');
    }
    expect(target.getAttribute('style')).toBeNull(); // the element's own styles are never touched
    click(target);
    expect(own).not.toHaveBeenCalled();
    expect(posted).toHaveLength(1);
    const [picked] = posted;
    expect(picked).toMatchObject({ type: 'maws:picked', label: 'p.lead', text: 'Second paragraph', origin: '*' });
    expect(picked!.rect).toEqual({ x: expect.any(Number), y: expect.any(Number), width: expect.any(Number), height: expect.any(Number) });
    expect($(picked!.selector!)).toBe(target);
    // one pick per Comment: picking ends, the overlay goes, and the page has its clicks back
    expect(overlay()).toBeNull();
    click(target);
    expect(own).toHaveBeenCalledTimes(2);
    expect(posted).toHaveLength(1);
  });

  it('names an element by its id when the id is unique, else by a nth-of-type chain from the nearest anchor', () => {
    page('<div id="hero"><h1>Title</h1></div><div class="x"><span>a</span><span>b</span></div><p id="dup">1</p><p id="dup">2</p>');
    const pick = (target: DomElement) => {
      pickOn();
      click(target);
      return posted.at(-1)!;
    };
    expect(pick($('#hero'))).toMatchObject({ selector: '#hero', label: 'div#hero' });
    const h1 = pick($('h1'));
    expect(h1.selector).toBe('#hero > h1:nth-of-type(1)');
    expect($(h1.selector!)).toBe($('h1'));
    const b = pick($$('span')[1]!);
    expect(b.selector).toBe('body > div:nth-of-type(2) > span:nth-of-type(2)');
    expect($(b.selector!)).toBe($$('span')[1]);
    const second = $$('p')[1]!;
    const dup = pick(second);
    expect(dup.selector).toBe('body > p:nth-of-type(2)'); // a duplicated id is no name
    expect(dup.label).toBe('p#dup');
    expect($(dup.selector!)).toBe(second);
  });

  it('keeps the chain to twelve steps for an element nested deeper', () => {
    page(`${'<div>'.repeat(15)}<b>deep</b>${'</div>'.repeat(15)}`);
    pickOn();
    click($('b'));
    const { selector } = posted[0]!;
    expect(selector!.split(' > ')).toHaveLength(12);
    expect($(selector!)).toBe($('b'));
  });

  it('Escape cancels: maws:pick-cancelled is posted, the overlay goes, the page never sees the key', () => {
    page('<p>x</p>');
    const own = vi.fn();
    win.document.body.addEventListener('keydown', own);
    pickOn();
    hover($('p'));
    escape();
    expect(posted).toEqual([{ type: 'maws:pick-cancelled', origin: '*' }]);
    expect(overlay()).toBeNull();
    expect(own).not.toHaveBeenCalled();
    escape(); // picking is off: the key is the page's again
    expect(own).toHaveBeenCalledTimes(1);
    expect(posted).toHaveLength(1);
  });

  it('re-places the overlay when the window resizes', () => {
    page('<p>x</p>');
    pickOn();
    const p = $('p');
    hover(p);
    let box = { left: 10, top: 20, width: 30, height: 40 };
    (p as unknown as { getBoundingClientRect(): unknown }).getBoundingClientRect = () => ({ ...box, right: 0, bottom: 0, x: box.left, y: box.top });
    win.dispatchEvent(new win.Event('resize'));
    expect(['left', 'top', 'width', 'height'].map((name) => overlay()!.style.getPropertyValue(name))).toEqual(['10px', '20px', '30px', '40px']);
    box = { left: 1, top: 2, width: 3, height: 4 };
    win.dispatchEvent(new win.Event('resize'));
    expect(overlay()!.style.getPropertyValue('width')).toBe('3px');
  });

  it('turns off on maws:pick { on: false } without posting anything', () => {
    page('<p>x</p>');
    pickOn();
    hover($('p'));
    fromParent({ type: 'maws:pick', on: false });
    expect(overlay()).toBeNull();
    click($('p'));
    expect(posted).toEqual([]);
  });

  it('ignores a message from any source but the parent, and any shape but maws:pick', () => {
    page('<p>x</p>');
    fromParent({ type: 'maws:pick', on: true }, win); // the page itself
    fromParent({ type: 'maws:pick', on: true }, null);
    fromParent({ type: 'maws:pick', on: 'yes' });
    fromParent('maws:pick');
    click($('p'));
    expect(posted).toEqual([]);
    expect(overlay()).toBeNull();
  });

  // P2-E1 (M3): re-pin (P2-E1 document, D8): the parent asks where an element is now, by its selector
  it('answers maws:locate with the element’s rect, null for an absent or invalid selector; it never starts picking', () => {
    page('<h1 id="hero">Title</h1><p>x</p>');
    const hero = $('#hero') as unknown as { getBoundingClientRect(): unknown };
    hero.getBoundingClientRect = () => ({ left: 4, top: 6, width: 300, height: 90, right: 304, bottom: 96, x: 4, y: 6 });
    fromParent({ type: 'maws:locate', selector: '#hero' });
    fromParent({ type: 'maws:locate', selector: '#gone' });
    fromParent({ type: 'maws:locate', selector: 'h1[' }); // querySelector throws
    expect(posted).toEqual([
      { type: 'maws:located', selector: '#hero', rect: { x: 4, y: 6, width: 300, height: 90 }, origin: '*' },
      { type: 'maws:located', selector: '#gone', rect: null, origin: '*' },
      { type: 'maws:located', selector: 'h1[', rect: null, origin: '*' },
    ]);
    hover($('p'));
    click($('p'));
    expect(overlay()).toBeNull();
    expect(posted).toHaveLength(3);
  });

  it('answers a locate from the parent alone, and only a string selector', () => {
    page('<h1 id="hero">Title</h1>');
    fromParent({ type: 'maws:locate', selector: '#hero' }, win);
    fromParent({ type: 'maws:locate', selector: '#hero' }, null);
    fromParent({ type: 'maws:locate', selector: 7 });
    fromParent({ type: 'maws:locate' });
    expect(posted).toEqual([]);
  });

  it('does nothing in a top-level document (the capture window), where there is no parent', () => {
    Object.defineProperty(win, 'parent', { configurable: true, get: () => win });
    page('<p>x</p>');
    fromParent({ type: 'maws:pick', on: true }, win);
    hover($('p'));
    click($('p'));
    expect(overlay()).toBeNull();
    expect(posted).toEqual([]);
  });
});
