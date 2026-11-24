// The toolbar's notice (the word cut, G413; docs/doperpowers/specs/2026-11-16-word-cut-design.md, M5 task 3): a refusal
// said shortly, the model's own reason its tooltip and description on a notice that then takes Tab, held while pointed
// at or focused.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accessibleDescription, accessibleText } from '../../../renderer/src/test-support/accessible-text';
import { fakeTimeouts, realTimeouts } from '../../../renderer/src/test-support/fake-timeouts';
import { ToolbarNotice, useToolbarNotice } from './notice';

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
});
