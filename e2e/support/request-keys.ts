// The keys that answer a permission prompt (UX wave U1a, Interfaces §D): ⌘Enter allows once, ⇧⌘Enter gives the lasting
// scope the prompt's third button names, Esc denies. Each answers nothing for the prompt's first 400 ms, so a scene
// presses one the way requests.spec.ts's `answerDialog` presses a dialog's key: at the card it found, again only while
// that card still shows its control enabled, until the answer is out. No scene sleeps for the 400 ms, and none presses
// a key at a card it has not found.
import { expect, type Locator, type Page } from '@playwright/test';

export const ALLOW_ONCE_KEY = 'Meta+Enter';
export const ALLOW_LASTING_KEY = 'Meta+Shift+Enter';
export const DENY_KEY = 'Escape';

// UX wave U1b: a session's request is drawn in its transcript, a question's or a plan's form in the row of its call and
// every other request at the transcript's end (`[data-request-end]`, in the end row). Its keys are owned by the
// transcript row that holds it (decision 6: the row a jump puts the keyboard on), a `.transcript-row` the list makes
// focusable; the card itself is a `group` named by its kind's heading and takes no focus.
export const END_ROW = '.transcript-row:has([data-request-end])';
// The transcript row that holds `card` (a request's group, or any element inside a row).
export const rowOf = (card: Locator): Locator => card.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " transcript-row ")][1]');

// `focus` takes the key (the transcript row that holds the card, `rowOf`, or the Overview card's article); `control` is the card's button that the key
// answers for, read enabled before each press (a key the card took disables it before the press returns, so a taken key
// is never pressed twice); `answered` reads the answer where the scene sees it (the event stream, the bridge double).
export async function answerByKey(page: Page, opts: { focus: Locator; control: Locator; key: string; answered: () => Promise<boolean>; what: string }): Promise<void> {
  const { focus, control, key, answered, what } = opts;
  await expect(control, `${what}: the card shows its control`).toBeEnabled();
  await expect(async () => {
    if (await answered()) return;
    if (await control.isEnabled({ timeout: 500 }).catch(() => false)) {
      await focus.focus({ timeout: 1_000 });
      await page.keyboard.press(key);
    }
    expect(await answered(), `${what}: answered by ${key}`).toBe(true);
  }).toPass({ timeout: 15_000 });
}

// When each request card first drew a keyed button (page time), and, for a prompt (a card with its row of decision
// buttons, `[data-decision-buttons]`), the page's side of what its guard reads (UX wave U1b, Interfaces §F): whether the
// card is in view and its buttons' row wholly visible by area (intersection observers rooted at the viewport, which clip by every
// scrolling ancestor as the guard's own test does), whether a menu, dialog or popover is open (the dispatcher's
// `OPEN_OVERLAY`), whether the card shows its keyed control enabled (live), and the page time each of those last turned
// true (an overlay: closed). A scene waits on that observed state, never on time from the first drawing: the guard
// re-arms on each of those events. Installed once per page, before the cards it watches are drawn.
export async function watchPrompts(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Watch = { inView: boolean; whole: boolean; live: boolean; shownAt: number; wholeAt: number; liveAt: number };
    const w = window as unknown as { __u1aDrawn?: Record<string, number>; __u1bPrompts?: { cards: Record<string, Watch>; overlay: boolean; clearedAt: number } };
    if (w.__u1aDrawn) return;
    const drawn: Record<string, number> = (w.__u1aDrawn = {});
    const prompts: { cards: Record<string, Watch>; overlay: boolean; clearedAt: number } = (w.__u1bPrompts = { cards: {}, overlay: false, clearedAt: 0 });
    const OVERLAY = ['menu', 'dialog', 'alertdialog'].map((role) => `[role="${role}"][data-state="open"]:not([data-hover-card])`).join(', ');
    const watched = new WeakSet<Element>();
    const watch = (card: Element, id: string, buttons: Element) => {
      watched.add(card);
      const state: Watch = (prompts.cards[id] = { inView: false, whole: false, live: false, shownAt: 0, wholeAt: 0, liveAt: 0 });
      new IntersectionObserver((entries) => {
        const now = performance.now();
        const inView = entries.at(-1)!.isIntersecting;
        if (inView && !state.inView) state.shownAt = now;
        state.inView = inView;
      }, { threshold: [0] }).observe(card);
      new IntersectionObserver((entries) => {
        const now = performance.now();
        const entry = entries.at(-1)!;
        const whole = entry.isIntersecting && entry.intersectionRatio >= 0.999;
        if (whole && !state.whole) state.wholeAt = now;
        state.whole = whole;
      }, { threshold: [0, 1] }).observe(buttons);
    };
    const read = () => {
      const now = performance.now();
      for (const card of Array.from(document.querySelectorAll('[data-request-card]'))) {
        const id = card.getAttribute('data-request-card')!;
        if (drawn[id] === undefined && card.querySelector('[aria-keyshortcuts]') !== null) drawn[id] = now;
        const buttons = card.querySelector('[data-decision-buttons]');
        if (buttons !== null && !watched.has(card)) watch(card, id, buttons);
        const state = prompts.cards[id];
        if (state === undefined) continue;
        const live = card.querySelector('[aria-keyshortcuts]:not([disabled])') !== null;
        if (live && !state.live) state.liveAt = now;
        state.live = live;
      }
      const overlay = document.querySelector(OVERLAY) !== null;
      if (prompts.overlay && !overlay) prompts.clearedAt = now;
      prompts.overlay = overlay;
    };
    read();
    new MutationObserver(read).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state', 'disabled'] });
  });
}

