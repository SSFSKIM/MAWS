// P4-B2's IME cases, simulated (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md D11; the P4 spec's §4.4 and
// §4.10; research/p4-ux-prior-art.md §2.4 I1 to I5; spikes/p4-click-model/findings.txt). ARMED as the state machine
// builds it (src/artifacts/slides/editor/armed.ts, D1 and D6: unconditional, its first key replacing the text) on the
// deck's stage, driven through the renderer's IME entry points over CDP (e2e/support/ime.ts) in the order Chromium's
// macOS view sends them. Part of `pnpm e2e:presentations`.
//
// What a simulation cannot stand in for (the real Mac's run, spikes/p4-click-model/cua-live.js): whether AppKit gives
// the armed editor an input context before the first key (CDP's IME calls go to the renderer whatever the focus), the
// 100 ms before AppKit learns of a newly focused editable, what the 2-Set input method itself does with a jamo it did not
// compose, the order of the browser's keydown and composition messages under load, the Hanja window, and keys arriving
// at the HID level, where ⌘ keys reach the page through `performKeyEquivalent:` before the menu.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { withNativeClipboard } from './support/clipboard';
import { HANA, HANGEUL, Ime, letterKey, loadTrace, replayTrace, signature, startTrace, stopTrace, type ImeTrace, type TraceEvent } from './support/ime';

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
async function ok<T>(page: Page, name: string, input?: unknown): Promise<T> {
  const result = (await page.evaluate(([n, i]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke(n as string, i), [name, input] as const)) as Result<T>;
  if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
  return result.value;
}

interface ElementIR {
  id: string;
  style: Record<string, string>;
  children: ElementIR[];
  text?: { inline: ({ text: string; marks: Record<string, unknown> } | { br: true })[] }[];
}
interface Seam {
  __maws_presentations: {
    seed(artifactId: string, files: Record<string, string>): Promise<unknown>;
    edit(artifactId: string, edit: { op: 'prependText'; slideId: string; elementId: string; text: string }): Promise<void>;
    slide(artifactId: string, slideId: string): Promise<{ children: ElementIR[] }>;
    editorState(artifactId: string): { surface: string; selection: string[]; editingText: string | null; keyboard: 'stage' | 'away' }[];
    frames(artifactId: string): { surface: string; received: number; held: number }[];
  };
}

const DECK: Record<string, string> = {
  'project/deck.json': JSON.stringify({ v: 4, title: 'IME lab', cover: 'ime', order: ['ime'] }),
  'project/slides/ime.html': `<section id="ime" style="background:#ffffff; padding:128px">
<p id="a" style="position:absolute; left:200px; top:200px; width:700px; font-size:64px">Hello</p>
<p id="b" style="position:absolute; left:1000px; top:200px; width:700px; font-size:64px"><b>World</b></p>
<ul id="l" style="position:absolute; left:200px; top:500px; width:700px; font-size:48px"><li>One</li><li>Two</li></ul>
<x-shape id="s" kind="ellipse" style="position:absolute; left:1000px; top:500px; width:300px; height:200px; background:#0000ff"></x-shape>
<div id="g" data-group="" style="position:absolute; left:1400px; top:500px; width:400px; height:200px"><h2 id="gh" style="position:absolute; left:0px; top:0px; width:400px; font-size:48px">Grouped</h2></div>
</section>`,
};
const EMPTY = { x: 100, y: 1000 }; // slide px with no element under them

let launch: MawsLaunch | null = null;
test.afterEach(async () => {
  await launch?.cleanup();
  launch = null;
});

interface Lab {
  page: Page;
  tab: Locator;
  id: string;
  ime: Ime;
  /** slide px to page px */
  at(x: number, y: number): { x: number; y: number };
  click(eid: string): Promise<void>;
  clickSlide(p: { x: number; y: number }): Promise<void>;
  text(eid: string): Promise<string>;
  /** the element's text runs with their marks */
  runs(eid: string): Promise<{ text: string; marks: Record<string, unknown> }[]>;
  left(eid: string): Promise<string | undefined>;
  count(): Promise<number>;
  state(): Promise<{ selection: string[]; editingText: string | null; keyboard: 'stage' | 'away' }>;
  /** the remote frames the tab's replica holds now (row 256) */
  held(): Promise<number>;
  /** the focused element: a text box's element id, an element's own node on the stage (D15's A3), `stage`, or else */
  focus(): Promise<string>;
}

async function lab(): Promise<Lab> {
  launch = await launchMaws();
  await launch.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1600, 1000));
  const { page } = launch;
  await expect.poll(async () => (await ok<{ state: string }>(page, 'engine.hostState')).state, { timeout: 20_000 }).toBe('ready');
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as Partial<Seam>).__maws_presentations)).toBe('object');
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'presentation', title: 'IME lab' });
  const id = artifact.id;
  await page.evaluate(([a, f]) => (window as unknown as Seam).__maws_presentations.seed(a, f), [id, DECK] as const);
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  await page.locator('[data-library]').getByRole('article', { name: 'IME lab', exact: true }).click();
  const tab = page.locator(`[data-region="main"] [data-artifact-tab="${id}"]`);
  await expect(tab.locator('[data-deck-editor]')).toBeVisible({ timeout: 15_000 });
  await expect(tab.locator('[data-stage-slide="ime"] [data-eid="a"]')).toHaveText('Hello');
  const frame = (await tab.locator('[data-stage-slide]').boundingBox())!;
  const scale = frame.width / 1920;
  const at = (x: number, y: number) => ({ x: frame.x + x * scale, y: frame.y + y * scale });
  const ime = await Ime.open(page);
  const findIn = (children: ElementIR[], eid: string): ElementIR | undefined => {
    for (const c of children) {
      if (c.id === eid) return c;
      const inner = findIn(c.children, eid);
      if (inner) return inner;
    }
    return undefined;
  };
  const slide = () => page.evaluate((a) => (window as unknown as Seam).__maws_presentations.slide(a, 'ime'), id);
  const element = async (eid: string) => findIn((await slide()).children, eid);
  return {
    page,
    tab,
    id,
    ime,
    at,
    click: async (eid) => {
      const box = (await tab.locator(`[data-stage-slide="ime"] [data-eid="${eid}"]`).boundingBox())!;
      await page.mouse.click(box.x + Math.min(40, box.width / 2), box.y + box.height / 2);
    },
    clickSlide: async (p) => {
      const q = at(p.x, p.y);
      await page.mouse.click(q.x, q.y);
    },
    text: async (eid) => ((await element(eid))?.text ?? []).map((b) => b.inline.map((r) => ('text' in r ? r.text : '\n')).join('')).join('\n'),
    runs: async (eid) => ((await element(eid))?.text ?? []).flatMap((b) => b.inline.flatMap((r) => ('text' in r ? [{ text: r.text, marks: r.marks }] : []))),
    left: async (eid) => (await element(eid))?.style.left,
    count: async () => (await slide()).children.length,
    state: async () => (await page.evaluate((a) => (window as unknown as Seam).__maws_presentations.editorState(a), id))[0]!,
    held: async () => (await page.evaluate((a) => (window as unknown as Seam).__maws_presentations.frames(a), id))[0]?.held ?? 0,
    focus: () =>
      page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        if (a?.classList.contains('deck-textbox')) return `textbox:${a.closest('[data-eid]')?.getAttribute('data-eid')}`;
        if (a?.hasAttribute('data-eid') && a.closest('[data-stage-surface]')) return `node:${a.getAttribute('data-eid')}`;
        if (a?.hasAttribute('data-stage-surface')) return 'stage';
        return a?.tagName.toLowerCase() ?? 'none';
      }),
  };
}

