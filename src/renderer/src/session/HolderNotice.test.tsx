// The line that stands where the message box would for a session a terminal holds, under the word cut (C128): who holds
// it and that MAWS only reads it, "Live in Terminal · read-only"; the pid waits on that line, which takes focus for it,
// and is its description at all times. A session the bridge cannot drive keeps the bridge's reason under it (C129).
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { at } from '../../../../test/support/machine';
import { accessibleText } from '../test-support/accessible-text';
import { HolderNotice } from './HolderNotice';

const A = at('app-held' as AppSessionId);
const tooltip = () => screen.queryByRole('tooltip')?.textContent ?? null;
afterEach(cleanup);

describe('the held session’s line', () => {
  it('reads who holds it and read-only, the pid on focusing the line', () => {
    render(<HolderNotice appSessionId={A} holder={{ kind: 'terminal', pid: 4312 }} />);
    const note = screen.getByRole('note');
    expect(accessibleText(note)).toBe('Live in Terminal · read-onlyTake over hereFork a copy');
    const line = screen.getByText('Live in Terminal · read-only');
    expect(document.getElementById(line.getAttribute('aria-describedby')!)!.textContent).toBe('pid 4312');
    act(() => line.focus());
    expect(document.activeElement).toBe(line);
    expect(tooltip()).toBe('pid 4312');
  });

  it('a background job reads the same way, and a holder with no pid has nothing to wait', () => {
    render(<HolderNotice appSessionId={A} holder={{ kind: 'background_job', pid: null, jobId: null }} reason="the session’s bridge is starting" />);
    const line = screen.getByText('Live as background job · read-only');
    expect(line.hasAttribute('tabindex')).toBe(false);
    expect(screen.getByText('The session’s bridge is starting')).toBeTruthy();
  });
});
