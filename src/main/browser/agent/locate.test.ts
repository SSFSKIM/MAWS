import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BROWSER_LOCATE_MS, BROWSER_TOOL_ERRORS } from '@shared/maws/browser';
import { BrowserToolError } from './errors';
import { locate, RefBook } from './locate';
import { FakePage } from './page.fake';

// How a target resolves (E4c Design §6 `locate.ts`; Decision Log 16, 30, 37): a ref through Playwright's `aria-ref`
// engine with its two stale reasons, a locator css-first, narrowed by role and name only when css matches several, with
// the role-and-name fallback only when css matches none.

const SNAPSHOT = ['- generic [ref=e1]:', '  - button "Submit" [ref=e5]', '  - textbox "Name" [ref=e6]', '  - iframe [ref=e7]:', '    - button "Frame button" [ref=f1e2]'].join('\n');

function harness() {
  const page = new FakePage();
  const contents = new EventEmitter();
  const refs = new RefBook(contents);
  const controller = new AbortController();
  const run = (target: Parameters<typeof locate>[1]) => locate(page.asPage(), target, { tool: 'browser_act', signal: controller.signal, refs });
  const refusal = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: unknown) => (error instanceof BrowserToolError ? error.text : error),
    );
  return { page, contents, refs, controller, run, refusal };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('a ref', () => {
  it('resolves through aria-ref at once, with the role and name its snapshot line gave', async () => {
    const h = harness();
    h.refs.record(SNAPSHOT);
    h.page.counts.set('aria-ref=e5', 1);
    const located = await h.run('e5');
    expect((located.locator as unknown as { selector: string }).selector).toBe('aria-ref=e5');
    expect(located.resolved).toEqual({ ref: 'e5', role: 'button', name: 'Submit' });
    expect(h.page.lines()).toEqual(['count aria-ref=e5']); // no wait, and no aria snapshot (it would replace the refs)
  });

  it('resolves a ref no snapshot of ours named, without a role or name', async () => {
    const h = harness();
    h.page.counts.set('aria-ref=e9', 1);
    expect((await h.run('e9')).resolved).toEqual({ ref: 'e9' });
  });

  it('is stale from a previous document when its frame is gone, or when the page navigated since the snapshot that named it', async () => {
    const h = harness();
    h.refs.record(SNAPSHOT);
    h.page.counts.set('aria-ref=f1e2', new Error('locator.count: Invalid frame in aria-ref selector "aria-ref=f1e2"'));
    expect(await h.refusal(h.run('f1e2'))).toBe(BROWSER_TOOL_ERRORS.staleRef('browser_act', 'f1e2', 'previous-document'));
    h.contents.emit('did-navigate'); // a new main-frame document
    expect(await h.refusal(h.run('e5'))).toBe(BROWSER_TOOL_ERRORS.staleRef('browser_act', 'e5', 'previous-document'));
  });

  it('is stale or missing when it does not resolve in the current document', async () => {
    const h = harness();
    h.refs.record(SNAPSHOT);
    expect(await h.refusal(h.run('e5'))).toBe(BROWSER_TOOL_ERRORS.staleRef('browser_act', 'e5', 'missing'));
    expect(await h.refusal(h.run('e40'))).toBe(BROWSER_TOOL_ERRORS.staleRef('browser_act', 'e40', 'missing'));
    h.contents.emit('did-navigate');
    h.refs.record('- button "Again" [ref=e12]'); // a snapshot of the new document names the ref again
    expect(await h.refusal(h.run('e12'))).toBe(BROWSER_TOOL_ERRORS.staleRef('browser_act', 'e12', 'missing'));
  });

  it('lets any other Playwright error through', async () => {
    const h = harness();
    const broken = new Error('locator.count: Target page, context or browser has been closed');
    h.page.counts.set('aria-ref=e5', broken);
    expect(await h.refusal(h.run('e5'))).toBe(broken);
  });
});

