// The browser preload's scope (cua board #90's spec, "The popup view"; its S1 spike measured that the partition's frame
// preload runs in every extension document: popups, options pages, MV2 background pages, offscreen documents). It acts
// in a page a tab shows (http, https, and an adopted child's about:blank) and in nothing else: an extension's own
// document gets no comment mode, no cursor and no run count.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ ipcRenderer: { on: vi.fn(), send: vi.fn() } }));
const installCommentMode = vi.fn();
const installAgentCursor = vi.fn();
vi.mock('./browser-comment', () => ({ installCommentMode }));
vi.mock('./browser-cursor', () => ({ installAgentCursor }));

const world = globalThis as { __mawsBrowserPreloadRuns?: number };

async function runIn(protocol: string): Promise<{ comment: number; cursor: number; runs: number | undefined }> {
  vi.resetModules();
  installCommentMode.mockClear();
  installAgentCursor.mockClear();
  delete world.__mawsBrowserPreloadRuns;
  vi.stubGlobal('location', { protocol });
  await import('./browser');
  return { comment: installCommentMode.mock.calls.length, cursor: installAgentCursor.mock.calls.length, runs: world.__mawsBrowserPreloadRuns };
}

afterEach(() => vi.unstubAllGlobals());

describe('the browser preload\'s early return (cua #90)', () => {
  it('acts in a tab\'s page: http, https, about:blank', async () => {
    for (const protocol of ['http:', 'https:', 'about:']) expect(await runIn(protocol), protocol).toEqual({ comment: 1, cursor: 1, runs: 1 });
  });

  it('does nothing in an extension\'s page or any other document', async () => {
    for (const protocol of ['chrome-extension:', 'devtools:', 'chrome:', 'file:', 'data:']) expect(await runIn(protocol), protocol).toEqual({ comment: 0, cursor: 0, runs: undefined });
  });
});