// What the page saw of the armed box between two points: the text box nodes mounted, ARMED's flips to EDIT, and the
// mutations of the box's own text while no key was arriving.
async function watch(page: Page): Promise<void> {
  await page.evaluate(() => {
    const stage = document.querySelector('[data-stage-surface]')!;
    const w = window as unknown as { __watch: { mounts: number; disarms: number; writes: number; stop(): void } };
    const state = { mounts: 0, disarms: 0, writes: 0 };
    const nodes = new MutationObserver((ms) => {
      for (const m of ms) {
        if (m.type === 'attributes' && m.attributeName === 'data-armed' && m.oldValue !== null && !stage.hasAttribute('data-armed')) state.disarms++;
        for (const n of Array.from(m.addedNodes)) if (n instanceof Element && n.classList.contains('deck-textbox')) state.mounts++;
        if (m.type !== 'attributes' && (m.target instanceof Element ? m.target : m.target.parentElement)?.closest('.deck-textbox')) state.writes++;
      }
    });
    nodes.observe(stage, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-armed'], attributeOldValue: true });
    w.__watch = Object.assign(state, { stop: () => nodes.disconnect() });
  });
}
const watched = (page: Page) => page.evaluate(() => {
  const { mounts, disarms, writes } = (window as unknown as { __watch: { mounts: number; disarms: number; writes: number } }).__watch;
  return { mounts, disarms, writes };
});
const count = (events: TraceEvent[], type: string) => events.filter((e) => e.type === type).length;
// a case's trace, in the report; printed too under MAWS_IME_VERBOSE=1 (the findings quote them)
function note(annotation: { type: string; description: string }) {
  test.info().annotations.push(annotation);
  if (process.env.MAWS_IME_VERBOSE === '1') console.log(`[ime] ${annotation.type}: ${annotation.description}`);
}

test('ARMED: a selected text element’s box is focused and editable with its caret hidden, and the stage keeps every other selection (I1)', async () => {
  test.setTimeout(120_000);
  const l = await lab();
  await l.click('a');
  await l.page.waitForTimeout(150);
  expect(await l.focus()).toBe('textbox:a');
  const box = l.tab.locator('[data-eid="a"] .deck-textbox');
  expect(await box.evaluate((n) => ({ editable: (n as HTMLElement).isContentEditable, caret: getComputedStyle(n).caretColor, inside: n.contains(getSelection()!.anchorNode), collapsed: getSelection()!.isCollapsed }))).toEqual({ editable: true, caret: 'rgba(0, 0, 0, 0)', inside: true, collapsed: true });
  // a solid frame with handles, not the edit's dashed one; no mark bar
  await expect(l.tab.locator('[data-overlay] [data-selected="a"]')).not.toHaveAttribute('data-editing');
  await expect(l.tab.locator('[data-overlay] [data-handle="se"]')).toHaveCount(1);
  await expect(l.tab.locator('.deck-markbar')).toHaveCount(0);
  expect(await l.state()).toEqual(expect.objectContaining({ selection: ['a'], editingText: null }));
  // a press the stage keeps (a handle) leaves a armed, its focus given back
  const handle = (await l.tab.locator('[data-overlay] [data-handle="se"]').boundingBox())!;
  await l.page.mouse.click(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await expect.poll(() => l.focus()).toBe('textbox:a');
  // an edit, then a shift-press on another element: the edit ends, both selected, the stage's
  await l.ime.rawKey({ key: 'x', code: 'KeyX', keyCode: 88, text: 'x' });
  await expect.poll(() => l.state()).toEqual(expect.objectContaining({ editingText: 'a' }));
  await l.page.keyboard.down('Shift');
  await l.click('b');
  await l.page.keyboard.up('Shift');
  await expect.poll(() => l.state()).toEqual(expect.objectContaining({ selection: ['a', 'b'], editingText: null }));
  await expect(l.tab.locator('.deck-markbar')).toHaveCount(0);
  expect(await l.focus()).toBe('stage');
  // a shape or a group: its own node (D15's A3, focus following the selection); two elements: the stage
  await l.click('s');
  await expect.poll(() => l.focus()).toBe('node:s');
  await l.click('gh'); // the group, picked at the slide's level
  await expect(l.tab.locator('[data-overlay] [data-selected="g"]')).toHaveCount(1);
  await expect.poll(() => l.focus()).toBe('node:g');
  await l.click('a');
  await l.page.keyboard.down('Shift');
  await l.click('b');
  await l.page.keyboard.up('Shift');
  await expect(l.tab.locator('[data-overlay] [data-selected]')).toHaveCount(2);
  expect(await l.focus()).toBe('stage');
  // D1: the keyboard away (the speaker notes focused) unmounts the armed box, the selection kept; a press on the stage
  // takes the keyboard back (on the element still selected, T3: its caret)
  await l.click('b');
  await expect.poll(() => l.focus()).toBe('textbox:b');
  const notesDisclosure = l.tab.getByRole('button', { name: 'Speaker notes', exact: true });
  if (await notesDisclosure.getAttribute('aria-expanded') !== 'true') await notesDisclosure.click();
  const notes = l.tab.getByRole('textbox', { name: 'Speaker notes', exact: true });
  await expect(notes).toBeVisible();
  await notes.focus();
  await expect(notes).toBeFocused();
  await expect.poll(() => l.state()).toEqual(expect.objectContaining({ selection: ['b'], keyboard: 'away' }));
  await expect(l.tab.locator('.deck-textbox')).toHaveCount(0);
  await l.click('b');
  await expect.poll(() => l.focus()).toBe('textbox:b');
});

test('ARMED: 한글 typed on “Hello” composes in place and replaces it, the content gone before the composition starts (I2, Q2, T11)', async () => {
  test.setTimeout(120_000);
  const l = await lab();
  await l.click('a');
  await expect.poll(() => l.focus()).toBe('textbox:a');
  await watch(l.page);
  await startTrace(l.page);
  const root = await l.page.evaluateHandle(() => document.activeElement);
  await l.ime.type(HANGEUL);
  const sameRoot = await l.page.evaluate((r) => r === document.activeElement, root);
  const typed = await watched(l.page);
  await l.clickSlide(EMPTY); // the composition finished by the press, the element left (T9)
  const events = await stopTrace(l.page);
  note({ type: 'trace', description: signature(events).join(' | ') });
  await expect.poll(() => l.text('a')).toBe('한글');
  expect((await l.text('a')).normalize('NFC')).toBe('한글');
  const typing = events.slice(0, events.findIndex((e) => e.type === 'pointerdown'));
  // one text box, focused throughout, armed once and edited once; two syllables composed on it
  expect(sameRoot).toBe(true);
  expect(count(typing, 'focusin') + count(typing, 'focusout')).toBe(0);
  expect(typed).toEqual(expect.objectContaining({ mounts: 0, disarms: 1 }));
  expect(count(events, 'compositionstart')).toBe(2);
  expect(count(events, 'compositionend')).toBe(2);
  expect(new Set(events.filter((e) => e.type.startsWith('composition')).map((e) => e.target))).toEqual(new Set(['textbox:a']));
  // Q2 and T11: the first keydown is keyCode 229 and not composing; its handlers clear the content, its default left to
  // the input method, and the composition starts on an empty box
  const first = events.find((e) => e.type === 'keydown')!;
  expect(first).toEqual(expect.objectContaining({ keyCode: 229, key: 'ㅎ', isComposing: false, textBefore: 'Hello', defaultPrevented: false }));
  expect(first.textAfter).toBe('');
  const start = events.find((e) => e.type === 'compositionstart')!;
  expect(start.textBefore).toBe('');
  expect(events.find((e) => e.type === 'input')?.textAfter).toBe('ㅎ'); // the first jamo is the box's whole text
  // b's text is one bold run: replaced, it stays bold
  await l.click('b');
  await expect.poll(() => l.focus()).toBe('textbox:b');
  await l.ime.type(HANA);
  await l.clickSlide(EMPTY);
  await expect.poll(() => l.text('b')).toBe('하나');
  expect(await l.runs('b')).toEqual([{ text: '하나', marks: { b: {} } }]);
});

test('ARMED: a first jamo arriving bare, then a composition replacing it, ends as 한글 with nothing written between the keys; 하나 carries its consonant (I3, L2)', async () => {
  test.setTimeout(120_000);
  const l = await lab();
  await l.click('a');
  await expect.poll(() => l.focus()).toBe('textbox:a');
  await watch(l.page);
  await startTrace(l.page);
  // key 1 with no input method: the 2-Set layout's own character, typed raw (keyCode G's): T10, the box typing it over
  // the text itself (its default cancelled)
  const g = letterKey('g');
  await l.ime.rawKey({ key: 'ㅎ', code: g.code, keyCode: g.keyCode, text: 'ㅎ' });
  await expect(l.tab.locator('[data-eid="a"] .deck-textbox')).toHaveText('ㅎ');
  const afterKey1 = (await watched(l.page)).writes;
  await l.page.waitForTimeout(200);
  expect((await watched(l.page)).writes).toBe(afterKey1); // MAWS writes nothing to the box between keys 1 and 2
  // key 2: the input method now attached, re-composing the bare ㅎ through a replacement range. An assumption (research
  // §2.4 I3), not observed: if the 2-Set input method starts a fresh composition instead, the real result keeps the bare
  // ㅎ (ㅎ안글), which this case cannot show; L4 on the real Mac settles it
  await l.ime.processKey('ㅏ');
  await l.ime.compose('하', { start: 0, end: 1 });
  await l.ime.type(HANGEUL.slice(2));
  await l.clickSlide(EMPTY);
  const events = await stopTrace(l.page);
  note({ type: 'trace (bare first jamo)', description: signature(events).join(' | ') });
  await expect.poll(() => l.text('a')).toBe('한글');
  expect(events.find((e) => e.type === 'keydown')).toEqual(expect.objectContaining({ key: 'ㅎ', keyCode: 71, textBefore: 'Hello', defaultPrevented: true }));

  // L2: 하나, the ㄴ of 한 moving to the next syllable; b's text is one bold run, and the cleared box keeps it bold
  await l.click('b');
  await expect.poll(() => l.focus()).toBe('textbox:b');
  await l.ime.type(HANA);
  await l.clickSlide(EMPTY);
  await expect.poll(() => l.text('b')).toBe('하나');
  expect(await l.runs('b')).toEqual([{ text: '하나', marks: { b: {} } }]);
});

test('keys during a composition take no element action, and a remote change waits for its end (I4, I5)', async () => {
  test.setTimeout(120_000);
  const l = await lab();
  await l.click('a');
  await expect.poll(() => l.focus()).toBe('textbox:a');
  await l.ime.step(HANGEUL[0]!);
  // I4: what the input method forwards while it composes arrives as keyCode 229; a key it lets through still composes
  for (const key of ['Escape', 'Enter', 'Backspace', 'ArrowLeft', 'Tab']) await l.ime.cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, windowsVirtualKeyCode: 229 });
  await l.ime.rawKey({ key: 'Escape', code: 'Escape', keyCode: 27 }); // isComposing, keyCode 27 (Safari's way; not Chromium's on macOS)
  expect(await l.left('a')).toBe('200px');
  expect(await l.count()).toBe(5);
  expect(await l.state()).toEqual(expect.objectContaining({ selection: ['a'], editingText: 'a' }));
  // I5: a remote edit landing during the composition is held by the replica until it ends
  await l.ime.step(HANGEUL[1]!);
  await l.page.evaluate(([a]) => (window as unknown as Seam).__maws_presentations.edit(a!, { op: 'prependText', slideId: 'ime', elementId: 'a', text: 'Remote ' }), [l.id] as const);
  // row 256: the tab's replica holds the frame before the negative check (its provider's count, not a fixed wait)
  await expect.poll(() => l.held()).toBeGreaterThan(0);
  await expect(l.tab.locator('[data-eid="a"] .deck-textbox')).toHaveText('하');
  await l.ime.commit('하');
  await expect.poll(() => l.held()).toBe(0);
  await expect.poll(() => l.text('a')).toBe('Remote 하');
  await expect(l.tab.locator('[data-eid="a"] .deck-textbox')).toHaveText('Remote 하');
});

