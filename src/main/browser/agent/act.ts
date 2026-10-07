// browser_act's two page steps around the pause point (E4c execution document, Design §6 steps 2 and 4; A-33 item 2;
// Decision Log 3, 7).
//
// The readiness wait dispatches nothing into the page: the element visible (attached, for a scroll), then enabled (and
// editable, for fill and select) polled every 100 ms, within BROWSER_ACTION_TIMEOUT_MS. Never Playwright's `trial`, which
// still presses and releases the mouse and only swallows the DOM events. A press needs no editable check: a key to a
// button or a link is a press, and `isEditable` throws on them.
//
// A covered page (a sheet, the palette over a placed view) is hidden, and its requestAnimationFrame is paused even under
// focus emulation, so nothing could make the action proceed under it: while the tab is covered the wait is suspended
// (a cover that comes stops the step, which restarts with what is left of its budget once the cover lifts), the time
// under it is not counted, and the wait is reported (`cover`, then null) so the host's deadline pauses and the row says
// a sheet covers the page. A screenshot of a target waits the same way (`withoutCover`, Task 2.5).
//
// The dispatch is the real Playwright action with a short timeout of its own (its actionability checks pass at once
// now); every call takes the request's signal, and once a command has left nothing cancels it (Decision Log 3).
import type { Locator, Page } from 'playwright-core';
import { BROWSER_ACTION_TIMEOUT_MS, type BrowserActAction, type BrowserWaitReason } from '@shared/maws/browser';
import type { TabEntry, TabStore } from '../tabs';

export const READY_POLL_MS = 100;
export const DISPATCH_TIMEOUT_MS = 5_000;

export interface CoverDeps {
  store: Pick<TabStore, 'onUpdated'>;
  signal: AbortSignal;
  report(reason: Extract<BrowserWaitReason, 'cover'> | null): void;
  now(): number;
}

class StepTimeout extends Error {
  override readonly name = 'TimeoutError';
}

const COVERED = Symbol('covered');

// Runs `step` within `budgetMs` of uncovered time: suspended while the tab is covered, the step stopped (through the
// signal it is given) when a cover comes and run again with the budget that remains once it lifts. Answers the step's
// value and how long covers held it; a budget spent rejects with a TimeoutError, the request's abort with its reason.
export async function withoutCover<T>(entry: TabEntry, deps: CoverDeps, budgetMs: number, step: (signal: AbortSignal, budgetMs: number) => Promise<T>): Promise<{ value: T; coveredMs: number }> {
  const { signal, now } = deps;
  let budget = budgetMs;
  let coveredMs = 0;
  for (;;) {
    signal.throwIfAborted();
    if (entry.tab.covered) {
      coveredMs += await uncovered(entry, deps);
      continue;
    }
    if (budget <= 0) throw new StepTimeout(`not ready within ${budgetMs} ms`);
    const attempt = new AbortController();
    const stopRelay = relay(signal, attempt);
    const stopWatch = deps.store.onUpdated((updated) => {
      if (updated === entry && entry.tab.covered) attempt.abort(COVERED);
    });
    const started = now();
    try {
      return { value: await step(attempt.signal, budget), coveredMs };
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (attempt.signal.reason !== COVERED) throw error;
      budget -= now() - started;
    } finally {
      stopWatch();
      stopRelay();
    }
  }
}

// Waits for the cover to lift, reporting the wait; resolves with how long it held.
function uncovered(entry: TabEntry, { store, signal, report, now }: CoverDeps): Promise<number> {
  const started = now();
  report('cover');
  return new Promise<number>((resolve, reject) => {
    const finish = (settle: () => void) => {
      stop();
      signal.removeEventListener('abort', onAbort);
      report(null);
      settle();
    };
    const onAbort = () => finish(() => reject(signal.reason));
    const stop = store.onUpdated((updated) => {
      if (updated === entry && !entry.tab.covered) finish(() => resolve(now() - started));
    });
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

// The input-free readiness wait (Design §6 step 2), within the budget.
export async function untilReady(locator: Locator, action: BrowserActAction, signal: AbortSignal, budgetMs: number, now: () => number): Promise<void> {
  const deadline = now() + budgetMs;
  const left = () => Math.max(1, deadline - now()); // never 0: Playwright reads a 0 timeout as none
  await locator.waitFor({ state: action === 'scroll' ? 'attached' : 'visible', timeout: budgetMs, signal });
  if (action === 'scroll') return;
  const editable = action === 'fill' || action === 'select';
  for (;;) {
    if ((await locator.isEnabled({ timeout: left(), signal })) && (!editable || (await locator.isEditable({ timeout: left(), signal })))) return;
    if (now() + READY_POLL_MS >= deadline) throw new StepTimeout(`not enabled within ${budgetMs} ms`);
    await sleep(READY_POLL_MS, signal);
  }
}

// The readiness wait under the cover rule, within BROWSER_ACTION_TIMEOUT_MS of uncovered time.
export async function waitUntilReady(entry: TabEntry, locator: Locator, action: BrowserActAction, deps: CoverDeps): Promise<{ coveredMs: number }> {
  const { coveredMs } = await withoutCover(entry, deps, BROWSER_ACTION_TIMEOUT_MS, (signal, budget) => untilReady(locator, action, signal, budget, deps.now));
  return { coveredMs };
}

// Design §6 step 4: the action itself.
export async function dispatch(page: Page, locator: Locator, action: BrowserActAction, value: string | undefined, signal: AbortSignal): Promise<void> {
  const options = { timeout: DISPATCH_TIMEOUT_MS, signal };
  switch (action) {
    case 'click':
      return locator.click(options);
    case 'fill':
      return locator.fill(value!, options);
    case 'select':
      return void (await locator.selectOption(value!, options)); // a string matches an option's value or label
    case 'check':
      return locator.setChecked(value !== 'false', options);
    case 'press':
      return locator.press(value!, options);
    case 'hover':
      return locator.hover(options);
    case 'scroll':
      await locator.scrollIntoViewIfNeeded(options);
      if (value === undefined) return;
      await locator.hover(options);
      return page.mouse.wheel(0, Number(value));
  }
}

function relay(from: AbortSignal, to: AbortController): () => void {
  const onAbort = () => to.abort(from.reason);
  if (from.aborted) onAbort();
  else from.addEventListener('abort', onAbort, { once: true });
  return () => from.removeEventListener('abort', onAbort);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
