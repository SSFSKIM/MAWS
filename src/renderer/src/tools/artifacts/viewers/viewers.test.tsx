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
import type { CardFrame } from '../../../side/card/CardHost';
import { openCard, useCommentCard } from '../../../side/card/store';
import { useSessions } from '../../../stores/sessions';
import { deferred, installFakeMain, ok } from '../../../test-support/code';
import { registerCommentComposer, type CommentContext } from '../../code/anchor/anchor';
import { useViewer } from '../../code/viewer/viewer-store';
import { byteViewer, type ByteViewerState } from './ByteViewer';
import { resetArtifactConsole } from './console';
import { requestArtifactOpen, resetOpenRequests } from './requests';

// The frame the viewer last handed its card host, so a case can call what a card thread's artifact row calls
// (`showVersion`); the host itself is the real one.
const cardFrames = vi.hoisted(() => [] as CardFrame[]);
vi.mock('../../../side/card/CardHost', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../side/card/CardHost')>();
  const { createElement } = await import('react');
  const CommentCardHost: typeof actual.CommentCardHost = (props) => {
    cardFrames.push(props.frame);
    return createElement(actual.CommentCardHost, props);
  };
  return { ...actual, CommentCardHost };
});

const ID = '00000000-0000-4000-8000-0000000000a1';
const P = 'a1111111-1111-4111-8111-111111111111' as AppSessionId;
const SCOPE: EditorHostScope = { surface: 'panel', tabId: 'artifacts:test' };
const version = (id: number, seq: number): ArtifactVersion => ({ id, seq, at: seq, actor: { kind: 'human' }, kind: 'auto', assetRefs: [] });

