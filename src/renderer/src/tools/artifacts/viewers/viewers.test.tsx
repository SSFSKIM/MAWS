// The `html` and `file` editors on the artifact store (the P3-L execution document, M5b): each frames the shown
// version's stored file on `maws-artifact:`, chosen by the MIME its name types (the HTML frame, the PDF frame, native
// media, the file viewer for the rest, under the session that made it), with the version picker labelled `v1`,
// `v2 · latest`; its X32 header registration (the title, read-only, the actions, the Export menu); `onShown` once the
// content is on screen; and on an HTML page, Comment with P2's card in the viewer's own `artifact-page` host.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { artifactUrl } from '@shared/artifacts/scheme';
import type { ArtifactKind } from '@shared/artifacts/entity';
import type { ArtifactVersion } from '@shared/artifacts/version';
import type { AppSessionId } from '@shared/graph/ids';
import type { LibraryRow } from '@shared/ipc/schema/library';
import { record as sessionRecord } from '../../../../../../test/support/builders';
import { resetArtifactEditors, type ArtifactEditor } from '../../../artifacts/registry';
import { resetExportFormats } from '../../../library/export';
import { connectLibrary, resetLibrary } from '../../../library/store';
import { editorHostOf, resetEditorHosts, type EditorHostScope } from '../../../panel/editor-host';
import { openComment } from '../../../side/register';
import { openCard, useCommentCard } from '../../../side/card/store';
import { useSessions } from '../../../stores/sessions';
import { installFakeMain, ok } from '../../../test-support/code';
import { registerCommentComposer, type CommentContext } from '../../code/anchor/anchor';
import { useViewer } from '../../code/viewer/viewer-store';
import { byteViewer, type ByteViewerState } from './ByteViewer';
import { resetArtifactConsole } from './console';

const ID = '00000000-0000-4000-8000-0000000000a1';
const P = 'a1111111-1111-4111-8111-111111111111' as AppSessionId;
const SCOPE: EditorHostScope = { surface: 'panel', tabId: 'artifacts:test' };
const version = (id: number, seq: number): ArtifactVersion => ({ id, seq, at: seq, actor: { kind: 'human' }, kind: 'auto', assetRefs: [] });

let row: LibraryRow;
let versions: ArtifactVersion[];
let names: Record<number, string>; // the stored file's name by revision
let main: ReturnType<typeof installFakeMain>;
const offs: (() => void)[] = [];

function rowOf(kind: ArtifactKind, over: Partial<LibraryRow> = {}): LibraryRow {
  return {
    id: ID, kind, title: 'Dashboard', createdBy: { kind: 'session', appSessionId: P }, createdAt: 1, updatedAt: 2, lastViewedAt: null, pinned: false,
    agentEditsAsSuggestions: false, revision: 9, lastEditor: { kind: 'human' }, lastEditedAt: 2,
    sessions: [{ appSessionId: P, title: 'Fix the dashboard', roles: ['created'], lastAt: 2 }], ...over,
  };
}

// happy-dom knows no `maws-artifact:` scheme: child-frame navigation is off, so a frame only takes its URL, and the load
// it would fire on its own is held back, so a case says when a frame loads (`load`)
let loading = false;
const dispatch = HTMLIFrameElement.prototype.dispatchEvent;
beforeAll(async () => {
  (window as unknown as { happyDOM: { settings: { navigation: { disableChildFrameNavigation: boolean } } } }).happyDOM.settings.navigation.disableChildFrameNavigation = true;
  HTMLIFrameElement.prototype.dispatchEvent = function (this: HTMLIFrameElement, event: Event) {
    return event.type === 'load' && !loading ? true : dispatch.call(this, event);
  };
  await import('../../code/viewer/CodeView');
});
afterAll(() => void (HTMLIFrameElement.prototype.dispatchEvent = dispatch));

beforeEach(() => {
  resetLibrary();
  resetExportFormats();
  resetEditorHosts();
  resetArtifactEditors();
  resetArtifactConsole();
  useViewer.getState().reset();
  useCommentCard.setState({ open: null });
  useSessions.setState({ records: new Map([[P, sessionRecord(P, { directory: '/repo' })]]) });
  row = rowOf('html');
  versions = [version(1, 4), version(2, 9)];
  names = { 4: 'index.html', 9: 'index.html' };
  main = installFakeMain((name, input) => {
    if (name === 'library.get') return ok({ row });
    if (name === 'artifacts.versions') return ok({ versions });
    if (name === 'library.content') {
      const revision = (input.revision as number | undefined) ?? 9;
      return ok({ revision, kind: row.kind, name: names[revision], path: `/store/${revision}/${names[revision]}` });
    }
    if (name === 'library.exportFormats') return ok({ formats: input.kind === 'html' ? ['pdf', 'png'] : [] });
    if (name === 'files.read') return ok({ encoding: 'utf8', content: 'month,amount\n', bytes: 13, offset: 0, length: 13, truncated: false, mime: 'text/csv', hash: 'a'.repeat(64), utf8: true });
    if (name === 'files.watch' || name === 'files.unwatch') return ok();
    return new Promise(() => {});
  });
  offs.push(connectLibrary());
});

