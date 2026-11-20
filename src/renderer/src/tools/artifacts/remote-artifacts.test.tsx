// The Artifacts tool in a remote session's pane (P5 O7 M5a, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M5,
// "At its end" and "Which machine an artifact is on"): the session's list is read on its machine (by its address), All
// lists that machine's library, and an artifact opened from it is that machine's: every read the record view makes goes
// there, and the tab keeps the machine beside the artifact, so a restored tab reads there before any list is read. A
// transcript row's Open from a remote session opens the artifact on the session's machine; the library's Open a main tab
// on the artifact's machine.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { useEffect, type ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MemoryDocumentHost } from '@artifacts/document/editor/memory-host';
import type { PortLike } from '@artifacts/provider/port';
import { createDocument, tabBody } from '@artifacts/document/tabs';
import type { AppSessionId } from '@shared/graph/ids';
import type { LibraryFilter, LibraryRow } from '@shared/ipc/schema/library';
import { addressOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../../test/support/machine';
import { artifactClient } from '../../artifacts/machine-client';
import { createArtifactHost } from '../../artifacts/host';
import { artifactMachineOf, recordArtifactMachine, resetArtifactMachines } from '../../artifacts/machines';
import { TranscriptLink } from '../../transcript/view/markdown/Link';
import { NO_ACTIONS, setHostActions, TranscriptProvider, useTranscriptContext } from '../../transcript/view/context';
import { MarkdownView } from '../code/viewer/MarkdownView';
import { registerArtifactEditor, releaseArtifactEditorState, resetArtifactEditors, type ArtifactEditorProps } from '../../artifacts/registry';
import { connectArtifactTabMachines } from '../../artifacts/tab-machines';
import { ArtifactTab } from '../../library/ArtifactTab';
import { openArtifactTab } from '../../library/actions';
import { connectLibrary, resetLibrary } from '../../library/store';
import { resetLibraryView, useLibraryView } from '../../library/view';
import { editorHostOf } from '../../panel/editor-host';
import { panelHost, registerPanelTool } from '../../panel/host';
import type { PanelToolContext } from '../../panel/tool';
import { useLayout } from '../../stores/layout';
import { allTabs } from '../../stores/layout-model';
import { fail, installFakeMain, ok } from '../../test-support/code';
import { resetPanelStores } from '../../test-support/panel';
import { artifactRow, countsOf, libraryRow } from '../../test-support/remote-artifacts';
import { ipc } from '../../ipc/client';
import { registerDocumentEditor } from '../document';
import { artifactsTool, openArtifactInPanel, type ArtifactsHandle, type ArtifactsParams } from './ArtifactsTool';

const R = addressOf(OTHER_MACHINE, 'app-r') as AppSessionId; // a session on another machine
const MAIN_R = 'app-r';
const DECK = libraryRow(1, { title: 'Studio deck', sessions: [{ appSessionId: MAIN_R as AppSessionId, title: 'Studio work', roles: ['created'], lastAt: Date.now() }] });
const LOOSE = libraryRow(2, { title: 'Studio notes' }); // in the studio's library, linked to no session

let calls: { name: string; input: Record<string, unknown>; machine: MachineRef }[];
const sent = (name: string) => calls.filter((call) => call.name === name);
const offs: (() => void)[] = [];

const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: (function (this: HTMLElement) { return this.hasAttribute('data-artifacts-list') ? 4000 : this.hasAttribute('data-index') ? 48 : 0; }) });
});
afterAll(() => Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight));

beforeEach(() => {
  resetPanelStores();
  resetArtifactEditors();
  resetLibrary();
  resetArtifactMachines();
  resetLibraryView();
  calls = [];
  // main: the studio's library holds both artifacts; this Mac's holds none
  installFakeMain((name, input, target) => {
    const machine = (typeof target === 'object' && target !== null ? (target as { machine: MachineRef }).machine : target) ?? TEST_MACHINE;
    calls.push({ name, input, machine });
    const studio = machine === OTHER_MACHINE;
    if (name === 'library.list') {
      const filter = (input.filter ?? {}) as LibraryFilter;
      const rows: LibraryRow[] = !studio ? [] : filter.appSessionId === undefined ? [DECK, LOOSE] : [DECK].filter((row) => row.sessions.some((s) => s.appSessionId === filter.appSessionId));
      return ok({ rows, counts: countsOf(rows) });
    }
    if (name === 'library.get') return ok({ row: studio ? ([DECK, LOOSE].find((row) => row.id === input.artifactId) ?? null) : null });
    if (name === 'artifacts.get') return ok({ artifact: null });
    if (name === 'artifacts.markViewed' || name === 'layout.set') return ok();
    if (name === 'layout.get') return ok({ value: null });
    return fail(`unexpected ${name}`);
  });
  offs.push(connectLibrary());
  // an editor whose content is on screen at mount, as a viewer's is
  function Panel({ artifactId, onShown }: ArtifactEditorProps<null>) {
    useEffect(() => onShown(), [onShown]);
    return <p>editing {artifactId}</p>;
  }
  registerArtifactEditor('document', { Panel, Main: Panel, createState: () => null, dispose: () => {} });
});

