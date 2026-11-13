// The keys that answer a permission prompt (UX wave U1a, Interfaces §D): ⌘Enter allows once, ⇧⌘Enter gives the lasting
// scope the prompt's third button names, Esc denies. Each answers nothing for the prompt's first 400 ms, so a scene
// presses one the way requests.spec.ts's `answerDialog` presses a dialog's key: at the card it found, again only while
// that card still shows its control enabled, until the answer is out. No scene sleeps for the 400 ms, and none presses
// a key at a card it has not found.
import { expect, type Locator, type Page } from '@playwright/test';

export const ALLOW_ONCE_KEY = 'Meta+Enter';
export const ALLOW_LASTING_KEY = 'Meta+Shift+Enter';
export const DENY_KEY = 'Escape';

// `focus` takes the key (the docked frame, or the Overview card's article); `control` is the card's button that the key
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

// When each request card first drew a keyed button (page time), so a scene can say a key answered nothing after the
// prompt's first 400 ms, where it would have answered had it been bound: a key pressed inside them answers nothing
// whether or not it is bound. Installed once per page, before the cards it watches are drawn.
export async function watchPrompts(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __u1aDrawn?: Record<string, number> };
    if (w.__u1aDrawn) return;
    const drawn: Record<string, number> = (w.__u1aDrawn = {});
    const read = () => {
      for (const card of document.querySelectorAll('[data-request-card]')) {
        const id = card.getAttribute('data-request-card')!;
        if (drawn[id] === undefined && card.querySelector('[aria-keyshortcuts]') !== null) drawn[id] = performance.now();
      }
    };
    read();
    new MutationObserver(read).observe(document.body, { childList: true, subtree: true });
  });
}

// Waits until the prompt `card` (a `[data-request-card]` element) has been drawn for its 400 ms.
export async function pastGrace(page: Page, card: Locator): Promise<void> {
  const id = await card.getAttribute('data-request-card');
  expect(id, 'the request card').not.toBeNull();
  await expect
    .poll(() => page.evaluate((cardId) => {
      const at = (window as unknown as { __u1aDrawn?: Record<string, number> }).__u1aDrawn?.[cardId];
      return at === undefined ? -1 : performance.now() - at;
    }, id!), { message: `the prompt ${id} drawn for 400 ms (watchPrompts installed before it)` })
    .toBeGreaterThanOrEqual(400);
}

// A chord dispatched by the page itself at the frame `frame` (a selector), `after` ms after that frame first holds a keyed
// button: the one way a scene can be sure a key lands inside a prompt's first 400 ms on a loaded machine. Armed before
// the prompt is drawn; `earlyPress` then answers how long after the drawing the key went (the scene asserts it was
// inside the 400 ms, so a slow page fails the scene rather than passing it).
export async function armEarlyPress(page: Page, opts: { frame: string; key: string; meta?: boolean; shift?: boolean; after: number }): Promise<void> {
  await page.evaluate(({ frame, key, meta, shift, after }) => {
    (window as unknown as { __u1aEarly?: Promise<number> }).__u1aEarly = new Promise<number>((resolve) => {
      const look = (): boolean => {
        const target = document.querySelector(frame);
        if (target === null || target.querySelector('[aria-keyshortcuts]') === null) return false;
        const at = performance.now();
        setTimeout(() => {
          target.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, metaKey: meta, shiftKey: shift, bubbles: true, cancelable: true }));
          resolve(performance.now() - at);
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

export const earlyPress = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { __u1aEarly: Promise<number> }).__u1aEarly);

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