test('a composition in one box, then a press on another: the first keeps its syllable, the second gets no jamo (L5, the renderer’s half)', async () => {
  test.setTimeout(120_000);
  const l = await lab();
  await l.click('a');
  await expect.poll(() => l.focus()).toBe('textbox:a');
  await l.ime.type(HANGEUL.slice(0, 2)); // 하, composing
  await startTrace(l.page);
  await l.click('b');
  await expect.poll(() => l.focus()).toBe('textbox:b');
  const events = await stopTrace(l.page);
  note({ type: 'trace (press mid-composition)', description: signature(events).join(' | ') });
  await expect.poll(() => l.text('a')).toBe('하');
  expect(await l.text('b')).toBe('World');
  await l.ime.type(HANGEUL.slice(0, 1));
  await l.clickSlide(EMPTY);
  await expect.poll(() => l.text('b')).toBe('ㅎ');
});

test('⌘ keys while ARMED: a key the page cancels never reaches the menu, the rest do; the Edit menu’s commands act on the element (Q3, K6)', async () => {
  test.setTimeout(150_000);
  const l = await lab();
  const app = launch!.app;
  // A probe menu in place of MAWS's (kept while the probe runs: main reinstalls its menu as the page's actions change),
  // its Edit items counting their accelerators. Role items act through the key window's first responder, which a quiet
  // e2e window never is; the probe's own items need no window.
  await app.evaluate(({ Menu }) => {
    const g = globalThis as unknown as { __hits: Record<string, number>; __menu: { saved: Electron.Menu | null; set: typeof Menu.setApplicationMenu } };
    g.__hits = { undo: 0, redo: 0, cut: 0, copy: 0, paste: 0 };
    g.__menu = { saved: Menu.getApplicationMenu(), set: Menu.setApplicationMenu.bind(Menu) };
    const hit = (name: string) => () => void g.__hits[name]!++;
    const probe = Menu.buildFromTemplate([
      { label: 'MAWS', submenu: [{ role: 'quit' }] },
      {
        label: 'Edit',
        submenu: [
          { label: 'Undo', accelerator: 'Cmd+Z', click: hit('undo') },
          { label: 'Redo', accelerator: 'Shift+Cmd+Z', click: hit('redo') },
          { label: 'Cut', accelerator: 'Cmd+X', click: hit('cut') },
          { label: 'Copy', accelerator: 'Cmd+C', click: hit('copy') },
          { label: 'Paste', accelerator: 'Cmd+V', click: hit('paste') },
        ],
      },
    ]);
    g.__menu.set(probe);
    Menu.setApplicationMenu = () => {};
  });
  const hits = () => app.evaluate(() => ({ ...(globalThis as unknown as { __hits: Record<string, number> }).__hits }));
  const restore = () =>
    app.evaluate(({ Menu }) => {
      const g = globalThis as unknown as { __menu: { saved: Electron.Menu | null; set: typeof Menu.setApplicationMenu } };
      Menu.setApplicationMenu = g.__menu.set;
      Menu.setApplicationMenu(g.__menu.saved);
    });
  try {
    // control: the stage focused, nothing selected; ⌘C is the page's to leave (the stage copies on the menu's `copy`)
    await l.clickSlide(EMPTY);
    expect(await l.focus()).toBe('stage');
    await l.ime.command('c');
    await expect.poll(hits).toEqual(expect.objectContaining({ copy: 1 }));
    // a ⌘Z the deck takes on the stage (DeckEditor's undo) is cancelled, and the menu never sees it
    await l.ime.command('z');
    await l.page.waitForTimeout(200);
    expect((await hits()).undo).toBe(0);

    await l.click('a');
    await expect.poll(() => l.focus()).toBe('textbox:a');
    // an element key while armed: the arrow nudges the element, not the caret
    await l.ime.rawKey({ key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 });
    await expect.poll(() => l.left('a')).toBe('201px');
    expect(await l.text('a')).toBe('Hello');
    // ⌘Z while armed: the box's own (the deck's stack), cancelled; one step undone, the menu's Undo never reached
    await l.ime.command('z');
    await expect.poll(() => l.left('a')).toBe('200px');
    await l.page.waitForTimeout(200);
    expect((await hits()).undo).toBe(0);
    expect(await l.focus()).toBe('textbox:a');
    // ⌘C while armed: left to the menu, whose Copy fires; a page that cancels it keeps it from the menu
    await l.ime.command('c');
    await expect.poll(hits).toEqual(expect.objectContaining({ copy: 2 }));
    await l.page.evaluate(() => {
      const cancel = (e: KeyboardEvent) => e.metaKey && e.key === 'c' && e.preventDefault();
      addEventListener('keydown', cancel, { capture: true, once: true });
    });
    await l.ime.command('c');
    await l.page.waitForTimeout(200);
    expect((await hits()).copy).toBe(2);
  } finally {
    await restore();
  }

  // The Edit menu by the mouse. Copy and Paste are role items (webContents' copy and paste, which the native items' copy:
  // and paste: reach): they act on the armed element, never its text. Undo and Redo are K6's app items (D10: `edit.undo`
  // and `edit.redo`, clicked by id as the native menu calls them), which reach the deck's stack through the focused
  // editor's claim; under the role, Blink sent no `historyUndo` with its own undo stack empty (findings.txt, "The Edit
  // menu's Undo"), so the menu's Undo did nothing to the deck.
  await withNativeClipboard(app, ['Hello', ''], async () => {
    expect(await l.focus()).toBe('textbox:a');
    const command = (name: 'copy' | 'paste') => app.evaluate(({ BrowserWindow }, n) => BrowserWindow.getAllWindows()[0]!.webContents[n](), name);
    const menuItem = async (item: 'edit.undo' | 'edit.redo') =>
      expect(
        await app.evaluate(({ Menu }, menuId) => {
          const found = Menu.getApplicationMenu()?.getMenuItemById(menuId);
          found?.click();
          return found != null;
        }, item),
        `the menu has ${item}`,
      ).toBe(true);
    await command('copy');
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('Hello');
    await command('paste');
    await expect.poll(() => l.count()).toBe(6);
    expect(await l.text('a')).toBe('Hello');
    const pasted = (await l.state()).selection;
    expect(pasted).toHaveLength(1);
    expect(pasted[0]).not.toBe('a');
    await expect.poll(() => l.focus()).toBe(`textbox:${pasted[0]}`); // the pasted text element, armed in its turn
    // K6: Edit › Undo while armed undoes the deck's step (the paste), the box's claim; Redo pastes it again
    await startTrace(l.page);
    await menuItem('edit.undo');
    await expect.poll(() => l.count()).toBe(5);
    const undone = await stopTrace(l.page);
    note({ type: 'Edit › Undo while armed', description: signature(undone).join(' | ') || '(no event)' });
    expect(undone.filter((e) => e.type === 'beforeinput')).toEqual([]); // the claim, not Blink's historyUndo
    expect(await l.text('a')).toBe('Hello');
    await menuItem('edit.redo');
    await expect.poll(() => l.count()).toBe(6);
    // the live L8's way back to a from the armed copy, which covers it (a pinned paste is keyed over every sibling, so
    // Shift+Tab would reach the last other element): Escape to nothing selected, then Tab to the slide's first element
    await l.ime.rawKey({ key: 'Escape', code: 'Escape', keyCode: 27 });
    await expect.poll(() => l.focus()).toBe('stage');
    await l.ime.rawKey({ key: 'Tab', code: 'Tab', keyCode: 9 });
    await expect.poll(() => l.focus()).toBe('textbox:a');
    await l.ime.command('z'); // the keyboard's ⌘Z is the box's: the paste undone
    await expect.poll(() => l.count()).toBe(5);
    expect(await l.text('a')).toBe('Hello');
    // the stage alike: a nudge of the shape, Edit › Undo takes it back and Edit › Redo does it again; ⌘Z undoes it
    await l.click('s');
    await l.ime.rawKey({ key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 });
    const top = async () => (await l.page.evaluate((a) => (window as unknown as Seam).__maws_presentations.slide(a, 'ime'), l.id)).children.find((c) => c.id === 's')?.style.top;
    await expect.poll(top).toBe('501px');
    await menuItem('edit.undo');
    await expect.poll(top).toBe('500px');
    await menuItem('edit.redo');
    await expect.poll(top).toBe('501px');
    await l.ime.command('z');
    await expect.poll(top).toBe('500px');
  });
});

