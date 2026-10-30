// The toolbar's Mode chip names the session's mode, MAWS's default (Auto) while nothing is known of a session it runs,
// and no mode at all where nothing reports one (a terminal session driven through its bridge: the O9 sitting, where a
// session the owner had switched to Manual read Auto).
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MODE_OPTIONS, type ModeBinding } from '../../statusline';
import { REL } from '../../test-support/relative-time';
import { ModeChip } from './ModeChip';

afterEach(cleanup);

const binding = (over: Partial<ModeBinding> = {}): ModeBinding => ({
  value: null, options: MODE_OPTIONS.map((o) => o.mode), disabled: null, refusal: null, autoUnavailable: null, set: async () => ({ ok: true }), ...over,
});
const chip = () => screen.getByRole('button', { name: /^Permission mode/ });

describe('the Mode chip', () => {
  it('names the mode, and Auto for a session of MAWS’s own whose mode nothing has reported yet', () => {
    render(<ModeChip binding={binding({ value: 'default' })} />);
    expect(chip().textContent).toContain('Manual');
    cleanup();
    render(<ModeChip binding={binding()} />);
    expect(chip().textContent).toContain('Auto');
  });

  it('names no mode where none is reported, its reason on the chip', () => {
    render(<ModeChip binding={binding({ unreported: true, disabled: 'Not reported by the terminal session: its mode is changed in the terminal' })} />);
    expect(chip().getAttribute('aria-label')).toBe('Permission mode not reported');
    expect(chip().textContent).not.toMatch(/Auto|Manual|Plan|Accept|Bypass|Don/);
    expect(chip().textContent).toContain('Mode');
    expect(chip().getAttribute('title')).toBe('Not reported by the terminal session: its mode is changed in the terminal');
  });

  // sminos 1.27.14: a terminal session's mode as it reported it, how long ago on the chip's title
  it('names a reported mode, with how long ago it was reported and why it is changed elsewhere', () => {
    const reportedAt = Date.now() - 2 * 60_000 - 5_000;
    render(<ModeChip binding={binding({ value: 'default', reportedAt, disabled: "A terminal session's mode is changed in the terminal" })} />);
    expect(chip().textContent).toContain('Manual');
    expect(chip().getAttribute('aria-label')).toBe('Permission mode Manual');
    expect(chip().getAttribute('title')).toBe(`Reported ${REL.ago(2, 'minute')} · A terminal session's mode is changed in the terminal`);
  });
});