// Waits until the prompt `card` (a `[data-request-card]` element with its buttons' row) reads armed by what the page
// shows of the guard's conditions. Close to the guard, not the guard: wholeness here is the row's intersection area, while
// the guard also hit-tests the row's four inner corners (a row covered by another element is not whole to it), and the
// guard's own times start in its watch, which this does not see. Read (§F): in view, live, no overlay open, and for the two chords that allow (the default) its buttons' row wholly visible,
// each of those for at least the grace (400 ms, and a frame's margin) since it last turned true. `deny`: Esc's rule,
// which does not wait on the buttons' row. A premise of every press that must answer, and of every assertion that a
// key answered nothing although the prompt would have taken it.
export async function pastGrace(page: Page, card: Locator, opts: { deny?: boolean } = {}): Promise<void> {
  const id = await card.getAttribute('data-request-card');
  expect(id, 'the request card').not.toBeNull();
  await expect
    .poll(() => page.evaluate(([cardId, deny]) => {
      const prompts = (window as unknown as { __u1bPrompts?: { cards: Record<string, { inView: boolean; whole: boolean; live: boolean; shownAt: number; wholeAt: number; liveAt: number }>; overlay: boolean; clearedAt: number } }).__u1bPrompts;
      const state = prompts?.cards[cardId];
      if (prompts === undefined || state === undefined) return 'not watched (watchPrompts installed before it?)';
      if (!state.inView) return 'out of view';
      if (!state.live) return 'not live';
      if (prompts.overlay) return 'an overlay is open';
      if (!deny && !state.whole) return 'its buttons not wholly visible';
      const since = Math.max(state.shownAt, state.liveAt, prompts.clearedAt, deny ? 0 : state.wholeAt);
      return performance.now() - since >= 450 ? 'armed' : 'within its grace';
    }, [id!, opts.deny === true] as const), { message: `the prompt ${id} armed, as the page shows the guard's conditions` })
    .toBe('armed');
}

// A chord dispatched by the page itself at the frame `frame` (a selector: since U1b, the transcript row that holds the
// prompt, e.g. `END_ROW` under a pane), `after` ms after that frame first holds a keyed button: the one way a scene can be sure a key lands inside a prompt's first 400 ms on a loaded machine. The frame is
// focused first, as a real press would find it: the keymap's dispatcher gives a key to a binding only when both the
// event's target and the focused element are inside it, so a key sent at an unfocused frame would answer nothing for a
// reason other than the 400 ms. Armed before the prompt is drawn; `earlyPress` then answers how long after the drawing
// the key went and whether the frame held the focus when it did (the scene asserts both, so a slow page or a lost focus
// fails the scene rather than passing it).
export async function armEarlyPress(page: Page, opts: { frame: string; key: string; meta?: boolean; shift?: boolean; after: number }): Promise<void> {
  await page.evaluate(({ frame, key, meta, shift, after }) => {
    (window as unknown as { __u1aEarly?: Promise<EarlyPress> }).__u1aEarly = new Promise<EarlyPress>((resolve) => {
      const look = (): boolean => {
        const target = document.querySelector(frame);
        if (target === null || target.querySelector('[aria-keyshortcuts]') === null) return false;
        const at = performance.now();
        setTimeout(() => {
          (target as HTMLElement).focus();
          const focused = document.activeElement !== null && target.contains(document.activeElement);
          if (focused) target.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, metaKey: meta, shiftKey: shift, bubbles: true, cancelable: true }));
          resolve({ after: performance.now() - at, focused });
        }, after);
        return true;
      };
      if (look()) return;
      const observer = new MutationObserver(() => {
        if (look()) observer.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }, { frame: opts.frame, key: opts.key, meta: opts.meta ?? false, shift: opts.shift ?? false, after: opts.after });
}

type EarlyPress = { after: number; focused: boolean };
export const earlyPress = (page: Page): Promise<EarlyPress> => page.evaluate(() => (window as unknown as { __u1aEarly: Promise<EarlyPress> }).__u1aEarly);

// The session scope on a permission prompt (§D): its own button, the third, or, beside a project rule ("Always allow in
// <project>"), the one entry of the menu on Allow once; Allow once where the prompt offers no lasting scope (an ask rule).
export async function allowForTheSession(frame: Locator): Promise<void> {
  const button = frame.getByRole('button', { name: 'Allow for this session', exact: true });
  if ((await button.count()) > 0) return button.click();
  const more = frame.getByRole('button', { name: 'More allow options' });
  if ((await more.count()) === 0) return frame.getByRole('button', { name: 'Allow once', exact: true }).click();
  await more.click();
  await frame.page().getByRole('menuitem', { name: 'Allow for this session' }).click();
}