describe('a locator {css, role?, name?} (css-first, Decision Log 30)', () => {
  it('takes css as Playwright css, waits up to BROWSER_LOCATE_MS for a match, and uses the one it finds', async () => {
    const h = harness();
    h.page.counts.set('css=a >> text=b', 1); // the prefix keeps Playwright from reading `>>` or `text=` as its own
    const located = await h.run({ css: 'a >> text=b' });
    expect(located.resolved).toEqual({ css: 'a >> text=b', matches: 1 });
    expect(h.page.calls[0]).toMatchObject({ method: 'waitFor attached', selector: 'css=a >> text=b >> first', args: [{ state: 'attached', timeout: BROWSER_LOCATE_MS }] });
    expect(h.page.calls[0]!.args[0]).toHaveProperty('signal', h.controller.signal);
    expect(h.page.lines()).toEqual(['waitFor attached css=a >> text=b >> first', 'count css=a >> text=b']);
  });

  it('checks one match against a given role and name without an aria snapshot, hidden elements included', async () => {
    const h = harness();
    h.page.counts.set('css=#save', 1);
    h.page.counts.set('css=#save & role=button name="Save" exact hidden', 1); // an anchor hidden at locate time still agrees
    const located = await h.run({ css: '#save', role: 'button', name: 'Save' });
    expect(located.resolved).toEqual({ css: '#save', role: 'button', name: 'Save', matches: 1 });
    expect((located.locator as unknown as { selector: string }).selector).toBe('css=#save');
    expect(h.page.lines()).toEqual(['waitFor attached css=#save >> first', 'count css=#save', 'count css=#save & role=button name="Save" exact hidden']);
  });

  it('answers targetNotFound naming what css matched when its role or name disagrees, and takes no fallback', async () => {
    const h = harness();
    h.page.counts.set('css=#save', 1);
    h.page.counts.set('role=button name="Save" exact', 1); // the fallback would find a Save button elsewhere
    h.page.json.set('css=#save', [{ role: 'button', name: 'Cancel' }]);
    const answer = await h.refusal(h.run({ css: '#save', role: 'button', name: 'Save' }));
    expect(answer).toBe('browser_act: {css: "#save"} matches one element, button "Cancel", not button "Save"');
    expect(answer).toBe(BROWSER_TOOL_ERRORS.targetNotFound('browser_act', { css: '#save', role: 'button', name: 'Save' }, { role: 'button', name: 'Cancel' }));
    expect(h.page.lines()).not.toContain('count role=button name="Save" exact');
  });

  it("restores the model's refs with a whole-page ai snapshot right after reading an element's aria node", async () => {
    const h = harness();
    h.page.counts.set('css=#save', 1);
    h.page.json.set('css=#save', [{ role: 'button', name: 'Cancel' }]);
    h.page.snapshots.set('page', SNAPSHOT); // the same document: the same refs come back
    await h.refusal(h.run({ css: '#save', role: 'button', name: 'Save' }));
    const lines = h.page.lines();
    expect(lines.slice(lines.indexOf('ariaSnapshotJSON css=#save'))).toEqual(['ariaSnapshotJSON css=#save', 'ariaSnapshot page']);
    expect(h.page.calls.at(-1)!.args).toEqual([{ mode: 'ai', signal: h.controller.signal }]);
    expect(h.refs.elementOf('e5')).toEqual({ role: 'button', name: 'Submit' }); // recorded as any snapshot is
    h.page.calls.length = 0;
    h.page.json.set('css=#n', [{ role: 'textbox', name: 'Name' }]);
    h.page.counts.set('css=#n', 1);
    await h.run({ css: '#n', name: 'Name' }); // the name-only check reads the node too
    expect(h.page.lines().slice(-2)).toEqual(['ariaSnapshotJSON css=#n', 'ariaSnapshot page']);
  });

  it('names a generic element, which Playwright leaves out of its aria tree, as generic', async () => {
    const h = harness();
    h.page.counts.set('css=#box', 1);
    h.page.json.set('css=#box', [{ role: 'text', text: 'plain' }]);
    expect(await h.refusal(h.run({ css: '#box', role: 'button' }))).toBe('browser_act: {css: "#box"} matches one element, generic, not button');
  });

  it('checks a name given without a role against the element Playwright names', async () => {
    const h = harness();
    h.page.counts.set('css=#n', 1);
    h.page.json.set('css=#n', [{ role: 'textbox', name: 'Name' }]);
    expect((await h.run({ css: '#n', name: 'Name' })).resolved).toEqual({ css: '#n', name: 'Name', matches: 1 });
    expect(await h.refusal(h.run({ css: '#n', name: 'Email' }))).toBe('browser_act: {css: "#n"} matches one element, textbox "Name", not "Email"');
  });

  it('narrows several matches by role and name and uses the first, saying how many matched', async () => {
    const h = harness();
    h.page.counts.set('css=button', 4);
    h.page.counts.set('css=button & role=button name="Go" exact', 2);
    const located = await h.run({ css: 'button', role: 'button', name: 'Go' });
    expect(located.resolved).toEqual({ css: 'button', role: 'button', name: 'Go', matches: 2 });
    expect((located.locator as unknown as { selector: string }).selector).toBe('css=button & role=button name="Go" exact >> first');
  });

  it('narrows by role alone when no name is given', async () => {
    const h = harness();
    h.page.counts.set('css=.x', 3);
    h.page.counts.set('css=.x & role=link', 1);
    expect((await h.run({ css: '.x', role: 'link' })).resolved).toEqual({ css: '.x', role: 'link', matches: 1 });
  });

  it('uses the first of several when nothing narrows them; a name without a role narrows nothing and is not echoed', async () => {
    const h = harness();
    h.page.counts.set('css=li', 5);
    const located = await h.run({ css: 'li' });
    expect(located.resolved).toEqual({ css: 'li', matches: 5 });
    expect((located.locator as unknown as { selector: string }).selector).toBe('css=li >> first');
    expect((await h.run({ css: 'li', name: 'Third' })).resolved).toEqual({ css: 'li', matches: 5 });
    expect(h.page.lines()).not.toContain('ariaSnapshotJSON css=li >> first');
  });

  it('falls back to role and name when css matches none and they name exactly one element (the element moved)', async () => {
    vi.useFakeTimers();
    const h = harness();
    h.page.counts.set('role=button name="Save" exact', 1);
    const pending = h.run({ css: '#gone', role: 'button', name: 'Save' });
    await vi.advanceTimersByTimeAsync(BROWSER_LOCATE_MS + 20);
    const located = await pending;
    expect(located.resolved).toEqual({ css: '#gone', role: 'button', name: 'Save', matches: 1 });
    expect((located.locator as unknown as { selector: string }).selector).toBe('role=button name="Save" exact');
  });

  it('falls back too when several css matches narrow to none', async () => {
    const h = harness();
    h.page.counts.set('css=button', 2);
    h.page.counts.set('role=button name="Save" exact', 1);
    expect((await h.run({ css: 'button', role: 'button', name: 'Save' })).resolved).toEqual({ css: 'button', role: 'button', name: 'Save', matches: 1 });
  });

  it('answers targetNotFound for no match, and for a fallback that is not exactly one element', async () => {
    vi.useFakeTimers();
    const h = harness();
    const none = h.refusal(h.run({ css: '#gone' }));
    await vi.advanceTimersByTimeAsync(BROWSER_LOCATE_MS + 20);
    expect(await none).toBe('browser_act: no element matches {css: "#gone"} (0 matches)');
    h.page.counts.set('role=button name="Save" exact', 2);
    const two = h.refusal(h.run({ css: '#gone', role: 'button', name: 'Save' }));
    await vi.advanceTimersByTimeAsync(BROWSER_LOCATE_MS + 20);
    expect(await two).toBe(BROWSER_TOOL_ERRORS.targetNotFound('browser_act', { css: '#gone', role: 'button', name: 'Save' }));
  });

  it('stops waiting when the request is aborted', async () => {
    const h = harness();
    const pending = h.refusal(h.run({ css: '#gone' }));
    h.controller.abort(new Error('cancelled'));
    expect(await pending).toEqual(new Error('cancelled'));
  });
});
