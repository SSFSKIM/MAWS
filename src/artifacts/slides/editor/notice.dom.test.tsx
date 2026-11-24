// The toolbar's notice (the word cut, G413; docs/doperpowers/specs/2026-11-16-word-cut-design.md, M5 task 3): a refusal
// said shortly, the model's own reason its tooltip and description on a notice that then takes Tab, held while pointed
// at or focused.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accessibleDescription, accessibleText } from '../../../renderer/src/test-support/accessible-text';
import { fakeTimeouts, realTimeouts } from '../../../renderer/src/test-support/fake-timeouts';
import { ToolbarNotice, useToolbarNotice, type ToolbarNoticeState } from './notice';

afterEach(() => {
  cleanup();
  realTimeouts();
});

describe('the toolbar’s notice (G413)', () => {
  function Harness({ onApi }: { onApi(show: (text: string, why?: string | null) => void): void }) {
    const notice = useToolbarNotice();
    onApi(notice.show);
    return (
      <div role="toolbar" aria-label="Deck">
        <ToolbarNotice notice={notice} />
      </div>
    );
  }

  it('says the refusal shortly; the model’s reason is its tooltip and description on a notice that takes Tab', () => {
    let show!: (text: string, why?: string | null) => void;
    render(<Harness onApi={(s) => (show = s)} />);
    act(() => show('These can’t be grouped', 'only pinned elements group; detach flow elements first'));
    const notice = screen.getByRole('status');
    expect(accessibleText(notice)).toBe('These can’t be grouped');
    expect(accessibleDescription(notice)).toBe('only pinned elements group; detach flow elements first');
    expect(notice.tabIndex).toBe(0);
    act(() => show('Uploading…'));
    expect(screen.getByRole('status').hasAttribute('tabindex')).toBe(false);
    expect(accessibleDescription(screen.getByRole('status'))).toBe('');
  });

  it('goes after six seconds, but not while it is pointed at or focused', () => {
    fakeTimeouts();
    let show!: (text: string, why?: string | null) => void;
    render(<Harness onApi={(s) => (show = s)} />);
    act(() => show('Can’t paste this here', 'nothing to paste'));
    const notice = screen.getByRole('status');
    act(() => notice.focus());
    act(() => vi.advanceTimersByTime(10_000));
    expect(notice.textContent).toBe('Can’t paste this here');
    act(() => notice.blur());
    act(() => vi.advanceTimersByTime(5_900));
    expect(notice.textContent).toBe('Can’t paste this here');
    act(() => vi.advanceTimersByTime(200));
    expect(notice.textContent).toBe('');
  });

  // fix round (task 3's review): a status lasts as long as its operation; expiry lives with the notice, not its view
  function Switchable({ onApi, shown }: { onApi(notice: ToolbarNoticeState): void; shown: boolean }) {
    const notice = useToolbarNotice();
    onApi(notice);
    return <div>{shown && <ToolbarNotice notice={notice} />}</div>;
  }
  const text = () => document.querySelector('[data-deck-notice]')?.textContent;

  it('keeps a status while its operation runs, and its end clears that status only', () => {
    fakeTimeouts();
    let api!: ToolbarNoticeState;
    render(<Switchable shown onApi={(n) => (api = n)} />);
    let end!: () => void;
    act(() => void (end = api.begin('Uploading…')));
    act(() => vi.advanceTimersByTime(20_000));
    expect(text()).toBe('Uploading…');
    act(() => end());
    expect(text()).toBe('');
    // a refusal said after the status began stays when the status ends, and goes on its own time
    act(() => void (end = api.begin('Uploading…')));
    act(() => api.show('Can’t insert this here', 'the slide would not load'));
    act(() => end());
    expect(text()).toBe('Can’t insert this here');
    act(() => vi.advanceTimersByTime(6_100));
    expect(text()).toBe('');
  });

  it('a refusal goes on its time while no view shows it (a version previewed), and is not replayed after', () => {
    fakeTimeouts();
    let api!: ToolbarNoticeState;
    const { rerender } = render(<Switchable shown onApi={(n) => (api = n)} />);
    act(() => api.show('Can’t paste this here', 'nothing to paste'));
    act(() => screen.getByRole('status').focus()); // held while focused, then the view goes with the focus in it
    rerender(<Switchable shown={false} onApi={(n) => (api = n)} />);
    act(() => vi.advanceTimersByTime(6_100));
    rerender(<Switchable shown onApi={(n) => (api = n)} />);
    expect(text()).toBe('');
  });
});
