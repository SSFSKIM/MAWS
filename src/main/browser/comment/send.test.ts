import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { eventChannel } from '@shared/ipc/schema';
import type { BrowserCommentPicked } from '@shared/ipc/schema/browser';
import { sendPicked, type PickOwner } from './send';

const payload: BrowserCommentPicked = {
  tabId: 'b_0123456789ab',
  appSessionId: 'App-A' as AppSessionId,
  anchor: { kind: 'browser-element', locator: '#increment', label: 'button “Increment”', css: '#increment', role: 'button', name: 'Increment', box: { x: 1, y: 2, width: 3, height: 4 } },
  crop: 'none',
};

function owner({ destroyed = false, contentsDestroyed = false } = {}) {
  const send = vi.fn();
  const win: PickOwner = { isDestroyed: () => destroyed, webContents: { isDestroyed: () => contentsDestroyed, send } };
  return { win, send };
}

describe('sendPicked (Design §8, Decision Log 14): the owner window alone, or nobody', () => {
  it('sends the validated payload to the owner window on the event channel', () => {
    const { win, send } = owner();
    expect(sendPicked(win, payload)).toBe(true);
    expect(send).toHaveBeenCalledExactlyOnceWith(eventChannel('browser.comment.picked'), payload);
  });

  it('answers false and sends nothing with no owner window, or one closed', () => {
    expect(sendPicked(null, payload)).toBe(false);
    for (const gone of [owner({ destroyed: true }), owner({ contentsDestroyed: true })]) {
      expect(sendPicked(gone.win, payload)).toBe(false);
      expect(gone.send).not.toHaveBeenCalled();
    }
  });

  it('refuses a payload the X2 registry refuses (an anchor with a control character)', () => {
    const { win, send } = owner();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(sendPicked(win, { ...payload, anchor: { ...payload.anchor, label: 'a\nb' } })).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});
