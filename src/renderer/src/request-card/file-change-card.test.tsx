// A file change's permission card (UX wave U1a, M4; §I, A11): "Create" or "Edit" read from the file as it stands on the
// session's machine, the path relative to the working folder, and the change as the transcript's diff lines, every line
// readable before the answer. The read never holds the buttons: while it is out, when it fails and when it never
// answers, the card shows the input alone under "Write <name>" or "Edit <name>" and answers as before; a late answer
// lands nowhere once the person has answered, nor on a card drawn for another request.
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId, RequestId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import type { FilesReadOutput } from '@shared/ipc/schema/files';
import type { LaneARaised } from '@shared/ipc/schema/lane-a';
import { bareOf } from '@shared/machine/address';
import { record } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { at } from '../../../../test/support/machine';
import { laneAState } from '../lane-a/test-support/lane-a-state';
import { connectKeys } from '../keymap/dispatcher';
import { applyLaneAState, resetLaneAStore } from '../stores/lane-a';
import { useSessions } from '../stores/sessions';
import { resetShellStores } from '../test-support/shell-stores';
import { RequestCard, type Placement } from './RequestCard';
import { itemFor, permission, type PermissionEvent } from './test-requests';

const APP = at('app-files' as AppSessionId);
const FOLDER = '/work/proj';
let fake: FakeClient;
let disconnect: () => void;

beforeEach(() => {
  resetShellStores();
  useSessions.setState((s) => ({ records: new Map(s.records).set(APP, record(APP, { directory: FOLDER })), recordsVersion: s.recordsVersion + 1 }));
  fake = fakeClient({ 'session.answer': { outcome: 'delivered' } }); // `files.read` waits until a test answers it
  window.maws = fake.client as unknown as PreloadBridge;
  disconnect = connectKeys();
});
afterEach(() => {
  disconnect();
  cleanup();
  delete (window as { maws?: PreloadBridge }).maws;
  vi.restoreAllMocks();
});

const TWENTY = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
const read = (content: string, over: Partial<FilesReadOutput> = {}): FilesReadOutput => ({
  encoding: 'utf8', content, bytes: content.length, offset: 0, length: content.length, truncated: false, mime: 'text/plain', hash: null, utf8: null, ...over,
});
const editRequest = (over: Partial<PermissionEvent> = {}) =>
  permission({ toolName: 'Edit', displayName: 'Edit', input: { file_path: `${FOLDER}/src/list.txt`, old_string: 'line 10\n', new_string: 'line ten\n' }, ...over });
const writeRequest = (content = '# Notes\n\nFirst entry\n') => permission({ toolName: 'Write', displayName: 'Write', input: { file_path: `${FOLDER}/notes.md`, content } });

function mount(event: PermissionEvent, placement: Placement = 'docked', over: Partial<AttentionItem> = {}, appSessionId = APP) {
  const item = itemFor(event, appSessionId, over);
  const card = <RequestCard item={item} request={event} placement={placement} paneIndex={0} />;
  const view = render(placement === 'card' ? <article tabIndex={0}>{card}</article> : card);
  return { item, view };
}

const heading = () => document.querySelector('[data-request-card] h3')?.textContent ?? null; // what is asked: the kind's glyph, then the words
const diffLines = () => [...document.querySelectorAll('[data-diff]')];
const answers = () => fake.invoked('session.answer').map((input) => (input as { answer: unknown }).answer);
const allowOnce = () => screen.getByRole('button', { name: 'Allow once' }) as HTMLButtonElement;

describe('the read of the file', () => {
  it('is made once, for the path the call names, on the session', async () => {
    const { view } = mount(editRequest());
    view.rerender(<RequestCard item={itemFor(editRequest(), APP)} request={editRequest()} placement="docked" paneIndex={0} />);
    await act(async () => {});
    expect(fake.invoked('files.read')).toEqual([{ appSessionId: bareOf(APP), path: `${FOLDER}/src/list.txt` }]);
  });

  it('is not made for the hover placement, a notebook, a command, or a call that names several files', async () => {
    mount(editRequest(), 'hover');
    cleanup();
    mount(permission({ toolName: 'NotebookEdit', displayName: 'NotebookEdit', input: { notebook_path: `${FOLDER}/n.ipynb`, new_source: 'x' } }));
    cleanup();
    mount(permission());
    cleanup();
    mount(permission({ toolName: 'MultiEdit', displayName: 'MultiEdit', input: { file_path: `${FOLDER}/a.ts`, edits: [{ file_path: `${FOLDER}/b.ts`, old_string: 'a', new_string: 'b' }] } }));
    await act(async () => {});
    expect(fake.invoked('files.read')).toEqual([]);
  });
});

