// The Log tool (C8b execution document, M3; Interfaces *Log paging*): pages over a fake `fs.readSpill` that ends each
// page on a UTF-8 character boundary as C4 does, so the offset chain follows the answered `length`; the four-page
// window; Refresh; the refusal; `openLog`'s one tab per session and path; the no-file state; and `openFullLog`'s routes
// by the cell's kind.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, ToolUseId } from '@shared/graph/ids';
import type { FsReadSpillInput, FsReadSpillOutput } from '@shared/ipc/schema/fs';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { instanceOf, panelHost, setTitle, usePanelHost } from '../../../panel/host';
import type { PanelToolContext } from '../../../panel/tool';
import { useLayout } from '../../../stores/layout';
import { useSessions } from '../../../stores/sessions';
import { A, B, panelOf, resetPanelStores } from '../../../test-support/panel';
import { createState, registerTranscriptActions, useTranscriptStore, type Cell, type CellDetail, type CellId } from '../../../transcript';
import { setAgentWorkClient } from '../client';
import { fakeAgentWorkClient } from '../fake-work-client';
import { agentTranscriptActions, registerAgentTools } from '../index';
import { LOG_PAGE_BYTES, LOG_WINDOW_PAGES, pageWindow } from './log-model';
import { COPY_FEEDBACK_MS, logTool, openLog, type LogHandle, type LogParams } from './LogTool';

const PATH = '/private/tmp/claude-501/proj/sess/tasks/b53no4rmo.output';

// A file of numbered lines written in three-byte characters only (fullwidth digits, arrows, an ideographic space between
// lines), so every page boundary at a multiple of LOG_PAGE_BYTES (≡ 1 mod 3 from an offset ≡ 0) cuts a character: C4's
// page gives the byte back, and each page consumes one byte fewer than it asked.
const DIGITS = '０１２３４５６７８９';
function numberedLines(bytes: number): string {
  const count = Math.floor(bytes / 3);
  const chars: string[] = [];
  for (let i = 1; chars.length < count; i += 1) {
    chars.push(...String(i).padStart(6, '0').split('').map((d) => DIGITS[Number(d)]), ...'→'.repeat(33), '　');
  }
  return chars.slice(0, count).join('');
}

// C4's readSpill over an in-memory file: the page ends on a character boundary unless it reaches the end (it gives back
// the bytes of a cut character, so `length` falls short of the request), and `truncated` says whether more remains.
function spillOver(text: string) {
  const file = new TextEncoder().encode(text);
  const reads: FsReadSpillInput[] = [];
  const readSpill = vi.fn(async (input: FsReadSpillInput): Promise<FsReadSpillOutput> => {
    reads.push(input);
    const offset = input.offset ?? 0;
    let end = Math.min(file.length, offset + (input.length ?? 1024 * 1024));
    if (end < file.length) while (end > offset && (file[end] & 0xc0) === 0x80) end -= 1;
    return { content: new TextDecoder().decode(file.subarray(offset, end)), bytes: file.length, offset, length: end - offset, truncated: end < file.length };
  });
  return { readSpill, reads, file };
}

let spill: ReturnType<typeof spillOver>;
function installSpill(text: string): void {
  spill = spillOver(text);
  setAgentWorkClient({ ...fakeAgentWorkClient().client, readSpill: spill.readSpill });
}

const handles: LogHandle[] = [];
function create(params: LogParams | undefined, appSessionId: AppSessionId = A, instanceId = 'log:test'): LogHandle {
  const handle = logTool.createState({ appSessionId, session: null, instanceId, params: params as LogParams });
  handles.push(handle);
  return handle;
}

const titles: (string | null)[] = [];
function Mounted({ state }: { state: LogHandle }) {
  const ctx: PanelToolContext = {
    appSessionId: A, session: null, status: null, pinned: false, visible: true, focusRequest: 0, setTitle: (suffix) => void titles.push(suffix), close: () => {},
    openTool: panelHost.addTool,
  };
  const Body = logTool.render;
  return <Body state={state} ctx={ctx} />;
}

async function mount(params: LogParams | undefined) {
  const handle = create(params);
  const view = render(<Mounted state={handle} />);
  await act(async () => {}); // the first page's read settles
  return { handle, ...view };
}

const pages = () => Array.from(document.querySelectorAll<HTMLElement>('[data-log-page]'));
const offsets = () => pages().map((p) => Number(p.dataset.offset));
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const click = async (name: string) => {
  await act(async () => void fireEvent.click(button(name)));
};

beforeEach(() => {
  titles.splice(0);
  installSpill(numberedLines(1.5 * 1024 * 1024));
});

afterEach(() => {
  cleanup();
  handles.splice(0).forEach((handle) => logTool.dispose(handle));
  setAgentWorkClient(null);
});

