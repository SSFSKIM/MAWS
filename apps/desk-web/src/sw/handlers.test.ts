import { describe, expect, it, vi } from 'vitest';
import { onNotificationClick, onPush, OPEN_MESSAGE, type WindowLike, type WorkerScope } from './handlers';
import { noticeUrl, type Notice } from './notice';

const notice: Notice = { v: 1, project: 'p1', session: 's1', alias: 'maws-45', kind: 'question', request: 'toolu_01' };

function scope(windows: WindowLike[] = [], badging = true) {
  const shown: Array<{ title: string; options: NotificationOptions }> = [];
  const opened: string[] = [];
  const badges: number[] = [];
  const worker: WorkerScope = {
    navigator: badging ? { setAppBadge: async (count: number) => void badges.push(count) } : {},
    registration: { showNotification: async (title, options) => void shown.push({ title, options: options ?? {} }) },
    clients: {
      matchAll: async () => windows,
      openWindow: async (url) => {
        opened.push(url);
        return null;
      },
    },
  };
  return { worker, shown, opened, badges };
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
    expect(shown[0].title).toBe('maws-45 has a question for you');
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

describe("the app icon's badge", () => {
  it("is set to the org's waiting count the push carries", async () => {
    const { worker, badges } = scope();
    await onPush(worker, { json: () => ({ ...notice, waiting: 3 }) });
    expect(badges).toEqual([3]);
    await onPush(worker, { json: () => ({ ...notice, waiting: 0 }) });
    expect(badges).toEqual([3, 0]);
  });

  it('is left alone when the push carries no count, or the platform has no badge', async () => {
    const { worker, badges, shown } = scope();
    await onPush(worker, { json: () => notice });
    await onPush(worker, null);
    expect(badges).toEqual([]);
    const without = scope([], false);
    await onPush(without.worker, { json: () => ({ ...notice, waiting: 2 }) });
    expect(without.shown).toHaveLength(1);
    expect(shown).toHaveLength(2);
  });

  it('never keeps the notification from showing when setting it fails', async () => {
    const { worker, shown } = scope();
    worker.navigator.setAppBadge = async () => {
      throw new Error('not allowed');
    };
    await onPush(worker, { json: () => ({ ...notice, waiting: 1 }) });
    expect(shown).toHaveLength(1);
  });
});

describe('a v2 push', () => {
  const v2 = { project: 'p1', machine: 'm1', session: 's1', kind: 'waiting' };

  it('shows its notification, landing on the session’s cards', async () => {
    const { worker, shown } = scope();
    await onPush(worker, { json: () => v2 });
    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe('A session is waiting for your answer');
    expect(shown[0].options.data).toEqual({ url: '/cards/m1/s1' });
  });

  it('leaves the badge alone: it carries no count', async () => {
    const { worker, badges } = scope();
    await onPush(worker, { json: () => v2 });
    await onPush(worker, { json: () => ({ ...v2, kind: 'wrote' }) });
    expect(badges).toEqual([]);
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
