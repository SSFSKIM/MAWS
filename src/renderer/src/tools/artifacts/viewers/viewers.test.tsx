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
import { deferred, installFakeMain, ok } from '../../../test-support/code';
import { registerCommentComposer, type CommentContext } from '../../code/anchor/anchor';
import { useViewer } from '../../code/viewer/viewer-store';
import { byteViewer, type ByteViewerState } from './ByteViewer';
import { resetArtifactConsole } from './console';
import { requestArtifactVersion, resetVersionRequests } from './requests';

const ID = '00000000-0000-4000-8000-0000000000a1';
const P = 'a1111111-1111-4111-8111-111111111111' as AppSessionId;
const SCOPE: EditorHostScope = { surface: 'panel', tabId: 'artifacts:test' };
const version = (id: number, seq: number): ArtifactVersion => ({ id, seq, at: seq, actor: { kind: 'human' }, kind: 'auto', assetRefs: [] });

let row: LibraryRow;
let versions: ArtifactVersion[];
let names: Record<number, string>; // the stored file's name by revision
let main: ReturnType<typeof installFakeMain>;
let versionsAnswer: (() => Promise<ReturnType<typeof ok>>) | null; // fix wave 1: a read answered when the case says
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
  resetVersionRequests();
  useViewer.getState().reset();
  useCommentCard.setState({ open: null });
  useSessions.setState({ records: new Map([[P, sessionRecord(P, { directory: '/repo' })]]) });
  row = rowOf('html');
  versions = [version(1, 4), version(2, 9)];
  names = { 4: 'index.html', 9: 'index.html' };
  versionsAnswer = null;
  main = installFakeMain((name, input) => {
    if (name === 'library.get') return ok({ row });
    if (name === 'artifacts.versions') return versionsAnswer ? versionsAnswer() : ok({ versions });
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
  const draw = (visible: boolean) => <Body artifactId={ID} state={state} scope={SCOPE} visible={visible} onShown={onShown} />;
  const view = render(draw(over.visible ?? true));
  return { onShown, view, state, show: (visible: boolean) => view.rerender(draw(visible)) };
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

  // fix wave 1 (Decision Log 15, 23): content that loaded while hidden is not a view until it shows
  it('says nothing for a page that loaded while hidden, and says it once the page shows', async () => {
    const { onShown, show } = mount('html', { visible: false });
    await waitFor(() => expect(frame('html')).not.toBeNull());
    load(frame('html')!);
    expect(onShown).not.toHaveBeenCalled();
    show(true);
    expect(onShown).toHaveBeenCalled();
  });

  // fix wave 2: readiness belongs to the frame that loaded; a frame mounted again under the same key is not ready until
  // its own load
  it('a page loaded hidden, then switched away and back, is not shown until the new frame loads', async () => {
    const { onShown, show } = mount('html', { visible: false });
    await waitFor(() => expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 9, 'index.html')));
    load(frame('html')!);
    fireEvent.change(screen.getByRole('combobox', { name: 'Version' }), { target: { value: '1' } });
    await waitFor(() => expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 4, 'index.html')));
    fireEvent.change(screen.getByRole('combobox', { name: 'Version' }), { target: { value: '2' } });
    await waitFor(() => expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 9, 'index.html')));
    show(true);
    expect(onShown).not.toHaveBeenCalled();
    load(frame('html')!);
    expect(onShown).toHaveBeenCalled();
  });

  // fix wave 1: an export or a copy takes the shown selection only once it is resolved, never the live revision instead
  it('disables Export while a Reload reads the versions again, and then exports the chosen version, never the live one', async () => {
    mount('html');
    await waitFor(() => expect(frame('html')).not.toBeNull());
    fireEvent.change(screen.getByRole('combobox', { name: 'Version' }), { target: { value: '1' } });
    await waitFor(() => expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 4, 'index.html')));
    const pending = deferred<ReturnType<typeof ok>>();
    versionsAnswer = () => pending.promise;
    act(() => action('Reload').onSelect());
    await waitFor(() => expect(header().exports?.every((e) => e.disabled)).toBe(true));
    act(() => header().exports!.find((e) => e.label === 'PDF')!.onSelect()); // a disabled entry does nothing
    expect(main.callsOf('artifacts.export')).toEqual([]);
    await act(async () => pending.resolve(ok({ versions })));
    await waitFor(() => expect(header().exports?.find((e) => e.label === 'PDF')?.disabled).toBe(false));
    act(() => header().exports!.find((e) => e.label === 'PDF')!.onSelect());
    await waitFor(() => expect(main.callsOf('artifacts.export')).toEqual([{ artifactId: ID, format: 'pdf', versionId: 1 }]));
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

