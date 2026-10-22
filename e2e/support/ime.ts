// The input method over CDP, and the trace an input method leaves in a page (P4-B2's spike S-IME,
// docs/doperpowers/plans/2026-10-19-p4-smoothing.md §4.4, §4.10; spikes/p4-click-model/findings.txt). Playwright's
// `keyboard.insertText` dispatches only `input` and never a composition, so the simulated cases drive the renderer's
// own IME entry points through a CDP session, in the order Chromium's macOS view sends them for a key the input method
// takes (render_widget_host_view_cocoa.mm `keyEvent:wasKeyEquivalent:`): a keydown with keyCode 229, then the commit
// (`Input.insertText`, the browser's ImeCommitText) and the new marked text (`Input.imeSetComposition`).
//
// The trace: what a page sees of keys, compositions, input and focus, recorded by listeners the recorder adds (the
// window's capture phase first, so each record holds the text before the page's own handlers, and its bubble phase
// last, for the text after them and whether a handler cancelled the event). A trace recorded on the real Mac with the
// Korean 2-Set input method (spikes/p4-click-model/cua-live.js, e2e/presentations-ime-live.spec.ts) is a fixture the
// simulated cases replay (`replayTrace`); `signature` compares what a replay produced with what the input method did.
import { readFileSync } from 'node:fs';
import type { CDPSession, Page } from '@playwright/test';

/** One 2-Set key: the physical key (US layout), as DOM and macOS name it. */
export interface PhysicalKey {
  code: string;
  /** The Windows virtual key code Chromium gives the key outside a composition. */
  keyCode: number;
  /** macOS's virtual key code (kVK_ANSI_*), which lets an unhandled key reach the app's menu (input_handler.cc). */
  native: number;
}

const LETTER_NATIVE: Record<string, number> = { a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9, b: 11, q: 12, w: 13, e: 14, r: 15, y: 16, t: 17, o: 31, u: 32, i: 34, p: 35, l: 37, j: 38, k: 40, n: 45, m: 46 };
export const letterKey = (letter: string): PhysicalKey => ({ code: `Key${letter.toUpperCase()}`, keyCode: letter.toUpperCase().charCodeAt(0), native: LETTER_NATIVE[letter]! });

/** The Korean 2-Set layout: each jamo and the US letter of its key. */
export const TWO_SET: Record<string, string> = {
  ㅂ: 'q', ㅈ: 'w', ㄷ: 'e', ㄱ: 'r', ㅅ: 't', ㅛ: 'y', ㅕ: 'u', ㅑ: 'i', ㅐ: 'o', ㅔ: 'p',
  ㅁ: 'a', ㄴ: 's', ㅇ: 'd', ㄹ: 'f', ㅎ: 'g', ㅗ: 'h', ㅓ: 'j', ㅏ: 'k', ㅣ: 'l',
  ㅋ: 'z', ㅌ: 'x', ㅊ: 'c', ㅍ: 'v', ㅠ: 'b', ㅜ: 'n', ㅡ: 'm',
};

/**
 * One key the input method took: the jamo the key types, what it commits (if anything) and the marked text after it,
 * as macOS's 2-Set input method reports them through `insertText:` and `setMarkedText:`.
 */
export interface ImeStep {
  jamo: string;
  commit?: string;
  marked: string;
}

/** 한글 typed on 2-Set (g k s r m f): ㅎ, 하, 한, then 한 committed with ㄱ marked, 그, 글. */
export const HANGEUL: readonly ImeStep[] = [
  { jamo: 'ㅎ', marked: 'ㅎ' },
  { jamo: 'ㅏ', marked: '하' },
  { jamo: 'ㄴ', marked: '한' },
  { jamo: 'ㄱ', commit: '한', marked: 'ㄱ' },
  { jamo: 'ㅡ', marked: '그' },
  { jamo: 'ㄹ', marked: '글' },
];
/** 하나 (g k s k): the ㄴ of 한 carried into the next syllable as the vowel arrives (L2). */
export const HANA: readonly ImeStep[] = [
  { jamo: 'ㅎ', marked: 'ㅎ' },
  { jamo: 'ㅏ', marked: '하' },
  { jamo: 'ㄴ', marked: '한' },
  { jamo: 'ㅏ', commit: '하', marked: '나' },
];