afterEach(() => {
  cleanup();
  offs.splice(0).forEach((off) => off());
});

function mount(kind: 'html' | 'file', over: { visible?: boolean } = {}) {
  const editor = byteViewer(kind) as ArtifactEditor<ByteViewerState>;
  const state = editor.createState!({ artifactId: ID, kind, surface: 'panel' });
  const onShown = vi.fn();
  const Body = editor.Panel;
  const view = render(<Body artifactId={ID} state={state} scope={SCOPE} visible={over.visible ?? true} onShown={onShown} />);
  return { onShown, view, state };
}

const frame = (kind: 'html' | 'pdf') => document.querySelector<HTMLIFrameElement>(`[data-artifact-frame="${kind}"]`);
const header = () => editorHostOf(SCOPE)!;
const actionLabels = () => header().actions!.map((a) => a.label);
const action = (label: string) => header().actions!.find((a) => a.label === label)!;
const load = (el: HTMLIFrameElement) =>
  act(() => {
    loading = true;
    el.dispatchEvent(new Event('load'));
    loading = false;
  });

describe('the HTML viewer', () => {
  it('frames the latest version on the scheme, and the picker’s v1 frames that version', async () => {
    mount('html');
    await waitFor(() => expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 9, 'index.html')));
    expect(frame('html')!.getAttribute('sandbox')).toBe('allow-scripts');
    const picker = screen.getByRole('combobox', { name: 'Version' });
    expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['v1', 'v2 · latest']);
    fireEvent.change(picker, { target: { value: '1' } });
    await waitFor(() => expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 4, 'index.html')));
    expect(main.callsOf('library.content')).toContainEqual({ artifactId: ID, revision: 4 });
  });

  it('has no picker for one version', async () => {
    versions = [version(1, 9)];
    mount('html');
    await waitFor(() => expect(frame('html')).not.toBeNull());
    expect(screen.queryByRole('combobox', { name: 'Version' })).toBeNull();
  });

  it('registers its header: the title, read-only, Comment and the actions, and the Export menu of the kind’s formats', async () => {
    mount('html');
    await waitFor(() => expect(header().exports?.map((e) => e.label)).toEqual(['PDF', 'PNG']));
    await waitFor(() => expect(actionLabels()).toEqual(['Comment', 'Reload', 'Open externally', 'Reveal in Finder']));
    expect(header()).toMatchObject({ title: 'Dashboard', saved: 'readonly' });
  });

  it('says it is shown once the page loaded, not before', async () => {
    const { onShown } = mount('html');
    await waitFor(() => expect(frame('html')).not.toBeNull());
    expect(onShown).not.toHaveBeenCalled();
    load(frame('html')!);
    expect(onShown).toHaveBeenCalled();
  });

  it('Reload mounts a new frame and reads the versions again', async () => {
    mount('html');
    await waitFor(() => expect(frame('html')).not.toBeNull());
    const first = frame('html');
    const reads = main.callsOf('artifacts.versions').length;
    act(() => action('Reload').onSelect());
    await waitFor(() => expect(frame('html')).not.toBe(first));
    expect(main.callsOf('artifacts.versions').length).toBeGreaterThan(reads);
  });

  it('Open externally and Reveal in Finder hand main the shown revision', async () => {
    mount('html');
    await waitFor(() => expect(frame('html')).not.toBeNull());
    act(() => action('Open externally').onSelect());
    act(() => action('Reveal in Finder').onSelect());
    await waitFor(() => expect(main.callsOf('library.reveal')).toEqual([{ artifactId: ID, revision: 9 }]));
    expect(main.callsOf('library.openExternally')).toEqual([{ artifactId: ID, revision: 9 }]);
  });
});

