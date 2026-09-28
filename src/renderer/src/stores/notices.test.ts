import { describe, expect, it } from 'vitest';
import { createNoticesStore } from './notices';

describe('notices', () => {
  it('posts banners and toasts, replaces a notice shown again under its id, and dismisses', () => {
    const store = createNoticesStore();
    const near = store.getState().banner({ id: 'near-limit', level: 'warning', text: '80% of 5h', actions: [], dismissible: true });
    store.getState().toast({ level: 'info', text: 'Fix sidebar drag needs you', actions: [], dismissible: true });
    store.getState().banner({ id: 'near-limit', level: 'danger', text: '95% of 5h', actions: [], dismissible: true });
    expect(store.getState().notices.map((n) => [n.kind, n.text])).toEqual([['banner', '95% of 5h'], ['toast', 'Fix sidebar drag needs you']]);
    store.getState().dismiss(near);
    expect(store.getState().notices.map((n) => n.kind)).toEqual(['toast']);
  });
});