/** The renderer's IME entry points over a CDP session of `page`. */
export class Ime {
  private constructor(readonly cdp: CDPSession) {}
  static async open(page: Page): Promise<Ime> {
    return new Ime(await page.context().newCDPSession(page));
  }

  /** A keydown as Chromium sends one the input method took: keyCode 229 (VKEY_PROCESSKEY), `key` the raw jamo. */
  async processKey(jamo: string): Promise<void> {
    const key = letterKey(TWO_SET[jamo] ?? jamo);
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: jamo, code: key.code, windowsVirtualKeyCode: 229, nativeVirtualKeyCode: key.native });
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: jamo, code: key.code, windowsVirtualKeyCode: 229, nativeVirtualKeyCode: key.native });
  }
  /** The marked text, the caret at its end, optionally replacing a range of the editable's text first. */
  async compose(text: string, replace?: { start: number; end: number }): Promise<void> {
    await this.cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length, ...(replace ? { replacementStart: replace.start, replacementEnd: replace.end } : {}) });
  }
  /** Text committed (ImeCommitText): the composition, if any, replaced by it and ended. */
  async commit(text: string): Promise<void> {
    await this.cdp.send('Input.insertText', { text });
  }
  /** One key the input method took, as the macOS view sends it: the keydown, then the commit and the marked text. */
  async step(step: ImeStep): Promise<void> {
    await this.processKey(step.jamo);
    if (step.commit !== undefined) await this.commit(step.commit);
    await this.compose(step.marked);
  }
  async type(steps: readonly ImeStep[]): Promise<void> {
    for (const step of steps) await this.step(step);
  }
  /**
   * A key with no input method in the way (the input source's own character, or a control key), as a raw keydown and,
   * when it types, a char event; with `native`, a key the page leaves alone reaches the app's menu.
   */
  async rawKey(options: { key: string; code: string; keyCode: number; native?: number; text?: string; unmodifiedText?: string; modifiers?: number }): Promise<void> {
    const { key, code, keyCode, native, text, modifiers = 0 } = options;
    // macOS needs the unmodified character for the key's NSEvent to be a key at all (native_web_keyboard_event_mac.mm)
    const unmodified = options.unmodifiedText ?? text ?? ([...key].length === 1 ? key.toLowerCase() : '');
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode, modifiers, ...(native !== undefined ? { nativeVirtualKeyCode: native } : {}), ...(unmodified ? { unmodifiedText: unmodified } : {}) });
    if (text) await this.cdp.send('Input.dispatchKeyEvent', { type: 'char', key, code, windowsVirtualKeyCode: keyCode, text, unmodifiedText: text, modifiers });
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers, ...(native !== undefined ? { nativeVirtualKeyCode: native } : {}) });
  }
  /** ⌘ with a letter, carrying macOS's key code, so a key the page does not cancel reaches the app's menu. */
  async command(letter: string, options: { shift?: boolean } = {}): Promise<void> {
    const key = letterKey(letter);
    // as macOS builds ⌘C's NSEvent: characters and charactersIgnoringModifiers both the letter (no char event follows)
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: letter, code: key.code, windowsVirtualKeyCode: key.keyCode, nativeVirtualKeyCode: key.native, text: letter, unmodifiedText: letter, modifiers: 4 | (options.shift ? 8 : 0) });
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: letter, code: key.code, windowsVirtualKeyCode: key.keyCode, nativeVirtualKeyCode: key.native, modifiers: 4 | (options.shift ? 8 : 0) });
  }
}

// ---- the trace

/** One event as the page saw it. `textBefore` and `textAfter` are the focused editable's text around its handlers. */
export interface TraceEvent {
  /** ms since the recorder started */
  t: number;
  type: string;
  key?: string;
  code?: string;
  keyCode?: number;
  isComposing?: boolean;
  data?: string | null;
  inputType?: string;
  /** what the target was: `textbox:<element id>`, `stage`, `node:<element id>`, or a tag name */
  target: string;
  /** a pointer press's place on the slide, in the slide's own px (so a replay finds it at another zoom) */
  slide?: { x: number; y: number };
  textBefore?: string;
  textAfter?: string;
  defaultPrevented?: boolean;
}

