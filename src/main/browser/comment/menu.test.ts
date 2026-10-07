import { describe, expect, it, vi } from 'vitest';
import type { ContextMenuParams } from 'electron';
import type { BrowserTab } from '@shared/browser/tab';
import { contextMenuTemplate, type ContextMenuActions } from '../context-menu';
import { commentMenuExtra } from './menu';

vi.mock('electron', () => ({ clipboard: {}, Menu: {} }));

const params = { x: 250, y: 125, linkURL: '', srcURL: '', mediaType: 'none', isEditable: false, selectionText: '', editFlags: {} } as unknown as ContextMenuParams;
const tab = (over: Partial<BrowserTab> = {}) => ({ tabId: 'b_aaaaaaaaaaaa', control: 'idle', suspended: false, loadError: null, crashed: null, zoom: 1, canGoBack: false, canGoForward: false, ...over }) as BrowserTab;

describe('the context menu\'s Comment (Design §7)', () => {
  it('is enabled on a page no agent holds, and disabled under the agent, suspended, at a load error or a crash', () => {
    const extra = commentMenuExtra(() => {});
    const enabled = (over: Partial<BrowserTab>) => extra(params, tab(over)).map((item) => [item.label, item.enabled]);
    expect(enabled({})).toEqual([['Comment', true]]);
    expect(enabled({ control: 'human' })).toEqual([['Comment', true]]);
    expect(enabled({ control: 'agent' })).toEqual([['Comment', false]]);
    expect(enabled({ suspended: true })).toEqual([['Comment', false]]);
    expect(enabled({ loadError: { url: 'u', host: 'h', kind: 'dns', code: -105, description: 'd' } as never })).toEqual([['Comment', false]]);
    expect(enabled({ crashed: { reason: 'crashed' } })).toEqual([['Comment', false]]);
  });

  it('picks at the click point in CSS px: the view\'s DIP divided by the page\'s zoom', () => {
    const pickAt = vi.fn();
    const extra = commentMenuExtra(pickAt);
    const [item] = extra(params, tab({ zoom: 1.25 }));
    (item.click as () => void)();
    expect(pickAt).toHaveBeenCalledExactlyOnceWith('b_aaaaaaaaaaaa', 200, 100);
    const [plain] = extra(params, tab());
    (plain.click as () => void)();
    expect(pickAt).toHaveBeenLastCalledWith('b_aaaaaaaaaaaa', 250, 125);
  });

  it('reads the page\'s zoom at click time through the resolver, the tab\'s mirror when the page has none', () => {
    const pickAt = vi.fn();
    let live: number | undefined = 1.5;
    const zoomOf = vi.fn(() => live);
    const [item] = commentMenuExtra(pickAt, zoomOf)(params, tab({ zoom: 1.25 }));
    expect(zoomOf).not.toHaveBeenCalled(); // not at popup time
    (item.click as () => void)();
    expect(zoomOf).toHaveBeenCalledExactlyOnceWith('b_aaaaaaaaaaaa');
    expect(pickAt).toHaveBeenLastCalledWith('b_aaaaaaaaaaaa', 250 / 1.5, 125 / 1.5);
    live = undefined;
    (item.click as () => void)();
    expect(pickAt).toHaveBeenLastCalledWith('b_aaaaaaaaaaaa', 200, 100);
  });

  it('sits in its own section after Reload and before Inspect in E4a\'s menu', () => {
    const template = contextMenuTemplate(params, tab(), {} as ContextMenuActions, [commentMenuExtra(() => {})]);
    expect(template.map((item) => item.label ?? item.type)).toEqual(['Back', 'Forward', 'Reload', 'separator', 'Comment', 'separator', 'Inspect']);
  });
});
