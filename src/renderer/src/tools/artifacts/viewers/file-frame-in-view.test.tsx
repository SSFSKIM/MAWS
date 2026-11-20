// A File artifact whose stored file the file viewer draws as a framed file (UX wave U6b-2,
// docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md, "What a frame keeps and loses", the row "A hide";
// Decision Log 29 and 35): the artifact viewer routes by the stored file's name, the file viewer by the type main reads,
// so a name that types as no frame (here `.bin`) over bytes main types as a PDF reaches `FrameBody` through `ByteViewer`.
// While its host says it is not on screen (`visible` false: the panel collapsed, a page over it, the panel over an artifact
// main tab) or while it is in the main area and the main area is not on screen (the side column a sheet over a narrow
// window), its frame element is not in the document; shown again it is a new element from the same token. Every id, path
// and byte here is invented.
import { TEST_MACHINE } from '../../../../../../test/support/machine';
import { cleanup, render, waitFor, act } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ArtifactVersion } from '@shared/artifacts/version';
import { frameUrl } from '@shared/files/framed';
import type { AppSessionId } from '@shared/graph/ids';
import type { LibraryRow } from '@shared/ipc/schema/library';
import { record as sessionRecord } from '../../../../../../test/support/builders';
import { at } from '../../../../../../test/support/machine';
import { resetArtifactEditors, type ArtifactEditor } from '../../../artifacts/registry';
import { resetExportFormats } from '../../../library/export';
import { connectLibrary, resetLibrary } from '../../../library/store';
import { resetEditorHosts, type EditorHostScope } from '../../../panel/editor-host';
import { useLayout } from '../../../stores/layout';
import { useSessions } from '../../../stores/sessions';
import { installFakeMain, ok } from '../../../test-support/code';
import { frameToken } from '../../../test-support/code-disk';
import { ref, resetPanelStores } from '../../../test-support/panel';
import { useViewer } from '../../code/viewer/viewer-store';
import { byteViewer, type ByteViewerState } from './ByteViewer';

const ID = '00000000-0000-4000-8000-0000000000b2';
const P = 'b2222222-2222-4222-8222-222222222222' as AppSessionId; // main's id
const PAGE_P = at(P);
const PATH = '/store/9/ledger.bin';
const BYTES = Buffer.from('%PDF-1.4 invented\n');
const version: ArtifactVersion = { id: 1, seq: 9, at: 9, actor: { kind: 'human' }, kind: 'auto', assetRefs: [] };
const row: LibraryRow = {
  id: ID, kind: 'file', title: 'ledger', createdBy: { kind: 'session', appSessionId: P }, createdAt: 1, updatedAt: 2, lastViewedAt: null, pinned: false,
  agentEditsAsSuggestions: false, revision: 9, lastEditor: { kind: 'human' }, lastEditedAt: 2, sessions: [{ appSessionId: P, title: 'Ledger', roles: ['created'], lastAt: 2 }],
};
// happy-dom's window, resized as a person resizes the app's (it dispatches `resize`)
const setWindowWidth = (width: number) => (window as unknown as { happyDOM: { setWindowSize(size: { width: number }): void } }).happyDOM.setWindowSize({ width });

beforeAll(() => void ((window as unknown as { happyDOM: { settings: { navigation: { disableChildFrameNavigation: boolean } } } }).happyDOM.settings.navigation.disableChildFrameNavigation = true));
const offs: (() => void)[] = [];
let issued = 0;
beforeEach(() => {
  setWindowWidth(1440);
  resetPanelStores(); // the layout as a window has it: A's chat in front, nothing beside it
  resetLibrary();
  resetExportFormats();
  resetEditorHosts();
  resetArtifactEditors();
  useViewer.getState().reset();
  useSessions.setState({ records: new Map([[PAGE_P, sessionRecord(PAGE_P, { directory: '/store' })]]) });
  issued = 0;
  installFakeMain((name) => {
    if (name === 'library.get') return ok({ row });
    if (name === 'artifacts.versions') return ok({ versions: [version] });
    if (name === 'library.content') return ok({ revision: 9, kind: 'file', name: 'ledger.bin', path: PATH });
    if (name === 'library.exportFormats') return ok({ formats: [] });
    if (name === 'files.watch' || name === 'files.unwatch') return ok();
    if (name === 'files.read') return ok({ encoding: 'base64', content: BYTES.toString('base64'), bytes: BYTES.length, offset: 0, length: BYTES.length, truncated: false, mime: 'application/pdf', hash: null, utf8: null });
    if (name === 'layout.frameFile') {
      const token = frameToken(++issued);
      return ok({ status: 'ready', token, url: frameUrl(token, 'ledger.bin'), framed: 'pdf' });
    }
    if (name === 'layout.releaseFrame') return ok();
    return new Promise(() => {});
  });
  offs.push(connectLibrary());
});
afterEach(() => {
  cleanup();
  offs.splice(0).forEach((off) => off());
});

function mount(scope: EditorHostScope, visible: boolean) {
  const editor = byteViewer('file') as ArtifactEditor<ByteViewerState>;
  const state = editor.createState!({ artifactId: ID, machine: TEST_MACHINE, kind: 'file', surface: scope.surface === 'main' ? 'main' : 'panel' });
  const Body = editor.Panel;
  const draw = (shown: boolean) => <Body artifactId={ID} machine={TEST_MACHINE} state={state} scope={scope} visible={shown} onShown={() => {}} />;
  const view = render(draw(visible));
  return (shown: boolean) => view.rerender(draw(shown));
}
const frame = () => document.querySelector('iframe');
const drawn = async () => {
  await waitFor(() => expect(frame()?.getAttribute('src')).toBe(`${frameUrl(frameToken(1), 'ledger.bin')}#navpanes=0`));
  return frame()!;
};

describe('a File artifact drawn as a framed file while it is not on screen', () => {
  it('while its host says it is not visible, no frame element; shown again, a new element from the same token', async () => {
    const show = mount({ surface: 'panel', tabId: 'artifacts:test' }, true);
    const first = await drawn();
    show(false);
    expect(frame()).toBeNull();
    show(true);
    const again = await drawn();
    expect(again).not.toBe(first);
    expect(issued).toBe(1);
  });

  it('in the main area while the side column is a sheet over a narrow window, no frame element; shown again, a new element', async () => {
    // a side surface beside A's chat, so a narrow window draws the side column as a sheet over the main area
    const [a] = useLayout.getState().main.panes[0]!.tabs;
    const appSessionId = (a as { appSessionId: AppSessionId }).appSessionId;
    useLayout.setState({ panelBySession: new Map([[appSessionId, { tabs: [ref('background:aaaaaaaa')], activeTabId: 'background:aaaaaaaa' }]]) });
    mount({ surface: 'main', tabId: `artifact:${ID}` }, true);
    const first = await drawn();
    act(() => setWindowWidth(600));
    expect(frame()).toBeNull();
    act(() => setWindowWidth(1440));
    const again = await drawn();
    expect(again).not.toBe(first);
    expect(issued).toBe(1);
  });
});