const handles: ArtifactsHandle[] = [];
afterEach(() => {
  cleanup();
  handles.splice(0).forEach((handle) => artifactsTool.dispose(handle));
  offs.splice(0).forEach((off) => off());
});

const TAB = 'artifacts:remote';
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

async function mount(params?: ArtifactsParams, restored = false) {
  const handle = artifactsTool.createState({ appSessionId: R, session: null, instanceId: TAB, params: params as ArtifactsParams, ...(restored && { restored: true }) });
  handles.push(handle);
  const ctx: PanelToolContext = {
    appSessionId: R, session: null, status: null, pinned: false, visible: true, focusRequest: 0, setTitle: () => {}, close: () => {}, openTool: panelHost.addTool,
    editorHost: { surface: 'panel', tabId: TAB },
  };
  const Body = artifactsTool.render;
  render(<Body state={handle} ctx={ctx} />);
  await settle();
  return handle;
}

describe('a remote session’s Artifacts tool', () => {
  it('lists the session’s artifacts from its machine by its address, and All from that machine’s library', async () => {
    await mount();
    expect(sent('library.list').map((call) => [call.machine, call.input.filter])).toEqual([[OTHER_MACHINE, { appSessionId: MAIN_R, lineage: true }]]);
    expect(screen.getByText('Studio deck')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    await settle();
    expect(sent('library.list').at(-1)).toMatchObject({ machine: OTHER_MACHINE, input: { filter: {} } });
    expect(screen.getByText('Studio notes')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open library' }));
    expect(useLibraryView.getState().machine).toBe(OTHER_MACHINE);
  });

  it('opens a listed artifact on its machine: the record view reads there and the tab keeps the machine', async () => {
    const handle = await mount();
    fireEvent.click(screen.getByText('Studio deck'));
    await settle();
    expect(screen.getByText(`editing ${DECK.id}`)).toBeTruthy();
    expect(handle.snapshot().view).toEqual({ kind: 'record', artifactId: DECK.id, machine: OTHER_MACHINE });
    expect(sent('library.get').map((call) => call.machine)).toEqual([OTHER_MACHINE]);
    expect(sent('artifacts.markViewed').map((call) => call.machine)).toEqual([OTHER_MACHINE]);
  });

  it('a restored record names its machine, so its reads go there before any list', async () => {
    await mount({ target: LOOSE.id, machine: OTHER_MACHINE }, true);
    expect(artifactMachineOf(LOOSE.id)).toBe(OTHER_MACHINE);
    expect(sent('library.get').map((call) => call.machine)).toEqual([OTHER_MACHINE]);
    expect(screen.getByText(`editing ${LOOSE.id}`)).toBeTruthy();
  });
});

describe('opening an artifact of another machine', () => {
  it('a remote session’s transcript Open opens it on the session’s machine', () => {
    offs.push(registerPanelTool(artifactsTool));
    const added: unknown[] = [];
    const original = panelHost.addTool;
    panelHost.addTool = ((id: string, options: unknown) => (added.push(options), 'tab')) as typeof panelHost.addTool;
    try {
      openArtifactInPanel(R, LOOSE.id);
    } finally {
      panelHost.addTool = original;
    }
    expect(added).toMatchObject([{ params: { target: LOOSE.id, machine: OTHER_MACHINE } }]);
    expect(artifactMachineOf(LOOSE.id)).toBe(OTHER_MACHINE);
  });

  it('the library’s Open opens a main tab on the artifact’s machine', async () => {
    await ipc.invoke('library.list', { filter: {} }, { machine: OTHER_MACHINE });
    openArtifactTab(LOOSE.id);
    expect(allTabs(useLayout.getState().main).filter((tab) => tab.kind === 'artifact')).toMatchObject([{ artifactId: LOOSE.id, machine: OTHER_MACHINE }]);
  });

  it('a main tab restored with another machine’s artifact puts the artifact on that machine', () => {
    offs.push(connectArtifactTabMachines());
    act(() => useLayout.getState().openTab({ kind: 'artifact', artifactId: DECK.id, machine: OTHER_MACHINE }));
    expect(artifactMachineOf(DECK.id)).toBe(OTHER_MACHINE);
  });

  // fix wave 1 (the task review): a link names only the artifact; its source (the row's session, the Markdown artifact
  // it is written in) names the machine, so an artifact the page has not listed yet still opens on its machine
  it('a ⌘-clicked artifact link in a remote session’s transcript opens on the session’s machine before any list', () => {
    function InRemoteTranscript({ children }: { children: ReactNode }) {
      return <TranscriptProvider value={{ ...useTranscriptContext(), storeKey: R, actions: { ...NO_ACTIONS, openArtifactTab } }}>{children}</TranscriptProvider>;
    }
    render(
      <InRemoteTranscript>
        <TranscriptLink href={`maws-artifact:${LOOSE.id}`}>Notes from the studio</TranscriptLink>
      </InRemoteTranscript>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Notes from the studio' }), { metaKey: true });
    expect(allTabs(useLayout.getState().main).filter((tab) => tab.kind === 'artifact')).toMatchObject([{ artifactId: LOOSE.id, machine: OTHER_MACHINE }]);
    expect(artifactMachineOf(LOOSE.id)).toBe(OTHER_MACHINE);
  });

  it('a link in another machine’s Markdown artifact opens its unlisted target on that machine', () => {
    recordArtifactMachine(DECK.id, OTHER_MACHINE, TEST_MACHINE);
    setHostActions({ ...NO_ACTIONS, openArtifactTab });
    try {
      render(<MarkdownView entry={{ tabId: 'remote-md', appSessionId: null, artifact: { artifactId: DECK.id, machine: OTHER_MACHINE, revision: 1 }, text: `[Studio notes](maws-artifact:${LOOSE.id})` } as never} />);
      fireEvent.click(screen.getByRole('button', { name: 'Studio notes' }));
    } finally {
      setHostActions(NO_ACTIONS);
    }
    expect(allTabs(useLayout.getState().main).filter((tab) => tab.kind === 'artifact')).toMatchObject([{ artifactId: LOOSE.id, machine: OTHER_MACHINE }]);
  });
});


it('opens and edits each machine’s document when both copies have the same artifact id', async () => {
  const localRow = { ...DECK, title: 'Field notes' };
  const remoteRow = { ...DECK, title: 'Lab notes' };
  const local = new MemoryDocumentHost();
  const remote = new MemoryDocumentHost();
  local.write((doc) => createDocument(doc, { title: localRow.title, id: 'page' }));
  remote.write((doc) => createDocument(doc, { title: remoteRow.title, id: 'page' }));
  const ports = new Map<number, PortLike>();
  let channel = 0;
  const main = installFakeMain((name, input, machine) => {
    const row = machine === OTHER_MACHINE ? remoteRow : localRow;
    if (name === 'library.get') return ok({ row: input.artifactId === DECK.id ? row : null });
    if (name === 'artifacts.get') return ok({ artifact: input.artifactId === DECK.id ? artifactRow(1, { title: row.title }) : null });
    if (name === 'artifacts.open') {
      const host = machine === OTHER_MACHINE ? remote : local;
      ports.set(++channel, host.connect() as unknown as PortLike);
      return ok({ channel });
    }
    if (name === 'artifacts.status') return ok({ status: 'ok', reason: null });
    if (name === 'artifacts.attributions') return ok({ bytes: new Uint8Array() });
    if (name === 'artifacts.versions') return ok({ versions: [] });
    if (name === 'library.spaces') return ok({ spaces: [] });
    if (name === 'artifacts.markViewed' || name === 'layout.set') return ok();
    return fail(`unexpected ${name}`);
  });
  offs.push(registerDocumentEditor((machine) => ({
    host: createArtifactHost({ ipc, machine, ports: { take: async (id) => ports.get(id)! }, log: () => {} }),
    ipc: artifactClient(ipc, machine), log: () => {}, confirm: () => false, sessionTitle: () => undefined, sessions: () => [],
  })));
  // Open as a palette pick would: the selected row's machine is already known.
  openArtifactTab(DECK.id, undefined, TEST_MACHINE);
  const tab = allTabs(useLayout.getState().main).find((tab) => tab.kind === 'artifact')!;
  if (tab.kind !== 'artifact') throw new Error('expected an artifact tab');
  try {
    await mount({ target: DECK.id, machine: OTHER_MACHINE });
    const mainView = render(<ArtifactTab tab={tab} />);
    const editorAt = (root: ParentNode) => (root.querySelector('.ProseMirror') as (HTMLElement & { editor?: Editor }) | null)?.editor;
    const panel = document.querySelector('[data-artifact-record]')!;
    await waitFor(() => {
      expect(editorAt(mainView.container)).toBeDefined();
      expect(editorAt(panel)).toBeDefined();
    });
    expect.soft(main.targetsOf('library.get')).toEqual([OTHER_MACHINE, TEST_MACHINE]);
    await waitFor(() => {
      expect(editorHostOf({ surface: 'main', tabId: tab.id })?.title).toBe('Field notes');
      expect(editorHostOf({ surface: 'panel', tabId: TAB })?.title).toBe('Lab notes');
    });
    act(() => {
      editorAt(mainView.container)!.commands.insertContent('Field observation');
      editorAt(panel)!.commands.insertContent('Lab result');
    });
    await waitFor(() => {
      expect(tabBody(local.doc, 'page')?.toString()).toContain('Field observation');
      expect(tabBody(remote.doc, 'page')?.toString()).toContain('Lab result');
    });
    expect(tabBody(local.doc, 'page')?.toString()).not.toContain('Lab result');
    expect(tabBody(remote.doc, 'page')?.toString()).not.toContain('Field observation');
  } finally {
    cleanup();
    releaseArtifactEditorState({ surface: 'main', tabId: tab.id });
    for (const handle of handles.splice(0)) artifactsTool.dispose(handle);
    local.destroy();
    remote.destroy();
  }
});