/** A recorded trace and where it came from. */
export interface ImeTrace {
  /** `live-hid` (the real Mac, keys at the HID level) or `cdp-synthetic` (this harness's own steps, a stand-in) */
  source: 'live-hid' | 'cdp-synthetic';
  case: string;
  recordedAt: string;
  host?: string;
  macos?: string;
  inputSource?: string;
  electron?: string;
  chrome?: string;
  mode?: string;
  notes?: string;
  events: TraceEvent[];
}

const TRACED = ['keydown', 'keyup', 'keypress', 'compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input', 'focusin', 'focusout', 'pointerdown', 'copy', 'cut', 'paste'] as const;

/** Starts recording in the page (the recorder lives on `window.__ime_trace` until stopped). */
export async function startTrace(page: Page): Promise<void> {
  await page.evaluate((types) => {
    type Rec = Record<string, unknown>;
    const w = window as unknown as { __ime_trace?: { events: Rec[]; stop(): void } };
    w.__ime_trace?.stop();
    const t0 = performance.now();
    const events: Rec[] = [];
    const open = new WeakMap<Event, Rec>();
    const editable = (): HTMLElement | null => {
      const a = document.activeElement as HTMLElement | null;
      return a && a.isContentEditable ? a : null;
    };
    const describe = (n: EventTarget | null): string => {
      if (!(n instanceof Element)) return String(n);
      const box = n.closest('.deck-textbox');
      const eid = n.closest('[data-eid]')?.getAttribute('data-eid');
      if (box) return `textbox:${eid ?? '?'}`;
      if (n.closest('[data-stage-surface]')) return eid ? `node:${eid}` : 'stage';
      return n.tagName.toLowerCase();
    };
    const first = (e: Event) => {
      const r: Rec = { t: Math.round((e.timeStamp - t0) * 10) / 10, type: e.type, target: describe(e.target) };
      if (e instanceof KeyboardEvent) Object.assign(r, { key: e.key, code: e.code, keyCode: e.keyCode, isComposing: e.isComposing });
      if (e instanceof CompositionEvent) r.data = e.data;
      if (e instanceof InputEvent) Object.assign(r, { inputType: e.inputType, data: e.data, isComposing: e.isComposing });
      if (e instanceof PointerEvent) {
        const frame = document.querySelector('[data-stage-slide]')?.getBoundingClientRect();
        if (frame) r.slide = { x: Math.round(((e.clientX - frame.left) * 1920) / frame.width), y: Math.round(((e.clientY - frame.top) * 1920) / frame.width) };
      }
      const ed = editable();
      if (ed) r.textBefore = ed.textContent;
      events.push(r);
      open.set(e, r);
      // an event a handler stopped never reaches the window's bubble phase: whether it was cancelled is read after its
      // dispatch instead
      setTimeout(() => {
        if (r.defaultPrevented === undefined) r.defaultPrevented = e.defaultPrevented;
      }, 0);
    };
    const last = (e: Event) => {
      const r = open.get(e);
      if (!r) return;
      r.defaultPrevented = e.defaultPrevented;
      const ed = editable();
      if (ed) r.textAfter = ed.textContent;
    };
    for (const type of types) {
      window.addEventListener(type, first, true);
      window.addEventListener(type, last, false);
    }
    w.__ime_trace = {
      events,
      stop: () => {
        for (const type of types) {
          window.removeEventListener(type, first, true);
          window.removeEventListener(type, last, false);
        }
      },
    };
  }, TRACED as unknown as string[]);
}

/** Stops recording and answers what was recorded. */
export async function stopTrace(page: Page): Promise<TraceEvent[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __ime_trace?: { events: TraceEvent[]; stop(): void } };
    const trace = w.__ime_trace;
    if (!trace) return [];
    trace.stop();
    delete w.__ime_trace;
    return trace.events;
  });
}

