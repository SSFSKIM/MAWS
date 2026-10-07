// E4d (Task 3.1): the chrome's Comment toggle (E4d execution document, Design §2): pressed while main has the tab armed,
// disabled with its reason as its label while the agent holds the page or there is no page, a click asking main to arm
// or disarm (main's answer is what the toggle then shows), and a plain Escape in the chrome leaving the mode.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BrowserTab } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';
import { browserTab, T1, T2 } from '../../../test-support/browser';
import { installFakeMain, ok } from '../../../test-support/code';
import { COMMENT_COPY } from './copy';
import { CommentToggle } from './CommentToggle';
import { resetCommentMode, setCommentArmed, useCommentMode } from './store';

const A = 'app-a' as AppSessionId;

let main: ReturnType<typeof installFakeMain>;
beforeEach(() => {
  resetCommentMode();
  main = installFakeMain((name, input) => (name === 'browser.comment.set' ? ok({ on: input.on, reason: 'ok' }) : ok()));
});
afterEach(() => {
  cleanup();
  delete (window as { maws?: unknown }).maws;
});

// The toggle as the chrome mounts it: inside the chrome's root, beside another control of the chrome.
function show(tab: BrowserTab) {
  const view = render(
    <div>
      <div data-browser-chrome="">
        <input aria-label="Address" />
        <CommentToggle tab={tab} appSessionId={A} surface="panel" />
      </div>
      <textarea aria-label="Elsewhere" />
    </div>,
  );
  const rerender = (next: BrowserTab) =>
    view.rerender(
      <div>
        <div data-browser-chrome="">
          <input aria-label="Address" />
          <CommentToggle tab={next} appSessionId={A} surface="panel" />
        </div>
        <textarea aria-label="Elsewhere" />
      </div>,
    );
  return { rerender };
}

const toggle = () => screen.getByRole<HTMLButtonElement>('button', { name: /Comment|Load a page/ });
const sets = () => main.callsOf('browser.comment.set');

describe('the Comment toggle', () => {
  it('reads "Comment", unpressed, and pressed while main has the tab armed', () => {
    show(browserTab(T1, A));
    expect(toggle().getAttribute('aria-label')).toBe(COMMENT_COPY.toggle);
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
    expect(toggle().disabled).toBe(false);
    act(() => setCommentArmed(T1, true));
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    act(() => setCommentArmed(T1, false));
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
  });

  it('is disabled while the agent holds the page, its reason as its label', () => {
    show(browserTab(T1, A, { control: 'agent' }));
    const button = screen.getByRole<HTMLButtonElement>('button', { name: COMMENT_COPY.toggleAgent });
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('title')).toBe(COMMENT_COPY.toggleAgent);
  });

  it.each([
    ['suspended', { suspended: true }],
    ['under a load error', { loadError: { url: 'https://x.test/', host: 'x.test', kind: 'dns', code: -105, description: 'ERR_NAME_NOT_RESOLVED' } }],
    ['crashed', { crashed: { reason: 'oom' } }],
    ['an empty tab', { url: '' }],
    ['a view that could not be created', { failed: { message: 'no' } }],
  ] satisfies [string, Partial<BrowserTab>][])('is disabled with nothing to pick on: %s', (_, over) => {
    show(browserTab(T1, A, over));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: COMMENT_COPY.toggleNoPage }).disabled).toBe(true);
  });

  it('a click asks main to arm the tab, and the toggle shows main’s answer; a second click disarms it', async () => {
    show(browserTab(T1, A));
    await userEvent.click(toggle());
    expect(sets()).toEqual([{ tabId: T1, on: true }]);
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(toggle());
    expect(sets()).toEqual([{ tabId: T1, on: true }, { tabId: T1, on: false }]);
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
  });

  it('a refusal from main leaves it unpressed', async () => {
    main = installFakeMain(() => ok({ on: false, reason: 'notPlaced' }));
    show(browserTab(T1, A));
    await userEvent.click(toggle());
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
    expect(useCommentMode.getState().armed.size).toBe(0);
  });

  it('while armed, a plain Escape in the chrome leaves the mode, the address field’s own Escape included', async () => {
    show(browserTab(T1, A));
    act(() => setCommentArmed(T1, true));
    toggle().focus();
    fireEvent.keyDown(toggle(), { key: 'Escape' });
    expect(sets()).toEqual([{ tabId: T1, on: false }]);
    await act(async () => {}); // main's answer
    act(() => setCommentArmed(T1, true));
    const address = screen.getByRole('textbox', { name: 'Address' });
    address.addEventListener('keydown', (event) => event.preventDefault()); // as the field's own Escape does
    fireEvent.keyDown(address, { key: 'Escape' });
    expect(sets()).toHaveLength(2);
  });

  it('an Escape with a modifier, outside the chrome, or while not armed leaves the mode alone', () => {
    show(browserTab(T1, A));
    fireEvent.keyDown(toggle(), { key: 'Escape' });
    act(() => setCommentArmed(T1, true));
    fireEvent.keyDown(toggle(), { key: 'Escape', shiftKey: true });
    fireEvent.keyDown(toggle(), { key: 'Escape', metaKey: true });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Elsewhere' }), { key: 'Escape' });
    fireEvent.keyDown(toggle(), { key: 'Enter' });
    expect(sets()).toEqual([]);
  });

  it('follows the tab the chrome shows', async () => {
    const { rerender } = show(browserTab(T1, A));
    act(() => setCommentArmed(T1, true));
    rerender(browserTab(T2, A));
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(toggle());
    expect(sets()).toEqual([{ tabId: T2, on: true }]);
    fireEvent.keyDown(toggle(), { key: 'Escape' });
    expect(sets()).toEqual([{ tabId: T2, on: true }, { tabId: T2, on: false }]);
  });
});