let row: LibraryRow;
let versions: ArtifactVersion[];
let names: Record<number, string>; // the stored file's name by revision
let main: ReturnType<typeof installFakeMain>;
let versionsAnswer: (() => Promise<ReturnType<typeof ok>>) | null; // fix wave 1: a read answered when the case says
let connectorMain: ((name: string, input: Record<string, unknown>) => ReturnType<typeof ok> | null) | null = null; // P3-H H4
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
  resetOpenRequests();
  cardFrames.length = 0;
  useViewer.getState().reset();
  useCommentCard.setState({ open: null });
  useSessions.setState({ records: new Map([[P, sessionRecord(P, { directory: '/repo' })]]) });
  row = rowOf('html');
  versions = [version(1, 4), version(2, 9)];
  names = { 4: 'index.html', 9: 'index.html' };
  versionsAnswer = null;
  main = installFakeMain((name, input) => {
    const connectorAnswer = connectorMain?.(name, input); // P3-H H4: a connectors case's own answers
    if (connectorAnswer) return connectorAnswer;
    if (name === 'library.get') return ok({ row });
    if (name === 'artifacts.versions') return versionsAnswer ? versionsAnswer() : ok({ versions });
    if (name === 'library.content') {
      const revision = (input.revision as number | undefined) ?? 9;
      return ok({ revision, kind: row.kind, name: names[revision], path: `/store/${revision}/${names[revision]}` });
    }
    if (name === 'library.exportFormats') return ok({ formats: input.kind === 'html' ? ['pdf', 'png'] : [] });
    if (name === 'files.read') return ok({ encoding: 'utf8', content: 'month,amount\n', bytes: 13, offset: 0, length: 13, truncated: false, mime: 'text/csv', hash: 'a'.repeat(64), utf8: true });
    if (name === 'library.read') return ok({ encoding: 'utf8', content: 'month,amount\n', bytes: 13, offset: 0, length: 13, truncated: false, mime: 'text/csv', hash: 'a'.repeat(64), utf8: true }); // M6b fix wave 2
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
    await waitFor(() => expect(actionLabels()).toEqual(['Comment', 'Reload', 'Open externally', 'Reveal in Finder', 'Send to…' /* P4-B5 */]));
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
    await waitFor(() => expect(main.callsOf('artifacts.export')).toEqual([{ artifactId: ID, format: 'pdf', versionId: 1, ownFile: true }]));
  });

  // whole-branch review: a revision asked for is exported as that version even while it is the latest, so a publish
  // between the read and the export never exports the newer one; only the latest followed exports live
  it('exports a revision asked for by its version id though it is the latest, and the followed latest live', async () => {
    requestArtifactOpen(ID, { revision: 9 }, 'panel');
    const first = mount('html');
    await waitFor(() => expect(header().exports?.find((e) => e.label === 'PDF')?.disabled).toBe(false));
    act(() => header().exports!.find((e) => e.label === 'PDF')!.onSelect());
    await waitFor(() => expect(main.callsOf('artifacts.export')).toEqual([{ artifactId: ID, format: 'pdf', versionId: 2, ownFile: true }]));
    first.view.unmount();

    mount('html');
    await waitFor(() => expect(header().exports?.find((e) => e.label === 'PDF')?.disabled).toBe(false));
    act(() => header().exports!.find((e) => e.label === 'PDF')!.onSelect());
    await waitFor(() => expect(main.callsOf('artifacts.export')).toHaveLength(2));
    expect(main.callsOf('artifacts.export')[1]).toEqual({ artifactId: ID, format: 'pdf', ownFile: true }); // P4 (W1, L302): a file of its own
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
    requestArtifactOpen(ID, { version: 2 }, 'panel');
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
    act(() => void requestArtifactOpen(ID, { version: 1 }, 'main'));
    act(() => void requestArtifactOpen('00000000-0000-4000-8000-0000000000ff', { version: 1 }, 'panel'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 14, 'index.html'));
    act(() => void requestArtifactOpen(ID, { version: 1 }, 'panel'));
    await waitFor(() => expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 4, 'index.html')));
    act(() => void requestArtifactOpen(ID, { version: 3 }, 'panel'));
    await waitFor(() => expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 14, 'index.html')));
    expect(document.querySelector('[data-artifact-viewer]')?.getAttribute('data-version')).toBe('3');
  });

  // M6b fix wave 1 (Decision Log 39c): an imported page's number is X12's, kept on the version at import, never its place
  it('shows X12’s version n of an imported page where the history before it thinned', async () => {
    versions = [{ ...version(1, 4), kind: 'import', label: 'v1' }, { ...version(3, 14), kind: 'import', label: 'v3' }, version(4, 20)]; // v2 gone
    names = { 4: 'index.html', 14: 'index.html', 20: 'index.html' };
    requestArtifactOpen(ID, { version: 3 }, 'panel');
    mount('html');
    await waitFor(() => expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 14, 'index.html')));
  });

  // M6b fix wave 2: a row of a call whose answer named its revision opens that revision, wherever thinning moved its
  // place; a revision thinning dropped is stood for by the next kept version
  it('shows the version that captured a revision, the next kept one when thinning dropped it', async () => {
    requestArtifactOpen(ID, { revision: 4 }, 'panel');
    mount('html');
    await waitFor(() => expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 4, 'index.html')));
    act(() => void requestArtifactOpen(ID, { revision: 5 }, 'panel')); // revision 5's version thinned: 9 kept after it
    await waitFor(() => expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 9, 'index.html')));
    act(() => void requestArtifactOpen(ID, { revision: 14 }, 'panel'));
    await waitFor(() => expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 14, 'index.html')));
  });

  // P4-B4: a link's `#v<id>` (a location's version) names a retained version by its id, over the version the open asked
  // (a link asks the latest); an id the page does not retain shows the latest; a location without one, the version asked
  it('shows the retained version a link names by its id, the latest for an id not retained', async () => {
    requestArtifactOpen(ID, 'latest', 'panel', { version: 1 }); // version 1 captured revision 4
    mount('html');
    await waitFor(() => expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 4, 'index.html')));
    act(() => void requestArtifactOpen(ID, { revision: 9 }, 'panel', { version: 42 })); // not retained: the latest
    await waitFor(() => expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 14, 'index.html')));
    act(() => void requestArtifactOpen(ID, { revision: 9 }, 'panel', { block: 'b1' })); // no version in the place
    await waitFor(() => expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 9, 'index.html')));
    act(() => void requestArtifactOpen(ID, 'latest', 'panel', { version: 3 })); // the latest now, kept by its revision
    await waitFor(() => expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 14, 'index.html')));
  });

  // M6b fix wave 3: the identity asked for (a revision, or the latest) is what the tab keeps, its place derived from each
  // versions read: a version before it thinned away, a Reload and a refresh of the row still show that revision; the
  // picker's own choice is an identity too
  it('keeps showing a revision asked for after an earlier version thins, across a Reload and a refresh', async () => {
    requestArtifactOpen(ID, { revision: 9 }, 'panel');
    mount('html');
    await waitFor(() => expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 9, 'index.html')));
    versions = [version(2, 9), version(3, 14)]; // revision 4's version thinned: 9 is now the first place
    act(() => header().actions!.find((a) => a.id === 'reload')!.onSelect());
    await waitFor(() => expect(main.callsOf('artifacts.versions').length).toBeGreaterThan(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 9, 'index.html'));
    const reads = main.callsOf('artifacts.versions').length;
    row = { ...row, revision: 15 }; // the row moves on: its versions read again
    await act(async () => main.emit('library.changed', { revision: 2 }));
    await waitFor(() => expect(main.callsOf('artifacts.versions').length).toBeGreaterThan(reads));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 9, 'index.html'));
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Version' }).value).toBe('1');
  });

  // review scalpel-1#1: a publish moves the row, which reads the versions again; until that read answers, the versions
  // read before stand, so the version shown keeps its frame (no fresh load, no second `onShown`) and an Open from a card
  // thread's artifact row meanwhile lands
  describe('while a publish reads the versions again', () => {
    async function shownAt9() {
      requestArtifactOpen(ID, { revision: 9 }, 'panel');
      const mounted = mount('html');
      await waitFor(() => expect(main.callsOf('artifacts.versions')).toHaveLength(2)); // before the row is read, and after
      await waitFor(() => expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 9, 'index.html')));
      const reread = deferred<ReturnType<typeof ok>>();
      const publish = async () => {
        versionsAnswer = () => reread.promise;
        row = { ...row, revision: 20 };
        await act(async () => main.emit('library.changed', { revision: 2 }));
        await waitFor(() => expect(main.callsOf('artifacts.versions')).toHaveLength(3));
      };
      const answer = async () => {
        versions = [...versions, version(4, 20)];
        names[20] = 'index.html';
        await act(async () => reread.resolve(ok({ versions })));
        await new Promise((resolve) => setTimeout(resolve, 20));
      };
      return { ...mounted, publish, answer };
    }

    it('keeps the pinned version’s iframe, the same element throughout, said shown once', async () => {
      const { onShown, publish, answer } = await shownAt9();
      const shown = frame('html')!;
      load(shown);
      expect(onShown).toHaveBeenCalledTimes(1);
      await publish();
      expect(frame('html'), 'the frame stays while the versions are read').toBe(shown);
      await answer();
      expect(frame('html'), 'and once they are').toBe(shown);
      expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Version' }).value).toBe('2');
      expect(onShown).toHaveBeenCalledTimes(1);
    });

    it('lands a card row’s Open asked meanwhile', async () => {
      const { publish, answer } = await shownAt9();
      await publish();
      act(() => cardFrames.at(-1)!.showVersion!({ revision: 4 }));
      await answer();
      await waitFor(() => expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 4, 'index.html')));
    });

    // the review of 1586d7eeb: while the frame shows the version read before, the latest followed exports that version,
    // as Reveal, Open externally and Save a copy take its revision; once the new versions land it exports live again
    it('exports the followed latest as the version shown until the re-read lands, then live', async () => {
      row = { ...row, revision: 14 }; // the latest, v3, live
      mount('html');
      await waitFor(() => expect(main.callsOf('artifacts.versions')).toHaveLength(2));
      await waitFor(() => expect(header().exports?.find((e) => e.label === 'PDF')?.disabled).toBe(false));
      const reread = deferred<ReturnType<typeof ok>>();
      versionsAnswer = () => reread.promise;
      row = { ...row, revision: 20 };
      await act(async () => main.emit('library.changed', { revision: 2 }));
      await waitFor(() => expect(main.callsOf('artifacts.versions')).toHaveLength(3));
      expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 14, 'index.html'));
      act(() => header().exports!.find((e) => e.label === 'PDF')!.onSelect());
      await waitFor(() => expect(main.callsOf('artifacts.export')).toEqual([{ artifactId: ID, format: 'pdf', versionId: 3, ownFile: true }]));

      versions = [...versions, version(4, 20)];
      names[20] = 'index.html';
      await act(async () => reread.resolve(ok({ versions })));
      await waitFor(() => expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 20, 'index.html')));
      await waitFor(() => expect(header().exports?.find((e) => e.label === 'PDF')?.disabled).toBe(false));
      act(() => header().exports!.find((e) => e.label === 'PDF')!.onSelect());
      await waitFor(() => expect(main.callsOf('artifacts.export')).toHaveLength(2));
      expect(main.callsOf('artifacts.export')[1]).toEqual({ artifactId: ID, format: 'pdf', ownFile: true }); // P4 (W1, L302): a file of its own
    });
  });

  it('keeps the picker’s choice by its revision when an earlier version thins', async () => {
    mount('html');
    await waitFor(() => expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 14, 'index.html')));
    fireEvent.change(screen.getByRole('combobox', { name: 'Version' }), { target: { value: '2' } }); // revision 9
    await waitFor(() => expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 9, 'index.html')));
    versions = [version(2, 9), version(3, 14)];
    act(() => header().actions!.find((a) => a.id === 'reload')!.onSelect());
    await waitFor(() => expect(main.callsOf('artifacts.versions').length).toBeGreaterThan(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 9, 'index.html'));
  });

  // M6b fix wave 2: no wall-clock lapse. A request waits for a versions read however slow; a later open supersedes it,
  // a version-less one asking for the latest
  it('takes a request after a slow versions read, and a later open asking for the latest supersedes an earlier one', async () => {
    const slow = deferred<ReturnType<typeof ok>>();
    versionsAnswer = () => slow.promise;
    requestArtifactOpen(ID, { version: 1 }, 'panel');
    mount('html');
    await new Promise((resolve) => setTimeout(resolve, 30));
    const later = Date.now() + 60_000; // the read answers a minute later
    const clock = vi.spyOn(Date, 'now').mockReturnValue(later);
    slow.resolve(ok({ versions }));
    await waitFor(() => expect(frame('html')?.getAttribute('src')).toBe(artifactUrl(ID, 4, 'index.html')));
    clock.mockRestore();
    cleanup();
    versionsAnswer = null;
    requestArtifactOpen(ID, { version: 1 }, 'panel');
    requestArtifactOpen(ID, 'latest', 'panel'); // the next open, naming no version
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
    // the viewer draws its path at once; the store reads only once the session's watch is ready (viewer-store.ts's
    // watch-then-read), so the read is awaited as its own event rather than assumed done with the first render
    await waitFor(() => expect(main.callsOf('files.read')[0]).toMatchObject({ appSessionId: P, path: '/store/9/budget.csv' }));
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

  // M6b (Decision Log 36i; fix wave 2): a File artifact no session made (the owner's "Add a file…"), or one whose session
  // this window does not know, reads by the artifact alone: main resolves its path (`library.read`), with no session at all
  it('reads a file no session made by the artifact alone, with an empty session store, drawing its content', async () => {
    names = { 9: 'budget.csv' };
    row = rowOf('file', { title: 'budget', sessions: [] });
    useSessions.setState({ records: new Map() });
    const { onShown } = mount('file');
    await waitFor(() => expect(document.querySelector('[data-file-viewer]')?.textContent).toContain('month,amount'));
    expect(main.callsOf('library.read')[0]).toMatchObject({ artifactId: ID, revision: 9, offset: 0 });
    expect(main.callsOf('files.read')).toEqual([]);
    expect(main.callsOf('files.watch')).toEqual([]);
    await waitFor(() => expect(onShown).toHaveBeenCalled());
    cleanup();
    useViewer.getState().reset();
    row = rowOf('file', { title: 'budget' }); // its session, which this window does not know
    mount('file');
    await waitFor(() => expect(main.callsOf('library.read')).toHaveLength(2));
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

// P3-H H4: an HTML page's connectors. Each load of the page gets its own lease on the viewer's artifact, hidden until the
// body is on screen and the window's document visible, closed at the next load; the header's Connectors action appears
// once the page declares a tool, and opens the owner's sheet, whose Allow grants through main.
describe('an HTML page’s connectors', () => {
  const LEASES = ['c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002'];
  const TOOL = { server: 'fixture', tool: 'read_series' };
  let opens: number;
  beforeEach(() => {
    opens = 0;
    connectorMain = (name, input) => {
      if (name === 'connectors.open') {
        const leaseId = LEASES[opens];
        opens += 1;
        return ok({ leaseId });
      }
      if (name === 'connectors.visibility') return ok({ ok: true });
      if (name === 'connectors.close') return ok({ closed: true });
      if (name === 'connectors.declare') return ok({ ok: true, declared: input.tools });
      if (name === 'artifacts.connectorGrants') return ok({ grants: [] });
      if (name === 'artifacts.grantConnectorTool') return ok({ ok: true, grant: { ...TOOL, fingerprint: 'f1', mode: 'read', grantedAt: 1 } });
      return null;
    };
  });
  afterEach(() => {
    connectorMain = null;
    Reflect.deleteProperty(document, 'visibilityState');
  });

  // the page's end of each load's port, as the frame hands it over
  function pagePorts(el: HTMLIFrameElement) {
    const ports: MessagePort[] = [];
    el.contentWindow!.postMessage = ((data: unknown, _origin: string, transfer: MessagePort[] = []) => {
      if ((data as { type?: string }).type === 'maws:connectors') ports.push(transfer[0]!);
    }) as typeof window.postMessage;
    return ports;
  }
  const visibilities = (leaseId: string) => main.callsOf('connectors.visibility').filter((call) => call.leaseId === leaseId).map((call) => call.visible);

  it('gives each load its own lease on the artifact, shown only while the body and the window are, the last load’s closed', async () => {
    const { show } = mount('html');
    await waitFor(() => expect(frame('html')).not.toBeNull());
    pagePorts(frame('html')!);
    load(frame('html')!);
    await waitFor(() => expect(visibilities(LEASES[0]!)).toEqual([true]));
    expect(main.callsOf('connectors.open')).toEqual([{ artifactId: ID }]);
    show(false);
    await waitFor(() => expect(visibilities(LEASES[0]!)).toEqual([true, false]));
    show(true);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(visibilities(LEASES[0]!)).toEqual([true, false, true, false]));
    load(frame('html')!); // the page reloaded itself
    await waitFor(() => expect(main.callsOf('connectors.close')).toEqual([{ leaseId: LEASES[0] }]));
    await waitFor(() => expect(main.callsOf('connectors.open')).toHaveLength(2));
    expect(visibilities(LEASES[1]!)).toEqual([]); // the window is hidden: the new lease stays hidden
  });

  it('offers Connectors once the page declares a tool, never opening it by itself, and grants on the owner’s Allow', async () => {
    mount('html');
    await waitFor(() => expect(frame('html')).not.toBeNull());
    const ports = pagePorts(frame('html')!);
    load(frame('html')!);
    await waitFor(() => expect(actionLabels()).toEqual(['Comment', 'Reload', 'Open externally', 'Reveal in Finder', 'Send to…' /* P4-B5 */]));
    const answers: unknown[] = [];
    ports[0]!.onmessage = (event) => void answers.push(event.data);
    ports[0]!.postMessage({ id: 1, op: 'declare', tools: [TOOL] });
    await waitFor(() => expect(answers).toEqual([{ id: 1, answer: { ok: true, declared: [TOOL] } }]));
    await waitFor(() => expect(actionLabels()).toEqual(['Comment', 'Connectors', 'Reload', 'Open externally', 'Reveal in Finder', 'Send to…' /* P4-B5 */]));
    expect(document.querySelector('[data-connectors-sheet]')).toBeNull();
    act(() => action('Connectors').onSelect());
    const sheet = await waitFor(() => document.querySelector<HTMLElement>('[data-connectors-sheet]')!);
    expect(within(sheet).getByText('Not allowed')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Allow fixture · read_series to read' }));
    await waitFor(() => expect(main.callsOf('artifacts.grantConnectorTool')).toEqual([{ artifactId: ID, tool: { ...TOOL, mode: 'read' } }]));
    ports[0]!.close();
  });
});