const FIXTURE = join(REPO_ROOT, 'e2e/fixtures/ime/l1-hangul.json');
test('the L1 fixture replays through CDP to the events it recorded (the trace loader)', async () => {
  test.setTimeout(120_000);
  // MAWS_IME_WRITE_FIXTURE=1: (re)writes the stand-in, this harness's own L1, until the real Mac's run records one
  if (process.env.MAWS_IME_WRITE_FIXTURE === '1') {
    const l = await lab();
    await startTrace(l.page);
    await l.click('a');
    await expect.poll(() => l.focus()).toBe('textbox:a');
    await l.page.waitForTimeout(150);
    await l.ime.type(HANGEUL);
    await l.clickSlide(EMPTY);
    const events = await stopTrace(l.page);
    await expect.poll(() => l.text('a')).toBe('한글');
    const versions = await launch!.app.evaluate(() => ({ electron: process.versions.electron, chrome: process.versions.chrome }));
    const trace: ImeTrace = { source: 'cdp-synthetic', case: 'L1', recordedAt: new Date().toISOString(), mode: 'clear', ...versions, notes: 'A stand-in: e2e/support/ime.ts HANGEUL through CDP, not an input method. Replaced by the real Mac run (spikes/p4-click-model/cua-live.js, L1).', events };
    mkdirSync(dirname(FIXTURE), { recursive: true });
    writeFileSync(FIXTURE, `${JSON.stringify(trace, null, 1)}\n`);
    return;
  }
  const fixture = loadTrace(FIXTURE);
  const l = await lab();
  await l.click('a');
  await expect.poll(() => l.focus()).toBe('textbox:a');
  await startTrace(l.page);
  // from the first key: the press that armed the box is the case's own
  const typed = { ...fixture, events: fixture.events.slice(fixture.events.findIndex((e) => e.type === 'keydown')) };
  const report = await replayTrace(l.ime, typed, l.clickSlide);
  const events = await stopTrace(l.page);
  note({ type: `replay of ${fixture.source}`, description: report.calls.join(' | ') });
  expect(report.skipped).toEqual([]);
  expect(signature(events)).toEqual(signature(typed.events));
  await expect.poll(() => l.text('a')).toBe('한글');
});