describe('log tool', () => {
  it('reads the first page at 0 and shows the size; Load more reads at offset + length, not offset + LOG_PAGE_BYTES', async () => {
    await mount({ path: PATH, title: 'Wait 45 seconds' });
    expect(spill.reads[0]).toEqual({ path: PATH, offset: 0, length: LOG_PAGE_BYTES });
    expect(screen.getByText('1.5 MB')).toBeTruthy();
    expect(screen.getByText(PATH)).toBeTruthy();
    const first = spill.readSpill.mock.results[0];
    const firstLength = (await first.value).length;
    expect(firstLength).toBeLessThan(LOG_PAGE_BYTES); // the page ended mid-character and gave the character back
    await click('Load more');
    expect(spill.reads[1].offset).toBe(firstLength);
    expect(spill.reads[1].offset).not.toBe(LOG_PAGE_BYTES);
    expect(offsets()).toEqual([0, firstLength]);
    // adjacent pages decode independently: no replacement character where a boundary cut a character
    expect(pages().map((p) => p.textContent).join('')).not.toContain('�');
  });

  it('keeps four pages in the window: the fifth drops the first, and Show earlier re-reads it at its recorded offset', async () => {
    await mount({ path: PATH, title: 'shell' });
    for (let i = 0; i < 3; i += 1) await click('Load more');
    expect(pages()).toHaveLength(LOG_WINDOW_PAGES);
    const chain = offsets();
    await click('Load more');
    expect(pages()).toHaveLength(LOG_WINDOW_PAGES);
    expect(offsets()[0]).toBe(chain[1]); // the first page left the window
    expect(chain.every((offset, i) => i === 0 || offset !== i * LOG_PAGE_BYTES)).toBe(true);
    await click('Show earlier');
    expect(spill.reads.at(-1)?.offset).toBe(0);
    expect(offsets()).toEqual(chain); // the first page is back and the fifth left
    expect(screen.queryByRole('button', { name: 'Show earlier' })).toBeNull();
  });

  it('Refresh re-reads the last page in the window and updates the size', async () => {
    const { handle } = await mount({ path: PATH, title: 'shell' });
    await click('Load more');
    const last = offsets()[1];
    installSpill(numberedLines(2 * 1024 * 1024)); // the output file grew
    await act(async () => void (await handle.refresh()));
    expect(spill.reads).toEqual([{ path: PATH, offset: last, length: LOG_PAGE_BYTES }]);
    expect(screen.getByText('2 MB')).toBeTruthy();
  });

  it('a refusal renders Refused: with the path and reads once', async () => {
    const readSpill = vi.fn(async () => {
      throw new Error('path outside the engine store');
    });
    setAgentWorkClient({ ...fakeAgentWorkClient().client, readSpill });
    await mount({ path: '/etc/passwd', title: 'x' });
    expect(screen.getByText('Refused: path outside the engine store')).toBeTruthy();
    expect(screen.getByText('/etc/passwd')).toBeTruthy();
    expect(readSpill).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('with path null renders the no-file state and never reads', async () => {
    await mount({ path: null, title: 'Ran npm test' });
    expect(screen.getByText('No file to open: the engine reported no output file for this cell; the transcript shows what was kept')).toBeTruthy();
    expect(spill.readSpill).not.toHaveBeenCalled();
    expect(titles.at(-1)).toBe('Ran npm test');
  });

  it('titles the tab with the file’s basename', async () => {
    await mount({ path: PATH, title: 'Wait 45 seconds' });
    expect(titles.at(-1)).toBe('b53no4rmo.output');
  });

  it('renders End of file and disables Load more when the last page is not truncated', async () => {
    installSpill('short output\n');
    await mount({ path: PATH, title: 'x' });
    expect(screen.getByText('End of file')).toBeTruthy();
    expect(button('Load more').disabled).toBe(true);
  });

  it('chains the next offset by the answered length when it equals the request, as when it falls short', async () => {
    installSpill('a'.repeat(LOG_PAGE_BYTES * 2 + 10)); // ASCII: every page consumes what it asked
    await mount({ path: PATH, title: 'x' });
    await click('Load more');
    await click('Load more');
    expect(offsets()).toEqual([0, LOG_PAGE_BYTES, LOG_PAGE_BYTES * 2]);
    expect(screen.getByText('End of file')).toBeTruthy();
  });

  it('a restored tab (params undefined) says so and reads nothing', async () => {
    await mount(undefined);
    expect(screen.getByText('This log was not restored. Reopen it from its row')).toBeTruthy();
    expect(spill.readSpill).not.toHaveBeenCalled();
  });

  it('pageWindow grows to include a page and trims the far side to four', () => {
    expect(pageWindow(null, 0)).toEqual({ from: 0, to: 0 });
    expect(pageWindow({ from: 0, to: 3 }, 4)).toEqual({ from: 1, to: 4 });
    expect(pageWindow({ from: 1, to: 4 }, 0)).toEqual({ from: 0, to: 3 });
    expect(pageWindow({ from: 1, to: 4 }, 4)).toEqual({ from: 1, to: 4 });
  });
});

describe('log tool: openLog and openFullLog', () => {
  beforeEach(() => {
    resetPanelStores();
    registerAgentTools();
  });

  const logTabs = (id: AppSessionId) => (panelOf(id)?.tabs ?? []).filter((t) => t.toolId === 'log');
  const logOf = (tabId: string) => (instanceOf(tabId)?.state as LogHandle).snapshot();

  it('registers Log off the "+" menu, unpinnable and multi-instance', () => {
    const log = panelHost.tools().find((t) => t.id === 'log');
    expect(log).toMatchObject({ menu: false, pinnable: false, multiInstance: true });
  });

  it('opens one tab per session and path: a second openLog selects it, another session gets its own', () => {
    const selectTab = vi.spyOn(panelHost, 'selectTab');
    let first = '';
    act(() => void (first = openLog(A, PATH, 'shell')));
    let again = '';
    act(() => void (again = openLog(A, PATH, 'shell')));
    expect(again).toBe(first);
    expect(logTabs(A)).toHaveLength(1);
    expect(selectTab).toHaveBeenCalledWith(first);
    act(() => void openLog(B, PATH, 'shell'));
    expect(logTabs(B)).toHaveLength(1);
    expect(logTabs(A)).toHaveLength(1);
    selectTab.mockRestore();
  });

  it('a null path always opens a new tab in the no-file state', () => {
    act(() => void openLog(A, null, 'Ran npm test'));
    act(() => void openLog(A, null, 'Ran npm test'));
    expect(logTabs(A)).toHaveLength(2);
    expect(logOf(logTabs(A)[0].id)).toMatchObject({ path: null, title: 'Ran npm test' });
    expect(spill.readSpill).not.toHaveBeenCalled();
  });

  it('a second tab added straight through the host still works, and openLog then selects the newest', () => {
    const one = panelHost.addTool('log', { appSessionId: A, params: { path: PATH, title: 'x' } });
    const two = panelHost.addTool('log', { appSessionId: A, params: { path: PATH, title: 'x' } });
    expect(one).not.toBe(two);
    expect(logOf(two).path).toBe(PATH);
    const selectTab = vi.spyOn(panelHost, 'selectTab');
    act(() => void openLog(A, PATH, 'x'));
    expect(selectTab).toHaveBeenCalledWith(two);
    selectTab.mockRestore();
  });

  it('closing the tab forgets it: the next openLog opens a new one', async () => {
    let first = '';
    act(() => void (first = openLog(A, PATH, 'x')));
    await act(async () => void (await panelHost.closeTab(first)));
    let next = '';
    act(() => void (next = openLog(A, PATH, 'x')));
    expect(next).not.toBe(first);
    expect(logTabs(A)).toHaveLength(1);
  });

  const cell = (detail: CellDetail, label = 'Ran npm test'): Cell => ({
    id: 'cell-1' as CellId, toolUseId: 'toolu_1' as ToolUseId, toolName: 'Bash', category: 'shell' as Cell['category'], classification: {} as Cell['classification'], status: 'done', label, paths: [],
    startedAt: '2026-09-29T10:00:00.000Z', endedAt: null, detail, expanded: true, agent: null,
  });
  const spillOf = (path: string) => ({ path, bytes: 3_000_000, state: 'partial' as const, content: null });
  const shell = (over: Partial<Extract<CellDetail, { kind: 'shell' }>> = {}): CellDetail => ({
    kind: 'shell', command: 'npm test', description: null, cwd: null, stdout: '', stderr: '', exitCode: 0, interrupted: false, backgroundTaskId: null, truncated: null, spill: null, ...over,
  });

  it('openFullLog opens a Log on a shell cell’s spill and on an MCP cell’s spill, titled by the file', () => {
    act(() => agentTranscriptActions.openFullLog(cell(shell({ spill: spillOf('/Users/me/.claude/projects/p/s/tool-results/a.txt') }))));
    expect(logTabs(A).map((t) => logOf(t.id).path)).toEqual(['/Users/me/.claude/projects/p/s/tool-results/a.txt']);
    const mcp: CellDetail = { kind: 'mcp', server: 'docs', tool: 'search', input: {}, result: '', structured: null, spill: spillOf('/Users/me/.claude/projects/p/s/tool-results/b.txt') };
    act(() => agentTranscriptActions.openFullLog(cell(mcp, 'docs · search')));
    expect(logTabs(A).map((t) => logOf(t.id).path)).toEqual(['/Users/me/.claude/projects/p/s/tool-results/a.txt', '/Users/me/.claude/projects/p/s/tool-results/b.txt']);
    expect(usePanelHost.getState().titles[logTabs(A)[1].id] ?? null).toBeNull(); // the body sets the title when it renders
    for (const tab of logTabs(A)) render(<HostedBody tabId={tab.id} />);
    expect(logTabs(A).map((t) => usePanelHost.getState().titles[t.id])).toEqual(['a.txt', 'b.txt']);
  });

  it('openFullLog on a truncated shell cell without a spill opens the no-file state', () => {
    act(() => agentTranscriptActions.openFullLog(cell(shell({ truncated: { shownHead: 10, shownTail: 10, omittedBytes: 116_000 } }), 'Ran a long build')));
    expect(logTabs(A).map((t) => logOf(t.id))).toEqual([expect.objectContaining({ path: null, title: 'Ran a long build' })]);
    expect(spill.readSpill).not.toHaveBeenCalled();
  });

  it('openFullLog on an Edit cell calls the registered openFile at the first hunk and opens no Log', () => {
    const openFile = vi.fn();
    const off = registerTranscriptActions({ openFile });
    const edit: CellDetail = { kind: 'edit', filePath: '/work/app-a/src/a.ts', change: 'update', hunks: [{ oldStart: 12, oldLines: 1, newStart: 14, newLines: 2, lines: [] }], added: 1, removed: 0 };
    act(() => agentTranscriptActions.openFullLog(cell(edit, 'Edited a.ts')));
    expect(openFile).toHaveBeenCalledWith('/work/app-a/src/a.ts', 14);
    expect(logTabs(A)).toEqual([]);
    off();
  });

  it('openFullLog does nothing when no session is focused and no transcript holds the cell', () => {
    act(() => useSessions.setState({ records: new Map() }));
    act(() => useLayout.setState({ main: LAYOUT_DEFAULTS.main })); // nothing open
    expect(() => agentTranscriptActions.openFullLog(cell(shell({ spill: spillOf(PATH) })))).not.toThrow();
    expect(logTabs(A)).toEqual([]);
  });

  // No focused pane: the session is the one whose transcript indexes the cell's tool use; a child's key names its parent.
  function unfocusWithTranscript(key: string): void {
    act(() => useLayout.setState({ main: LAYOUT_DEFAULTS.main })); // nothing open
    const state = createState(null, null);
    state.index.toolUses.set('toolu_1' as ToolUseId, 'turn-1' as never);
    useTranscriptStore.setState({ entries: { [key]: { state } as never } });
  }
  afterEach(() => useTranscriptStore.setState({ entries: {} }));

  it('openFullLog falls back to the session transcript that holds the cell when no pane is focused', () => {
    unfocusWithTranscript(A);
    act(() => agentTranscriptActions.openFullLog(cell(shell({ spill: spillOf(PATH) }))));
    expect(logTabs(A).map((t) => logOf(t.id).path)).toEqual([PATH]);
  });

  it('openFullLog falls back to a child transcript’s key, which names its parent session', () => {
    unfocusWithTranscript(`${B}:a425e926e506edeb1`);
    act(() => agentTranscriptActions.openFullLog(cell(shell({ spill: spillOf(PATH) }))));
    expect(logTabs(B).map((t) => logOf(t.id).path)).toEqual([PATH]);
    expect(logTabs(A)).toEqual([]);
  });
});

// The body of a hosted Log tab, its title going to the host as ToolBody sends it.
function HostedBody({ tabId }: { tabId: string }) {
  const ctx: PanelToolContext = {
    appSessionId: A, session: null, status: null, pinned: false, visible: true, focusRequest: 0, setTitle: (suffix) => setTitle(tabId, suffix), close: () => {},
    openTool: panelHost.addTool,
  };
  const Body = logTool.render;
  return <Body state={instanceOf(tabId)!.state as LogHandle} ctx={ctx} />;
}

describe('log tool: Copy path', () => {
  const copyButton = () => screen.getByRole('button', { name: 'Copy path' });
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('says Copied, then returns to Copy path after a moment', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await mount({ path: PATH, title: 'x' });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await act(async () => void fireEvent.click(copyButton()));
    expect(writeText).toHaveBeenCalledWith(PATH);
    expect(copyButton().title).toBe('Copied');
    act(() => vi.advanceTimersByTime(COPY_FEEDBACK_MS));
    expect(copyButton().title).toBe('Copy path');
  });

  it('says so when the clipboard refuses', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => Promise.reject(new Error('denied')) }, configurable: true });
    await mount({ path: PATH, title: 'x' });
    await act(async () => void fireEvent.click(copyButton()));
    expect(copyButton().title).toBe("Couldn't copy the path");
  });
});