// M6b: a transcript row's Open names the n-th of the artifact's versions by its place (E2's record version until the
// cutover; Decision Log 4): the viewer on the asked surface shows the version at that place in the order of the
// revisions (`listVersions(id)[n - 1]`), never revision n, whether it mounts now or already shows the artifact
describe('a version asked for from outside', () => {
  beforeEach(() => {
    versions = [version(3, 14), version(1, 4), version(2, 9)]; // answered out of order: the place is by revision
    names = { 4: 'index.html', 9: 'index.html', 14: 'index.html' };
  });

  it('shows the n-th version by revision when it mounts, never revision n, and takes the request once', async () => {
    requestArtifactVersion(ID, 2, 'panel');
    mount('html');
    await waitFor(() => expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 9, 'index.html')));
    expect(main.callsOf('library.content')).not.toContainEqual({ artifactId: ID, revision: 2 });
    cleanup();
    mount('html'); // a later mount: the request was taken, the latest shows
    await waitFor(() => expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 14, 'index.html')));
  });

  it('moves a viewer already showing the artifact, follows the latest for the last place, and leaves another surface’s or artifact’s alone', async () => {
    mount('html');
    await waitFor(() => expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 14, 'index.html')));
    act(() => requestArtifactVersion(ID, 1, 'main'));
    act(() => requestArtifactVersion('00000000-0000-4000-8000-0000000000ff', 1, 'panel'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 14, 'index.html'));
    act(() => requestArtifactVersion(ID, 1, 'panel'));
    await waitFor(() => expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 4, 'index.html')));
    act(() => requestArtifactVersion(ID, 3, 'panel'));
    await waitFor(() => expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 14, 'index.html')));
    expect(document.querySelector('[data-artifact-viewer]')?.getAttribute('data-version')).toBe('3');
  });

  // M6b fix wave 1 (Decision Log 39c): an imported page's number is X12's, kept on the version at import, never its place
  it('shows X12’s version n of an imported page where the history before it thinned', async () => {
    versions = [{ ...version(1, 4), kind: 'import', label: 'v1' }, { ...version(3, 14), kind: 'import', label: 'v3' }, version(4, 20)]; // v2 gone
    names = { 4: 'index.html', 14: 'index.html', 20: 'index.html' };
    requestArtifactVersion(ID, 3, 'panel');
    mount('html');
    await waitFor(() => expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 14, 'index.html')));
  });

  it('lets a request lapse after REQUEST_LAPSE_MS', async () => {
    requestArtifactVersion(ID, 1, 'panel', Date.now() - 6_000);
    mount('html');
    await waitFor(() => expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 14, 'index.html')));
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

  // fix wave 1: picking belongs to the frame it was asked of; another frame, even under the same key again, is not picking
  it('a version round trip and a remount end picking rather than resume it', async () => {
    const { state, view } = mount('html');
    await waitFor(() => expect(frame('html')).not.toBeNull());
    act(() => action('Comment').onSelect());
    const picker = screen.getByRole('combobox', { name: 'Version' });
    fireEvent.change(picker, { target: { value: '1' } });
    await waitFor(() => expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 4, 'index.html')));
    fireEvent.change(screen.getByRole('combobox', { name: 'Version' }), { target: { value: '2' } });
    await waitFor(() => expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 9, 'index.html')));
    expect(action('Comment').pressed).toBe(false);
    expect(screen.queryByRole('status')).toBeNull();

    act(() => action('Comment').onSelect());
    expect(action('Comment').pressed).toBe(true);
    view.unmount(); // the tab goes inactive: its body unmounts, the registration stays
    expect(state.view.getState().pickingIn).toBeNull();
    const Body = byteViewer('html').Panel;
    render(<Body artifactId={ID} state={state} scope={SCOPE} visible onShown={() => {}} />);
    await waitFor(() => expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 9, 'index.html')));
    expect(action('Comment').pressed).toBe(false);
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

  it('a file read while hidden counts as shown only once it shows', async () => {
    names = { 9: 'budget.csv' };
    const { onShown, show } = mount('file', { visible: false });
    await waitFor(() => expect(useViewer.getState().entries.get(`artifact:${ID}:9`)?.status).toBe('ready'));
    expect(onShown).not.toHaveBeenCalled();
    show(true);
    expect(onShown).toHaveBeenCalled();
  });

  // M6b (Decision Log 36i): a File artifact no session made (the owner's "Add a file…") is read under a session the
  // window knows, which the library's index admits it for; with none open it says so
  it('reads a file no session made under a session the window knows, and says so when it knows none', async () => {
    names = { 9: 'budget.csv' };
    row = rowOf('file', { title: 'budget', sessions: [] });
    mount('file');
    await waitFor(() => expect(main.callsOf('files.read')[0]).toMatchObject({ appSessionId: P, path: '/store/9/budget.csv' }));
    cleanup();
    useViewer.getState().reset();
    useSessions.setState({ records: new Map() });
    const reads = main.callsOf('files.read').length;
    mount('file');
    expect(await screen.findByText('budget.csv is read through a session, and none is open: open a session to see it here.')).toBeTruthy();
    expect(main.callsOf('files.read')).toHaveLength(reads);
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
