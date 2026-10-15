import { describe, expect, it, vi } from 'vitest';
import type { PushNotice } from 'desk-hub/protocol';
import { onNotificationClick, onPush, OPEN_MESSAGE, type WindowLike, type WorkerScope } from './handlers';
import { noticeUrl } from './notice';

const notice: PushNotice = { v: 1, project: 'p1', session: 's1', alias: 'maws-45', kind: 'question', request: 'toolu_01' };

function scope(windows: WindowLike[] = []) {
  const shown: Array<{ title: string; options: NotificationOptions }> = [];
  const opened: string[] = [];
  const worker: WorkerScope = {
    registration: { showNotification: async (title, options) => void shown.push({ title, options: options ?? {} }) },
    clients: {
      matchAll: async () => windows,
      openWindow: async (url) => {
        opened.push(url);
        return null;
      },
    },
  };
  return { worker, shown, opened };
}

const windowAt = (url: string, visibility: DocumentVisibilityState = 'hidden', focused = false): WindowLike & { posted: unknown[]; focusCalls: number } => {
  const client = {
    url,
    visibilityState: visibility,
    focused,
    posted: [] as unknown[],
    focusCalls: 0,
    postMessage(message: unknown) {
      client.posted.push(message);
    },
    async focus() {
      client.focusCalls++;
      return client;
    },
  };
  return client;
};

describe('onPush', () => {
  it('shows the notification the payload describes', async () => {
    const { worker, shown } = scope();
    await onPush(worker, { json: () => notice });
    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe('maws-45 has a question');
    expect(shown[0].options.data).toEqual({ url: noticeUrl(notice) });
  });

  it('still shows a notification for a push it cannot read (a silent push costs the subscription on iOS)', async () => {
    for (const data of [null, { json: () => ({ v: 9 }) }, { json: () => { throw new SyntaxError('not JSON'); } }]) {
      const { worker, shown } = scope();
      await onPush(worker, data);
      expect(shown).toHaveLength(1);
      expect(shown[0].title).toBe('The desk');
      expect(shown[0].options.data).toEqual({ url: '/' });
    }
  });
});

describe('onNotificationClick', () => {
  const notification = (data: unknown) => ({ data, close: vi.fn() });

  it('opens the app at the card when no window of it is open', async () => {
    const { worker, opened } = scope();
    const clicked = notification({ url: noticeUrl(notice) });
    await onNotificationClick(worker, clicked);
    expect(clicked.close).toHaveBeenCalled();
    expect(opened).toEqual([noticeUrl(notice)]);
  });

  it("brings an open window forward and tells it where to go, keeping the app's state", async () => {
    const hidden = windowAt('https://desk.example/');
    const visible = windowAt('https://desk.example/p/x', 'visible');
    const { worker, opened } = scope([hidden, visible]);
    await onNotificationClick(worker, notification({ url: noticeUrl(notice) }));
    expect(opened).toEqual([]);
    expect(visible.focusCalls).toBe(1);
    expect(visible.posted).toEqual([{ type: OPEN_MESSAGE, url: noticeUrl(notice) }]);
    expect(hidden.posted).toEqual([]);
  });

  it('falls back to a new window when the open one cannot be focused', async () => {
    const stuck = windowAt('https://desk.example/');
    stuck.focus = async () => {
      throw new Error('not allowed');
    };
    const { worker, opened } = scope([stuck]);
    await onNotificationClick(worker, notification({ url: noticeUrl(notice) }));
    expect(opened).toEqual([noticeUrl(notice)]);
  });

  it('opens only paths of the app itself', async () => {
    for (const url of ['https://elsewhere.example/', '//elsewhere.example/x', 'javascript:alert(1)', 42]) {
      const { worker, opened } = scope();
      await onNotificationClick(worker, notification({ url }));
      expect(opened).toEqual(['/']);
    }
  });
});