describe('Comment on an HTML page', () => {
  let opened: { anchor: unknown; context: CommentContext }[];
  let offComposer: () => void;
  beforeEach(() => {
    opened = [];
    offComposer = registerCommentComposer((anchor, context) => {
      opened.push({ anchor, context });
      openComment(anchor, context);
    });
  });
  afterEach(() => offComposer());

  const picked = { type: 'maws:picked', selector: '#hero', label: 'h1#hero', text: 'Sales overview', rect: { x: 0, y: 0, width: 10, height: 10 } };
  const post = (data: unknown, source: unknown) => act(() => void window.dispatchEvent(new MessageEvent('message', { data, source: source as MessageEventSource })));

  it('a pick opens P2’s card in this viewer, anchored to the element of the shown revision’s page, about the session that made it', async () => {
    mount('html');
    await waitFor(() => expect(frame('html')).not.toBeNull());
    act(() => action('Comment').onSelect());
    expect(action('Comment').pressed).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('Click an element to comment on it · Esc cancels');
    post(picked, frame('html')!.contentWindow);
    expect(opened).toHaveLength(1);
    expect(opened[0]!.anchor).toEqual({ kind: 'artifact-element', locator: '#hero', label: 'Dashboard v2 › h1#hero “Sales overview”', pageUrl: artifactUrl(ID, 9, 'index.html') });
    expect(opened[0]!.context).toMatchObject({ appSessionId: P, placement: { kind: 'card', host: 'artifact-page', rect: picked.rect } });
    expect(document.querySelector('[data-card-host="artifact-page"] [data-comment-card]')).not.toBeNull();
    expect(useCommentCard.getState().open?.target).toEqual({ kind: 'artifact-page', artifactId: ID, revision: 9 });
    expect(action('Comment').pressed).toBe(false); // one pick per Comment
  });

  it('Escape ends picking', async () => {
    mount('html');
    await waitFor(() => expect(frame('html')).not.toBeNull());
    act(() => action('Comment').onSelect());
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(action('Comment').pressed).toBe(false);
  });

  it('a re-docked card for this artifact is claimed by its panel viewer', async () => {
    mount('html');
    await waitFor(() => expect(frame('html')).not.toBeNull());
    const anchor = { kind: 'artifact-element' as const, locator: '#hero', label: 'Dashboard v2 › h1#hero', pageUrl: artifactUrl(ID, 9, 'index.html') };
    act(() => openCard(anchor, { appSessionId: P, claimMode: 'panel' }));
    await waitFor(() => expect(useCommentCard.getState().open?.hostId).not.toBeNull());
    expect(document.querySelector('[data-card-host="artifact-page"] [data-comment-card]')).not.toBeNull();
  });

  it('is not offered without a session to comment to', async () => {
    row = rowOf('html', { sessions: [] });
    mount('html');
    await waitFor(() => expect(frame('html')).not.toBeNull());
    await waitFor(() => expect(header().title).toBe('Dashboard'));
    expect(actionLabels()).not.toContain('Comment');
  });
});

describe('the File viewer', () => {
  beforeEach(() => {
    row = rowOf('file', { title: 'report' });
    versions = [version(1, 9)];
  });

  it('frames a PDF in the PDF frame, unsandboxed, and says it is shown once it loaded', async () => {
    names = { 9: 'report.pdf' };
    const { onShown } = mount('file');
    await waitFor(() => expect(frame('pdf')?.getAttribute('src')).toBe(artifactUrl(ID, 9, 'report.pdf')));
    expect(frame('pdf')!.hasAttribute('sandbox')).toBe(false);
    load(frame('pdf')!);
    expect(onShown).toHaveBeenCalled();
  });

  it('plays a video and an audio file in the native elements', async () => {
    names = { 9: 'clip.webm' };
    mount('file');
    await waitFor(() => expect(document.querySelector('video[data-artifact-media="video"]')?.getAttribute('src')).toBe(artifactUrl(ID, 9, 'clip.webm')));
    cleanup();
    names = { 9: 'tone.wav' };
    mount('file');
    await waitFor(() => expect(document.querySelector('audio[data-artifact-media="audio"]')?.getAttribute('src')).toBe(artifactUrl(ID, 9, 'tone.wav')));
  });

  it('draws any other file in the file viewer, read-only, under the session that made it', async () => {
    names = { 9: 'budget.csv' };
    const { onShown } = mount('file');
    await waitFor(() => expect(document.querySelector('[data-file-viewer]')?.getAttribute('data-path')).toBe('/store/9/budget.csv'));
    expect(main.callsOf('files.read')[0]).toMatchObject({ appSessionId: P, path: '/store/9/budget.csv' });
    await waitFor(() => expect(onShown).toHaveBeenCalled());
  });

  it('says where a file opens when no session made or touched it', async () => {
    names = { 9: 'budget.csv' };
    row = rowOf('file', { title: 'budget', sessions: [] });
    mount('file');
    expect(await screen.findByText('budget.csv opens outside MAWS: no session made or touched it.')).toBeTruthy();
    expect(main.callsOf('files.read')).toEqual([]);
  });

  it('has no Comment, and its Export menu saves a copy', async () => {
    names = { 9: 'report.pdf' };
    mount('file');
    await waitFor(() => expect(actionLabels()).toEqual(['Reload', 'Open externally', 'Reveal in Finder']));
    expect(header().exports?.map((e) => e.label)).toEqual(['Save a copy…']);
    act(() => header().exports![0]!.onSelect());
    await waitFor(() => expect(main.callsOf('library.saveAs')).toEqual([{ artifactId: ID, source: { content: { revision: 9 } } }]));
  });
});