export function loadTrace(path: string): ImeTrace {
  const trace = JSON.parse(readFileSync(path, 'utf8')) as ImeTrace;
  if (!Array.isArray(trace.events) || (trace.source !== 'live-hid' && trace.source !== 'cdp-synthetic')) throw new Error(`${path} is not an IME trace`);
  return trace;
}

/**
 * The trace's events as the renderer's entry points produced them, for comparing a replay with what was recorded:
 * each keydown (its key, keyCode, isComposing), each composition event with its data, each input event's type and
 * data, each focus change. Times, keyups, keypresses and the recorder's text snapshots are left out.
 */
export function signature(events: readonly TraceEvent[]): string[] {
  return events.flatMap((e) => {
    if (e.type === 'keydown') return [`keydown ${e.key} ${e.keyCode}${e.isComposing ? ' composing' : ''}`];
    if (e.type.startsWith('composition')) return [`${e.type} ${e.data ?? ''}`];
    if (e.type === 'beforeinput' || e.type === 'input') return [`${e.type} ${e.inputType} ${e.data ?? ''}`];
    if (e.type === 'focusin' || e.type === 'focusout' || e.type === 'pointerdown') return [`${e.type} ${e.target}`];
    return [];
  });
}

/**
 * Whether the composition that ends at or after `i` ended inside a key's handling (the input method committed it), not
 * by a press or a focus change since the last key (the composition finished as focus left).
 */
function committed(events: readonly TraceEvent[], i: number): boolean {
  let at = i;
  while (at < events.length && events[at]!.type !== 'compositionend') at++;
  for (let j = at - 1; j >= 0; j--) {
    const type = events[j]!.type;
    if (type === 'keydown') return true;
    if (type === 'pointerdown' || type === 'focusout') return false;
  }
  return false;
}

/** What a replay could not reproduce from a trace (an event with no CDP entry point), named per event. */
export interface ReplayReport {
  calls: string[];
  skipped: string[];
}

/**
 * Replays a trace's keys and compositions through `ime`: a keydown with keyCode 229 as the process key; the composition
 * events as `imeSetComposition` with their data; a composition that ended inside a key's handling (a commit) as
 * `insertText`; any other keydown as a raw key with its char; a pointer press as a click at the same place on the
 * slide (`click` maps slide px to the page). A composition that ended with no key (focus moved) ends here only through
 * the replayed press that moved it.
 */
export async function replayTrace(ime: Ime, trace: ImeTrace, click: (slide: { x: number; y: number }) => Promise<void>): Promise<ReplayReport> {
  const calls: string[] = [];
  const skipped: string[] = [];
  const events = trace.events;
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.type === 'keydown') {
      if (e.keyCode === 229) {
        const key = letterKey(TWO_SET[e.key ?? ''] ?? 'a');
        await ime.cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: e.key, code: e.code ?? key.code, windowsVirtualKeyCode: 229 });
        calls.push(`processKey ${e.key}`);
      } else {
        const typed = events.slice(i + 1).find((n) => n.type === 'keypress' || n.type === 'keydown' || n.type === 'keyup');
        const text = typed?.type === 'keypress' && e.key && [...e.key].length === 1 ? e.key : undefined;
        await ime.rawKey({ key: e.key ?? '', code: e.code ?? '', keyCode: e.keyCode ?? 0, text });
        calls.push(`rawKey ${e.key}${text ? ' typed' : ''}`);
      }
    } else if (e.type === 'compositionupdate') {
      // a commit's own update (its text set as the composition, then ended, within the key) comes with the commit
      const next = events.slice(i + 1).find((n) => n.type.startsWith('composition') || n.type === 'keydown');
      if (next?.type === 'compositionend' && next.data === e.data && committed(events, i)) continue;
      await ime.compose(e.data ?? '');
      calls.push(`compose ${e.data}`);
    } else if (e.type === 'compositionend') {
      if (committed(events, i)) {
        await ime.commit(e.data ?? '');
        calls.push(`commit ${e.data}`);
      }
    } else if (e.type === 'pointerdown') {
      if (e.slide) {
        await click(e.slide);
        calls.push(`click ${e.slide.x},${e.slide.y}`);
      } else skipped.push(`pointerdown at ${e.t} has no slide place`);
    }
  }
  return { calls, skipped };
}