describe('the card while the read is out, and when it answers', () => {
  it('shows the input alone under "Edit <name>" with its buttons answering; an Allow sends one answer, and the late read changes nothing', async () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    mount(editRequest());
    expect(heading()).toMatch(/Edit list\.txt$/);
    expect(screen.getByText(/^line 10/).textContent).toBe('line 10\n'); // the old text, in the input's own block
    expect(diffLines()).toEqual([]);
    expect(allowOnce().disabled).toBe(false);
    await userEvent.setup().click(allowOnce());
    await waitFor(() => expect(answers()).toEqual([{ kind: 'permission', decision: 'allow', scope: 'once' }]));
    await act(() => fake.reply('files.read', read(TWENTY)));
    await act(async () => {});
    expect(diffLines()).toEqual([]);
    expect(heading()).toMatch(/Edit list\.txt$/);
    expect(answers()).toHaveLength(1);
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
  });

  it.each(['docked', 'card', 'inline'] as const)('draws the change as numbered diff lines with three lines of context once the file is read (%s)', async (placement) => {
    mount(editRequest(), placement);
    await act(() => fake.reply('files.read', read(TWENTY)));
    await waitFor(() => expect(diffLines()).toHaveLength(8));
    expect(heading()).toMatch(/Edit list\.txt$/);
    expect(diffLines().map((line) => line.querySelector('[data-line-number]')!.textContent)).toEqual(['7', '8', '9', '10', '10', '11', '12', '13']);
    expect(diffLines().map((line) => (line as HTMLElement).dataset.diff)).toEqual(['context', 'context', 'context', 'del', 'add', 'context', 'context', 'context']);
    expect(allowOnce().disabled).toBe(false);
  });

  it('reads "Create <name>" for a Write of a file that does not exist, its lines all added', async () => {
    mount(writeRequest());
    await act(() => fake.fail('files.read', `not found: ${FOLDER}/notes.md`));
    expect(heading()).toMatch(/Create notes\.md$/);
    await waitFor(() => expect(diffLines().map((line) => (line as HTMLElement).dataset.diff)).toEqual(['add', 'add', 'add']));
  });

  it('reads "Edit <name>" for a Write over a file that exists, as a line diff', async () => {
    mount(writeRequest('# Notes\n\nFirst entry, revised\n'));
    await act(() => fake.reply('files.read', read('# Notes\n\nFirst entry\n')));
    expect(heading()).toMatch(/Edit notes\.md$/);
    await waitFor(() => expect(diffLines().map((line) => (line as HTMLElement).dataset.diff)).toEqual(['context', 'context', 'del', 'add']));
  });

  it.each([
    ['refused', () => fake.fail('files.read', "path outside the session's directories")],
    ['the link down', () => fake.fail('files.read', 'files.read: machine m2 is not reachable', 'host_unavailable')],
    ['too large', () => fake.reply('files.read', read('# Notes\n', { truncated: true, bytes: 2_000_000 }))],
    ['not text', () => fake.reply('files.read', read('AAEC', { encoding: 'base64', mime: 'application/octet-stream' }))],
  ])('shows the input alone under "Write <name>" when the read fails (%s), and still answers', async (_, fail) => {
    mount(writeRequest());
    await act(fail);
    await act(async () => {});
    expect(heading()).toMatch(/Write notes\.md$/);
    expect(diffLines()).toEqual([]);
    expect(screen.getByText(/^# Notes/).textContent).toBe('# Notes\n\nFirst entry\n');
    await userEvent.setup().click(allowOnce());
    await waitFor(() => expect(answers()).toHaveLength(1));
  });

  it('shows the input alone under "Write <name>" while the read never answers', async () => {
    mount(writeRequest());
    await act(async () => {});
    expect(heading()).toMatch(/Write notes\.md$/);
    expect(diffLines()).toEqual([]);
    expect(allowOnce().disabled).toBe(false);
  });

  it('never shows one request’s file on a card drawn for another', async () => {
    const first = editRequest({ requestId: 'req-first' as PermissionEvent['requestId'] });
    const second = editRequest({ requestId: 'req-second' as PermissionEvent['requestId'], input: { file_path: `${FOLDER}/src/list.txt`, old_string: 'line 2\n', new_string: 'two\n' } });
    const { view } = mount(first);
    view.rerender(<RequestCard item={itemFor(second, APP)} request={second} placement="docked" paneIndex={0} />);
    await act(() => fake.reply('files.read', read(TWENTY), 0)); // the first card's read, late
    await act(async () => {});
    expect(diffLines()).toEqual([]);
    await act(() => fake.reply('files.read', read(TWENTY)));
    await waitFor(() => expect(diffLines().map((line) => line.lastElementChild!.textContent)).toContain('two'));
  });
});

describe('the whole change, before the answer', () => {
  it('a change past the diff’s budget leaves lines out while collapsed and holds every line after "Show all", the buttons enabled throughout', async () => {
    const before = Array.from({ length: 100 }, (_, i) => `a${i} ${'x'.repeat(1000)}`).join('\n') + '\n';
    const after = Array.from({ length: 100 }, (_, i) => `b${i} ${'x'.repeat(1000)}`).join('\n') + '\n';
    mount(writeRequest(after));
    expect(allowOnce().disabled).toBe(false);
    await act(() => fake.reply('files.read', read(before)));
    await waitFor(() => expect(document.querySelector('[data-omitted]')).not.toBeNull());
    expect(allowOnce().disabled).toBe(false);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show all' }));
    expect(document.querySelector('[data-omitted]')).toBeNull();
    expect(diffLines()).toHaveLength(200);
    expect(allowOnce().disabled).toBe(false);
  });
});

describe('the path under the first line', () => {
  it('is relative inside the working folder and whole in its title; whole outside it and where this window holds no record', async () => {
    mount(editRequest());
    const path = screen.getByTestId('request-input');
    expect(path.textContent).toBe('src/list.txt');
    expect(path.querySelector('[title]')!.getAttribute('title')).toBe(`${FOLDER}/src/list.txt`);
    cleanup();
    mount(editRequest({ input: { file_path: '/elsewhere/list.txt', old_string: 'a', new_string: 'b' } }));
    expect(screen.getByTestId('request-input').textContent).toBe('/elsewhere/list.txt');
    cleanup();
    const stranger = at('app-unknown' as AppSessionId);
    mount(editRequest(), 'docked', {}, stranger);
    expect(screen.getByTestId('request-input').textContent).toBe(`${FOLDER}/src/list.txt`);
  });
});

describe('a terminal session’s file change', () => {
  const LANE_A = at('app-files-terminal' as AppSessionId);
  const REQ = 'toolu_write' as RequestId;
  beforeEach(() => {
    resetLaneAStore();
    useSessions.setState((s) => ({ records: new Map(s.records).set(LANE_A, record(LANE_A, { directory: FOLDER, holder: { kind: 'terminal', pid: 4242 } })), recordsVersion: s.recordsVersion + 1 }));
    fake = fakeClient({ 'laneA.answer': { outcome: 'delivered' }, 'laneA.catalog': null });
    window.maws = fake.client as unknown as PreloadBridge;
    const raised: LaneARaised = { request: REQ, session: 'eng-1', tool: 'Write', input: writeRequest().input };
    applyLaneAState(LANE_A, laneAState(LANE_A, { pending: [raised] }));
  });

  it('draws the diff where the read answers', async () => {
    mount({ ...writeRequest(), requestId: REQ }, 'docked', {}, LANE_A);
    await act(() => fake.fail('files.read', `not found: ${FOLDER}/notes.md`));
    expect(heading()).toMatch(/Create notes\.md$/);
    await waitFor(() => expect(diffLines()).toHaveLength(3));
  });

  it('shows the input alone where the read is refused, and answers', async () => {
    mount({ ...writeRequest(), requestId: REQ }, 'docked', {}, LANE_A);
    await act(() => fake.fail('files.read', "path outside the session's directories"));
    expect(heading()).toMatch(/Write notes\.md$/);
    expect(diffLines()).toEqual([]);
    await userEvent.setup().click(allowOnce());
    await waitFor(() => expect(fake.invoked('laneA.answer')).toHaveLength(1));
  });
});
