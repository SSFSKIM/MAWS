import { describe, expect, it, vi } from 'vitest';
import { showAppWindow } from './window-show';

function fakeWindow() {
  return { show: vi.fn(), showInactive: vi.fn(), setOpacity: vi.fn(), setIgnoreMouseEvents: vi.fn() };
}

describe('how an app window first appears', () => {
  it('shows and activates the window outside an e2e launch, whatever MAWS_E2E_QUIET says', () => {
    const win = fakeWindow();
    showAppWindow(win, { MAWS_E2E_QUIET: '0' });
    expect(win.show).toHaveBeenCalledOnce();
    expect(win.showInactive).not.toHaveBeenCalled();
    expect(win.setOpacity).not.toHaveBeenCalled();
  });

  it('is quiet by default in an e2e launch: transparent, click-through, never key', () => {
    const win = fakeWindow();
    showAppWindow(win, { MAWS_E2E: '1' });
    expect(win.setOpacity).toHaveBeenCalledWith(0);
    expect(win.setIgnoreMouseEvents).toHaveBeenCalledWith(true);
    expect(win.showInactive).toHaveBeenCalledOnce();
    expect(win.show).not.toHaveBeenCalled();
  });

  it('shows an e2e window opaque and clickable, still never key, only when MAWS_E2E_QUIET=0', () => {
    const win = fakeWindow();
    showAppWindow(win, { MAWS_E2E: '1', MAWS_E2E_QUIET: '0' });
    expect(win.setOpacity).not.toHaveBeenCalled();
    expect(win.setIgnoreMouseEvents).not.toHaveBeenCalled();
    expect(win.showInactive).toHaveBeenCalledOnce();
    expect(win.show).not.toHaveBeenCalled();
  });
});
