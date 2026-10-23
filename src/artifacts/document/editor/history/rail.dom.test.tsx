// The history rail in DocumentEditor (M5 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D10; §4.7 of the
// parent; happy-dom over the in-memory host and history, real ports): the list by day with runs folded, author chips
// in --author-N and Named only; Save version; the preview read-only in the authors' colours with "N changes" ↑ ↓ and
// Show changes, moved and retyped blocks labelled, the version's pinned tokens; Restore leaving history with undo cleared
// and the banner; Make a copy; Compare by shift-click; the "See N new changes" pill; Show editors on a selection.
import type { Editor } from '@tiptap/core';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode, type ComponentProps, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { actorDisplay, type Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import { applyEdit } from '../../patch-writer';
import { schemaFor } from '../../schema';
import { addTab, createDocument, deleteTab, renameTab, tabBody } from '../../tabs';
import { addThread } from '../../threads';
import { isBindingTransaction, newDoc, stateV2 } from '../../../yjs';
import { ynodeToPmnode } from '../../../yjs/prosemirror';
import { DesignSystemHostContext, DesignSystemScope } from '../../../design-system/apply';
import complete from '../../../design-system/fixtures/complete.tokens.json';
import { writeSystem } from '../../../design-system/model';
import { parseTokens, serializeTokens } from '../../../design-system/tokens';
import type { ArtifactHost } from '../../../host';
import { setDsOverrides } from '../../meta';
import { DocumentEditor } from '../DocumentEditor';
import type { DocumentHandle } from '../host-types';
import { MemoryDocumentHost, memoryEditorHost, openMemoryHandle, whenSynced } from '../memory-host';
import { endOf, until } from '../test-world';
import { MemoryHistory } from './memory-history';

const SESSION = '00000000-0000-4000-8000-0000000000a1' as AppSessionId;
const AGENT: Actor = { kind: 'session', appSessionId: SESSION };
const HUMAN: Actor = { kind: 'human' };
const TAB = 't1';
const DAY = 24 * 60 * 60 * 1000;

let host: MemoryDocumentHost | null = null;
let history: MemoryHistory | null = null;
let handles: DocumentHandle[] = [];
afterEach(() => {
  cleanup();
  for (const handle of handles) handle.close();
  handles = [];
  history?.destroy();
  history = null;
  host?.destroy();
  host = null;
});

interface Mounted {
  host: MemoryDocumentHost;
  history: MemoryHistory;
  agent: DocumentHandle;
  editor: () => Editor;
  /** Writes as the agent and waits for the host to have it. */
  agentWrites(edit: (agent: DocumentHandle) => void): Promise<void>;
}

async function setup(
  prepare?: (world: Pick<Mounted, 'host' | 'history' | 'agentWrites'>) => Promise<void> | void,
  options: ConstructorParameters<typeof MemoryHistory>[1] = {},
  wrap: (node: ReactNode) => ReactNode = (node) => node,
  pageScope?: ComponentProps<typeof DocumentEditor>['pageScope'],
): Promise<Mounted> {
  host = new MemoryDocumentHost();
  history = new MemoryHistory(host, { sessionTitles: { [SESSION]: 'Fix the build' }, ...options });
  host.write((doc) =>
    createDocument(doc, {
      title: 'Main',
      id: TAB,
      body: schemaFor().nodeFromJSON({
        type: 'doc',
        content: [
          { type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'The first paragraph.' }] },
          { type: 'paragraph', attrs: { id: 'p2' }, content: [{ type: 'text', text: 'The second paragraph.' }] },
          { type: 'paragraph', attrs: { id: 'p3' }, content: [{ type: 'text', text: 'The third paragraph.' }] },
        ],
      }),
    }),
  );
  const open = async (actor: Actor) => {
    const handle = openMemoryHandle(host!, { log: () => {}, actor });
    handles.push(handle);
    await whenSynced(handle);
    return handle;
  };
  const agent = await open(AGENT);
  const agentWrites = async (edit: (agent: DocumentHandle) => void) => {
    const before = host!.revision;
    edit(agent);
    await until(() => host!.revision > before && agent.state().unsaved === 0, 'the agent’s write at the host');
  };
  await prepare?.({ host, history, agentWrites });
  const handle = await open(HUMAN);
  let editor: Editor | null = null;
  render(wrap(<DocumentEditor artifactId="doc1" handle={handle} host={memoryEditorHost({ actor: HUMAN, name: 'Owner', color: '--author-2' })} history={history} onEditor={(e) => (editor = e)} pageScope={pageScope} />));
  await until(() => editor !== null && editor.getText().length > 0, 'the editor to bind');
  return { host, history, agent, editor: () => editor!, agentWrites };
}

const toolbar = () => screen.getByRole('toolbar', { name: 'Formatting' });
const rail = () => screen.getByRole('complementary', { name: 'Version history' });
const bar = () => screen.getByRole('toolbar', { name: 'Version preview' });
const click = (element: Element, init?: MouseEventInit) => act(() => void fireEvent.click(element, init));
async function openHistory() {
  click(within(toolbar()).getByRole('button', { name: 'Version history' }));
  await until(() => screen.queryByRole('complementary', { name: 'Version history' }) !== null && within(rail()).queryAllByRole('button', { name: /^Version / }).length > 0, 'the version list');
}
const row = (title: string) => within(rail()).getByRole('button', { name: new RegExp(`^Version ${title}`) });
const agentAppends = (text: string) => (agent: DocumentHandle) => {
  const p2 = tabBody(agent.doc, TAB)!.get(1) as { insert(i: number, s: string): void; toArray(): unknown[] };
  p2.insert((p2.toArray()[0] as string).length, text);
};
const previewing = async () => until(() => screen.queryByRole('toolbar', { name: 'Version preview' }) !== null && !screen.queryByText('Loading the version…'), 'the preview');
const liveText = (editor: Editor) => editor.state.doc.textContent;
// M9 (the controller's fix wave, step 2): a version is shown in an editor of its own, beside the live one.
const previewEditor = (): Editor | null => (document.querySelector('.ProseMirror[data-editor="preview"]') as unknown as { editor?: Editor } | null)?.editor ?? null;

describe('the list', () => {
  it('groups by day, folds runs of automatic versions, colours author chips by --author-N and filters Named only', async () => {
    const now = new Date(2026, 9, 15, 12).getTime(); // local noon, so a minute ago is today in every zone (the rail reads `at` too)
    const at = { value: now - 3 * DAY };
    await setup(
      async ({ history: h, agentWrites }) => {
        h.version('auto', HUMAN);
        at.value = now - DAY;
        await agentWrites(agentAppends(' One.'));
        h.version('turn', AGENT, { label: 'Appended one sentence' });
        at.value = now - 60_000;
        h.version('auto', HUMAN);
        h.version('auto', HUMAN);
        h.version('auto', HUMAN);
        h.version('named', HUMAN, { label: 'Draft to legal', note: 'Ready for review' });
      },
      { now: () => at.value },
    );
    at.value = now;
    await openHistory();
    const groups = within(rail()).getAllByRole('region').map((section) => section.getAttribute('aria-label'));
    expect(groups.slice(0, 2)).toEqual(['Today', 'Yesterday']);
    expect(groups).toHaveLength(3);

    // the three automatic versions in a row fold under the newest
    const fold = within(rail()).getByRole('button', { name: '2 more versions' });
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    const today = within(rail()).getByRole('region', { name: 'Today' });
    expect(within(today).getAllByRole('button', { name: /^Version / })).toHaveLength(2); // the named one and the run's newest
    click(fold);
    expect(within(today).getAllByRole('button', { name: /^Version / })).toHaveLength(4);

    // the agent's chip in its colour, named by its session's title
    const turn = row('.*Appended one sentence');
    const chip = turn.querySelector<HTMLElement>('[data-author="Fix the build"]')!;
    expect(chip.style.background).toBe(`var(${actorDisplay(AGENT, 'Fix the build').color})`);
    expect(within(turn).getByText('Appended one sentence')).toBeTruthy();

    act(() => void fireEvent.click(within(rail()).getByRole('checkbox', { name: 'Named only' })));
    expect(within(rail()).getAllByRole('button', { name: /^Version / }).map((b) => b.getAttribute('aria-label'))).toEqual([expect.stringMatching(/^Version Draft to legal/)]);
  });

  it('saves a version with its name and note', async () => {
    const { history: h } = await setup();
    await openHistory();
    click(within(rail()).getByRole('button', { name: 'Save version' }));
    act(() => void fireEvent.change(within(rail()).getByRole('textbox', { name: 'Version name' }), { target: { value: 'Draft to legal' } }));
    act(() => void fireEvent.change(within(rail()).getByRole('textbox', { name: 'What changed' }), { target: { value: 'Tightened the second paragraph' } }));
    click(within(rail()).getByRole('button', { name: 'Save' }));
    await until(() => within(rail()).queryByRole('button', { name: /^Version Draft to legal/ }) !== null, 'the saved version listed');
    const saved = (await h.versions()).find((v) => v.kind === 'named');
    expect(saved).toMatchObject({ label: 'Draft to legal', note: 'Tightened the second paragraph', actor: HUMAN });
    expect(within(row('Draft to legal')).getByText('Tightened the second paragraph')).toBeTruthy();
  });
});

// P4 W1-B (the tracker's "P4 version history lines"; §4.7's one-line summary): a turn's stored summary is the tools' own
// lines, which name blocks as ^id and comments as c:id; the row names them by the live document's words instead, from
// any of its tabs, and says "a block" for one the document no longer holds. The stored summary is left as it is.
describe('a row’s line', () => {
  const cell = (type: 'tableHeader' | 'tableCell', id: string, text: string) => ({ type, attrs: { id, colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: 'paragraph', attrs: { id: `${id}p` }, content: [{ type: 'text', text }] }] });
  const table = {
    type: 'table',
    attrs: { id: 'tb1' },
    content: [
      { type: 'tableRow', attrs: { id: 'tr0' }, content: [cell('tableHeader', 'th1', 'Region'), cell('tableHeader', 'th2', 'Q1')] },
      { type: 'tableRow', attrs: { id: 'tr1' }, content: [cell('tableCell', 'td1', 'North'), cell('tableCell', 'td2', '4.2')] },
    ],
  };

  it('keeps version identity without generated block and comment chatter', async () => {
    const clock = { value: new Date(2026, 9, 15, 12).getTime() };
    await setup(
      ({ host: h, history: hist }) => {
        h.write((doc) => {
          addTab(doc, { title: 'Figures', id: 't2', body: schemaFor().nodeFromJSON({ type: 'doc', content: [table] }) });
          addThread(doc, { threadId: 'c1', tabId: TAB, blockId: 'p1', quote: 'The first paragraph.', anchor: { kind: 'block' }, by: HUMAN, at: 1, body: 'Shorter?' });
        });
        for (const summary of ['replaced 1 occurrence(s) in ^p2', 'set cell (1, 0) of ^tb1', 'replied on c:c1', 'replaced 2 occurrence(s) in ^gone']) {
          clock.value += 60_000;
          hist.version('turn', AGENT, { summary });
        }
      },
      { now: () => clock.value },
    );
    await openHistory();
    const rows = within(rail()).getAllByRole('button', { name: /^Version / });
    expect(rows.every((button) => !button.querySelector('.doc-version-summary'))).toBe(true);
    expect(rows[0].getAttribute('aria-label')).toMatch(/ by Fix the build$/);
  });
});

describe('the preview', () => {
  // M9 (the scale gate: the preview's enter and leave re-rendered the live tab through `@y/prosemirror`'s binding, 1.2 s
  // and 0.9 s at 200 pages): the version is drawn in an editor of its own, read-only, while the live editor stays bound,
  // hidden, its content and undo untouched, so leaving history only shows it again.
  it('shows a version in an editor of its own: the live editor keeps its binding, its content and its undo across enter and leave', async () => {
    const { editor } = await setup(async ({ history: h, agentWrites }) => {
      h.version('named', HUMAN, { label: 'Before' });
      await agentWrites(agentAppends(' Later.'));
    });
    const live = editor();
    act(() => void live.chain().insertContentAt(endOf(live, 'p3'), ' Typed.').run());
    expect(live.can().undo()).toBe(true);
    const content = live.state.doc;
    let rebound = 0;
    live.on('transaction', ({ transaction }) => {
      if (transaction.docChanged && isBindingTransaction(transaction)) rebound += 1;
    });

    await openHistory();
    click(row('Before'));
    await previewing();
    const shown = previewEditor();
    expect(shown).not.toBeNull();
    expect(shown).not.toBe(live);
    expect(shown!.isEditable).toBe(false);
    expect(shown!.storage.collaboration.history).not.toBeNull(); // in history from its creation
    expect(liveText(shown!)).not.toContain('Later.');
    expect(live.view.dom.closest('[hidden]')).not.toBeNull(); // the live page hidden, not unbound
    expect(shown!.can().undo()).toBe(false);
    const before = shown!.state.doc;
    act(() => void shown!.commands.insertContentAt(1, 'X'));
    expect(shown!.state.doc).toBe(before); // a local change on the preview is refused
    const previewDom = shown!.view.dom;
    const previewFirstBlock = previewDom.firstElementChild!;

    click(within(bar()).getByRole('button', { name: 'Back to document' }));
    await until(() => screen.queryByRole('toolbar', { name: 'Formatting' }) !== null && previewEditor() === null, 'the live document');
    expect(rebound).toBe(0);
    await until(() => shown!.isDestroyed, 'the preview editor destroyed'); // nothing of the preview is retained
    // its document was not drawn again on the way out (EditorContent's unmount clears the node views, which redraws
    // the whole document — 32,000 nodes of garbage at 200 pages); the blocks it drew are the ones it went with
    expect(previewFirstBlock.parentNode).toBe(previewDom);
    expect(live.state.doc).toBe(content);
    expect(live.view.dom.closest('[hidden]')).toBeNull();
    expect(live.can().undo()).toBe(true);
    act(() => void live.commands.undo());
    await until(() => !liveText(live).includes('Typed.'), 'the typing undone');
  });

  it('shows a version read-only with its changes in the authors’ colours, counts them and steps through them', async () => {
    const { editor } = await setup(async ({ history: h, agentWrites }) => {
      h.version('named', HUMAN, { label: 'Before' });
      await agentWrites(agentAppends(' The agent adds this.'));
      await agentWrites((agent) => (tabBody(agent.doc, TAB)!.get(0) as { delete(i: number, n: number): void }).delete(0, 4));
      h.version('turn', AGENT, { label: 'Two edits' });
    });
    await openHistory();
    click(row('.*Two edits'));
    await previewing();
    expect(previewEditor()!.isEditable).toBe(false); // M9: the version is the preview editor’s, not the live one’s
    expect(document.querySelector('.ProseMirror y-ins')?.textContent).toBe(' The agent adds this.');
    const run = document.querySelector<HTMLElement>('.ProseMirror .doc-change-ins')!;
    expect(run.textContent).toBe(' The agent adds this.');
    expect(run.style.getPropertyValue('--doc-author')).toBe(`var(${actorDisplay(AGENT).color})`);
    expect(document.querySelector('.ProseMirror y-del')?.textContent).toBe('The ');
    expect(document.querySelectorAll('.ProseMirror [data-change-block]')).toHaveLength(2);
    expect(within(bar()).getByText('2 changes')).toBeTruthy();

    click(within(bar()).getByRole('button', { name: 'Next change' }));
    expect(document.querySelector('.doc-change-current')?.textContent).toBe('The ');
    click(within(bar()).getByRole('button', { name: 'Next change' }));
    expect(document.querySelector('.doc-change-current')?.textContent).toBe(' The agent adds this.');
    click(within(bar()).getByRole('button', { name: 'Previous change' }));
    expect(document.querySelector('.doc-change-current')?.textContent).toBe('The ');

    act(() => void fireEvent.click(within(bar()).getByRole('checkbox', { name: 'Show changes' })));
    await until(() => document.querySelector('.ProseMirror y-ins') === null, 'the plain version');
    expect(liveText(previewEditor()!)).toBe('first paragraph.The second paragraph. The agent adds this.The third paragraph.');

    click(within(bar()).getByRole('button', { name: 'Back to document' }));
    await until(() => screen.queryByRole('toolbar', { name: 'Formatting' }) !== null && editor().isEditable, 'the live document');
    expect(editor().can().undo()).toBe(false); // nothing of the preview is undoable
  });

  it('keeps the preview read-only through a StrictMode remount while a version shows', async () => {
    const { editor, history: h } = await setup(
      async ({ history: hist, agentWrites }) => {
        hist.version('named', HUMAN, { label: 'Before' });
        await agentWrites(agentAppends(' Later.'));
      },
      {},
      (node) => <StrictMode>{node}</StrictMode>,
    );
    await openHistory();
    click(row('Before'));
    await previewing();
    await new Promise((resolve) => setTimeout(resolve, 20)); // past the remount's deferred setOptions
    expect(previewEditor()!.isEditable).toBe(false); // M9: the version is the preview editor’s, not the live one’s
    expect(previewEditor()!.view.dom.getAttribute('contenteditable')).toBe('false');
    click(within(bar()).getByRole('button', { name: 'Back to document' }));
    await until(() => editor().isEditable && editor().view.dom.getAttribute('contenteditable') === 'true', 'the live, editable document');
    expect((await h.versions()).filter((v) => v.kind === 'auto')).toHaveLength(1); // one view-time version for the mount, StrictMode or not
  });

  it('labels the blocks a move or a retype re-inserted', async () => {
    await setup(async ({ host: h, history: hist, agentWrites }) => {
      hist.version('named', HUMAN, { label: 'Before' });
      let carries: ReturnType<typeof applyEdit>['carries'] = [];
      await agentWrites((agent) => (carries = applyEdit(agent.doc, [{ op: 'move', id: 'p1', after: 'p3' }]).carries));
      hist.carryLast(carries);
      await agentWrites((agent) => (carries = applyEdit(agent.doc, [{ op: 'replace_block', id: 'p2', markdown: '## The second paragraph. ^p2' }]).carries));
      hist.carryLast(carries);
      expect(ynodeToPmnode(tabBody(h.doc, TAB)!, schemaFor()).textContent).toBe('The second paragraph.The third paragraph.The first paragraph.');
      hist.version('turn', AGENT, { label: 'Moved and retyped' });
    });
    await openHistory();
    click(row('.*Moved and retyped'));
    await previewing();
    await until(() => document.querySelectorAll('.ProseMirror [data-carry]').length === 2, 'the labels');
    const labelled = [...document.querySelectorAll<HTMLElement>('.ProseMirror [data-carry]')].map((el) => [el.dataset.carry, el.dataset.carryLabel, el.textContent]);
    expect(labelled).toEqual([
      ['retype', 'Retyped', 'The second paragraph.'],
      ['move', 'Moved', 'The first paragraph.'],
    ]);
  });

  // P4 W1-B (tracker L238): once compaction merges the rows, the one spanning a comparison's start brings an earlier
  // move's carry with it, and the rows as written do too (the range's start is inclusive: the row of the start
  // version's own seq, here the move's); a block the comparison did not change is not labelled, a block it moved still is
  it.each([true, false])('labels only the blocks the comparison changed when a row reaches back past its start (compacted: %s)', async (compacted) => {
    await setup(async ({ host: h, history: hist, agentWrites }) => {
      hist.version('named', HUMAN, { label: 'Before' });
      let carries: ReturnType<typeof applyEdit>['carries'] = [];
      await agentWrites((agent) => (carries = applyEdit(agent.doc, [{ op: 'move', id: 'p1', after: 'p3' }]).carries));
      hist.carryLast(carries);
      hist.version('turn', AGENT, { label: 'Moved the first' });
      await agentWrites(agentAppends(' Later.')); // the third paragraph, second after the move
      hist.version('turn', AGENT, { label: 'Added a word' });
      if (compacted) hist.compact(0, h.revision);
    });
    await openHistory();
    const labels = () => [...document.querySelectorAll<HTMLElement>('.ProseMirror [data-carry]')].map((el) => [el.dataset.carryLabel, el.textContent]);
    click(row('.*Added a word'));
    await previewing();
    await until(() => document.querySelector('.ProseMirror [data-change-block]')?.textContent === 'The third paragraph. Later.', 'the change');
    expect(labels()).toEqual([]);
    click(row('.*Moved the first'));
    await previewing();
    await until(() => labels().length > 0, 'the label');
    expect(labels()).toEqual([['Moved', 'The first paragraph.']]);
  });

  it('draws a version with the design-system tokens it pinned', async () => {
    const system = '00000000-0000-4000-8000-0000000000d5';
    await setup(
      async ({ history: h, agentWrites }) => {
        h.version('named', HUMAN, { label: 'Old look', designSystemRef: { id: system, versionSeq: 1 } });
        await agentWrites(agentAppends(' More.'));
        h.version('named', HUMAN, { label: 'New look', designSystemRef: { id: system, versionSeq: 2 } });
      },
      { designTokens: { [`${system}@1`]: { '--ds-color-text': 'rgb(1, 2, 3)' }, [`${system}@2`]: { '--ds-color-text': 'rgb(4, 5, 6)' } } },
    );
    const page = () => document.querySelector<HTMLElement>('.ds-doc')!;
    expect(page().style.getPropertyValue('--ds-color-text')).toBe('');
    await openHistory();
    click(row('Old look'));
    await previewing();
    await until(() => page().style.getPropertyValue('--ds-color-text') === 'rgb(1, 2, 3)', 'the old tokens');
    click(row('New look'));
    await until(() => page().style.getPropertyValue('--ds-color-text') === 'rgb(4, 5, 6)', 'the new tokens');
    click(within(bar()).getByRole('button', { name: 'Back to document' }));
    await until(() => page().style.getPropertyValue('--ds-color-text') === '', 'the live tokens');
  });

  // F's S-RESTYLE: the page's scope draws a version in the system it pinned (the floor for one written with none), with
  // the version's own overrides, as C's deck preview does; the live document again in the governing one
  it('hands the page’s scope the system each version pinned, and nothing for the live document', async () => {
    const system = '00000000-0000-4000-8000-0000000000d5';
    const Scope = ({ children, pinned }: { children: ReactNode; pinned?: { system: { id: string; versionSeq: number } | { builtin: 'maws' }; overrides: Record<string, string> } }) => {
      const key = !pinned ? 'live' : 'builtin' in pinned.system ? `floor ${JSON.stringify(pinned.overrides)}` : `${pinned.system.id}@${pinned.system.versionSeq} ${JSON.stringify(pinned.overrides)}`;
      return <div data-scope-key={key}>{children}</div>;
    };
    await setup(
      async ({ history: h, agentWrites }) => {
        h.version('named', HUMAN, { label: 'Unpinned' });
        await agentWrites(agentAppends(' More.'));
        h.version('named', HUMAN, { label: 'Old look', designSystemRef: { id: system, versionSeq: 1 } });
      },
      {},
      undefined,
      Scope,
    );
    const scopeKey = () => document.querySelector<HTMLElement>('[data-scope-key]')!.dataset.scopeKey;
    const liveEditor = document.querySelector('.ProseMirror:not([data-editor="preview"])');
    expect(scopeKey()).toBe('live');
    await openHistory();
    click(row('Old look'));
    await previewing();
    await until(() => scopeKey() === `${system}@1 {}`, 'the pinned system');
    click(row('Unpinned'));
    await until(() => scopeKey() === 'floor {}', 'the floor for a version with no pin');
    click(within(bar()).getByRole('button', { name: 'Back to document' }));
    await until(() => scopeKey() === 'live', 'the live system');
    // only the scope changed: the live editor is the one mounted before the preview
    expect(document.querySelector('.ProseMirror:not([data-editor="preview"])')).toBe(liveEditor);
  });

  // F's S-RESTYLE review: with D's own scope around the page, the scope alone draws a version in the system it pinned, so
  // a version override naming the system's bundled family reaches the page under the face's private name, its face
  // loaded from the pinned revision's asset; the page itself declares none of the version's tokens (an inline one would
  // shadow the scope's aliased value with the bare family name, which no face declares).
  it('lets D’s scope draw a version’s bundled-family override, with its pinned face, declaring nothing on the page', async () => {
    const system = '00000000-0000-4000-8000-0000000000d6';
    const pinnedSeq = 7;
    const systemDoc = newDoc();
    writeSystem(
      systemDoc,
      {
        'tokens.tokens.json': serializeTokens(parseTokens(complete).tokens!),
        'components/document.css': '@font-face { font-family: "Iowan Old Style"; font-weight: 400; src: url("assets/iowan.woff2") format("woff2"); }\n',
      },
      { route: 'derived', at: Date.UTC(2026, 9, 13) },
      { name: 'Harbor' },
    );
    const pinnedState = stateV2(systemDoc);
    systemDoc.destroy();
    const systems = {
      versionState: async (id: string, at: number | { seq: number }) => {
        if (id !== system || typeof at === 'number' || at.seq !== pinnedSeq) throw new Error(`no state of ${id}`);
        return pinnedState;
      },
      assetUrl: (id: string, ref: string, revision?: number) => `https://assets.example/${id}/${revision ?? 'live'}/${ref}`,
    } as unknown as ArtifactHost;
    const SystemScope = ({ children, pinned }: { children: ReactNode; pinned?: { system: { id: string; versionSeq: number } | { builtin: 'maws' }; overrides: Record<`--ds-${string}`, string> } }) => (
      <DesignSystemScope system={pinned?.system ?? { builtin: 'maws' }} medium="document" overrides={pinned?.overrides} className="doc-page-system">
        {children}
      </DesignSystemScope>
    );
    const BODY = '"Iowan Old Style", serif';
    await setup(
      async ({ history: h, agentWrites }) => {
        await agentWrites((agent) => setDsOverrides(agent.doc, { '--ds-font-body': BODY }));
        h.version('named', HUMAN, { label: 'Old look', designSystemRef: { id: system, versionSeq: pinnedSeq } });
      },
      {},
      (node) => <DesignSystemHostContext.Provider value={systems}>{node}</DesignSystemHostContext.Provider>,
      SystemScope,
    );
    const page = () => document.querySelector<HTMLElement>('.ds-doc')!;
    const scopeCss = () => {
      const scope = page().closest<HTMLElement>('[data-ds-scope]')?.dataset.dsScope;
      return (scope && document.head.querySelector(`style[data-ds-scope-style="${scope}"]`)?.textContent) || '';
    };
    await openHistory();
    click(row('Old look'));
    await previewing();
    await until(() => /assets\.example\/[\w-]+\/7\/assets\/iowan\.woff2/.test(scopeCss()), 'the pinned system’s face in the scope');
    const css = scopeCss();
    expect(css).toContain(`assets.example/${system}/7/assets/iowan.woff2`);
    const alias = /font-family: (ds-face-[a-z0-9]+);/.exec(css)?.[1];
    expect(alias).toBeDefined();
    expect(css).toContain(`--ds-font-body: ${alias}, "Iowan Old Style", serif;`);
    expect(page().hasAttribute('data-preview')).toBe(true);
    expect(page().getAttribute('style') ?? '').toBe('');
  });

  it('compares two versions picked by shift-click', async () => {
    await setup(async ({ history: h, agentWrites }) => {
      await agentWrites(agentAppends(' Before the first.'));
      h.version('named', HUMAN, { label: 'First' });
      await agentWrites(agentAppends(' Between them.'));
      h.version('named', HUMAN, { label: 'Second' });
      await agentWrites(agentAppends(' After the second.'));
      h.version('named', HUMAN, { label: 'Third' });
    });
    await openHistory();
    click(row('First'));
    await previewing();
    click(row('Third'), { shiftKey: true });
    await until(() => within(bar()).queryByText('First → Third') !== null, 'the comparison');
    const inserted = () => [...document.querySelectorAll('.ProseMirror y-ins')].map((el) => el.textContent).join('');
    await until(() => inserted() === ' Between them. After the second.', 'the compared inserts');
    expect(row('First').getAttribute('aria-pressed')).toBe('true');
    expect(row('Third').getAttribute('aria-pressed')).toBe('true');
    expect(within(bar()).queryByRole('button', { name: 'Restore this version' })).toBeNull();
  });
});

describe('the owner’s actions', () => {
  it('restores a version: history left, undo cleared, the banner shown', async () => {
    const { editor, host: h } = await setup(async ({ history: hist }) => {
      hist.version('named', HUMAN, { label: 'Clean draft' });
    });
    act(() => void editor().chain().insertContentAt(endOf(editor(), 'p3'), ' Typed by the owner.').run());
    await until(() => ynodeToPmnode(tabBody(h.doc, TAB)!, schemaFor()).textContent.includes('Typed by the owner.'), 'the typing at the host');
    expect(editor().can().undo()).toBe(true);

    await openHistory();
    click(row('Clean draft'));
    await previewing();
    click(within(bar()).getByRole('button', { name: 'Restore this version' }));
    click(screen.getByRole('button', { name: 'Restore' }));
    await until(() => screen.queryByRole('toolbar', { name: 'Version preview' }) === null && editor().isEditable, 'history left');
    await until(() => !liveText(editor()).includes('Typed by the owner.'), 'the restored text');
    await until(() => !editor().can().undo(), 'undo cleared');
    const banner = await until(() => screen.queryByRole('status', { name: 'Restored' }) !== null, 'the banner').then(() => screen.getByRole('status', { name: 'Restored' }));
    expect(banner.textContent).toContain('Restored from Clean draft');
  });

  it('makes a copy of the selected version', async () => {
    const { history: h } = await setup(async ({ history: hist, agentWrites }) => {
      hist.version('named', HUMAN, { label: 'Keep this' });
      await agentWrites(agentAppends(' Later.'));
      hist.version('named', HUMAN, { label: 'Later one' });
    });
    await openHistory();
    click(row('Keep this'));
    await previewing();
    click(within(bar()).getByRole('button', { name: 'Make a copy' }));
    await until(() => h.copies.length === 1, 'the copy');
    const kept = (await h.versions()).find((v) => v.label === 'Keep this')!;
    expect(h.copies).toEqual([kept.id]);
    expect(screen.queryByText('A copy of this version was made.')).toBeNull();
  });

  // M8 (§4.7: any automatic version nameable; A's `artifacts.nameVersion`, Decision Log 28): the previewed version is
  // named by its label alone, so the note it had stays as it was.
  it('names a previewed automatic version, sending the label only', async () => {
    const { history: h } = await setup(async ({ history: hist, agentWrites }) => {
      hist.version('auto', HUMAN);
      await agentWrites(agentAppends(' Later.'));
      hist.version('named', HUMAN, { label: 'Later one' });
    });
    await openHistory();
    const auto = (await h.versions()).find((v) => v.kind === 'auto')!;
    click(within(rail()).getAllByRole('button', { name: /^Version / }).find((b) => !/Later one/.test(b.getAttribute('aria-label') ?? ''))!);
    await previewing();
    click(within(bar()).getByRole('button', { name: 'Name this version' }));
    const field = screen.getByRole('textbox', { name: 'Version name' });
    act(() => void fireEvent.change(field, { target: { value: '  Before legal  ' } }));
    act(() => void fireEvent.submit(field.closest('form')!));
    await until(() => h.namings.length === 1, 'the naming');
    expect(h.namings).toEqual([{ versionId: auto.id, label: 'Before legal' }]);
    await until(() => within(rail()).queryByRole('button', { name: /^Version Before legal/ }) !== null, 'the list re-read with the name');
    expect((await h.versions()).find((v) => v.id === auto.id)).toMatchObject({ kind: 'auto', label: 'Before legal' });
  });

  it('offers no naming without the api’s nameVersion', async () => {
    await setup(async ({ history: hist }) => {
      hist.version('auto', HUMAN);
      (hist as { nameVersion?: unknown }).nameVersion = undefined;
    });
    await openHistory();
    click(within(rail()).getAllByRole('button', { name: /^Version / })[0]);
    await previewing();
    expect(within(bar()).queryByRole('button', { name: 'Name this version' })).toBeNull();
  });

  it('offers See N new changes after an agent changed the document since the last view, and opens that comparison', async () => {
    const t = { value: Date.now() - 60 * 60_000 };
    const { history: h } = await setup(
      async ({ history: hist, agentWrites }) => {
        hist.version('auto', HUMAN);
        await hist.markViewed();
        t.value += 10 * 60_000;
        await agentWrites(agentAppends(' The agent was here.'));
        await agentWrites((agent) => (tabBody(agent.doc, TAB)!.get(2) as { insert(i: number, s: string): void }).insert(0, 'Also: '));
        hist.version('turn', AGENT, { label: 'Two additions' });
        t.value += 10 * 60_000;
      },
      { now: () => t.value },
    );
    const pill = await until(() => screen.queryByRole('button', { name: 'See 2 new changes' }) !== null, 'the pill').then(() => screen.getByRole('button', { name: 'See 2 new changes' }));
    expect(h.viewedAt).toBe(t.value); // this view is marked
    click(pill);
    await previewing();
    expect(within(bar()).getByText('Changes since you last looked')).toBeTruthy();
    await until(() => document.querySelectorAll('.ProseMirror y-ins').length === 2, 'the new changes');
    expect(previewEditor()!.isEditable).toBe(false); // M9: the version is the preview editor’s, not the live one’s
    expect(screen.queryByRole('button', { name: /new changes/ })).toBeNull();
  });

  it('does not offer the pill when only the owner changed the document since', async () => {
    await setup(async ({ host: h, history: hist }) => {
      await hist.markViewed();
      h.write((doc) => (tabBody(doc, TAB)!.get(0) as { insert(i: number, s: string): void }).insert(0, 'Mine. '));
      hist.version('auto', HUMAN);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('button', { name: /new change/ })).toBeNull();
  });

  it('shows who edited a selection, and when', async () => {
    const { editor } = await setup(async ({ agentWrites }) => {
      await agentWrites(agentAppends(' The agent adds this.'));
    });
    act(() => void editor().chain().insertContentAt(endOf(editor(), 'p2'), ' And the owner.').run());
    act(() => void editor().commands.setTextSelection({ from: 1, to: endOf(editor(), 'p2') }));
    act(() => void fireEvent.contextMenu(editor().view.dom));
    click(screen.getByRole('menuitem', { name: 'Show editors' }));
    const list = await until(() => screen.queryByRole('dialog', { name: 'Editors' }) !== null && screen.getByRole('dialog', { name: 'Editors' }).querySelectorAll('li').length === 2, 'the editors').then(
      () => screen.getByRole('dialog', { name: 'Editors' }),
      (error: unknown) => {
        throw new Error(`${String(error)}: ${screen.queryByRole('dialog', { name: 'Editors' })?.textContent ?? 'no dialog'}`);
      },
    );
    const rows = [...list.querySelectorAll('li')].map((li) => li.textContent);
    expect(rows.some((text) => text?.startsWith('You'))).toBe(true);
    expect(rows.some((text) => text?.startsWith('Fix the build'))).toBe(true);
    for (const text of rows) expect(text).toMatch(/\d{1,2}:\d{2}\s?[AP]M/);
  });

  // The history-anchors review (scalpel-4#3): two sessions with no title are both "Claude", and edits in one minute read
  // the same time; each session is its own row all the same.
  it('lists two untitled sessions that edited in the same minute as a row each', async () => {
    const other: Actor = { kind: 'session', appSessionId: '00000000-0000-4000-8000-0000000000a2' as AppSessionId };
    const at = Date.UTC(2026, 9, 18, 9, 41);
    const { editor } = await setup(
      async ({ host: h, agentWrites }) => {
        await agentWrites(agentAppends(' One.'));
        h.write((doc) => (tabBody(doc, TAB)!.get(1) as { insert(i: number, s: string): void }).insert(0, 'Two. '), other);
      },
      { sessionTitles: {}, now: () => at },
    );
    const errors = vi.spyOn(console, 'error');
    try {
      act(() => void editor().commands.setTextSelection({ from: 1, to: endOf(editor(), 'p2') }));
      act(() => void fireEvent.contextMenu(editor().view.dom));
      click(screen.getByRole('menuitem', { name: 'Show editors' }));
      await until(() => screen.queryByRole('dialog', { name: 'Editors' })?.querySelectorAll('li').length === 3, 'the editors');
      const rows = [...screen.getByRole('dialog', { name: 'Editors' }).querySelectorAll('li')].map((li) => li.textContent);
      expect(rows.filter((text) => text?.startsWith('Claude · ')), 'one row per session').toHaveLength(2);
      expect(new Set(rows).size, 'the two read alike').toBe(2);
      expect(errors.mock.calls.filter((call) => /same key/.test(String(call[0]))), 'no two rows share a key').toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });

  // The history-anchors review (scalpel-5#2): the control clicked takes the keyboard and then goes (the menu's item as
  // the list replaces it, × as the list closes), so closing gives it back to the page; an Escape a comment card already
  // took is the card's, and the list stays.
  it('gives the keyboard back to the page when the editors list closes by Escape or ×, and leaves an Escape a card took', async () => {
    const { editor } = await setup(async ({ agentWrites }) => {
      await agentWrites(agentAppends(' The agent adds this.'));
    });
    const page = editor().view.dom;
    const dialog = () => screen.queryByRole('dialog', { name: 'Editors' });
    const showEditors = async () => {
      act(() => void editor().commands.setTextSelection({ from: 1, to: endOf(editor(), 'p2') }));
      act(() => page.focus());
      expect(document.activeElement, 'the page holds the keyboard').toBe(page);
      act(() => void fireEvent.contextMenu(page));
      const item = screen.getByRole('menuitem', { name: 'Show editors' });
      act(() => item.focus()); // a click focuses what it lands on
      click(item);
      await until(() => (dialog()?.querySelectorAll('li').length ?? 0) > 0, 'the editors');
    };
    await showEditors();
    const card = document.body.appendChild(document.createElement('div'));
    card.addEventListener('keydown', (event) => event.preventDefault()); // a card's Escape, its own
    act(() => void fireEvent.keyDown(card, { key: 'Escape' }));
    card.remove();
    expect(dialog(), 'an Escape a card took leaves the list').not.toBeNull();
    act(() => void fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' }));
    expect(dialog()).toBeNull();
    expect(document.activeElement, 'Escape: the page has the keyboard again').toBe(page);
    await showEditors();
    const close = screen.getByRole('button', { name: 'Close editors' });
    act(() => close.focus());
    click(close);
    expect(dialog()).toBeNull();
    expect(document.activeElement, '×: the page has the keyboard again').toBe(page);
  });
});

// M5's fix wave 1: what the review found missing, through the rail.
describe('a deleted tab and a failed count', () => {
  it('lists a tab the agent deleted in the preview’s tabs, and shows its text as deleted', async () => {
    await setup(async ({ host: h, history: hist }) => {
      h.write((doc) => addTab(doc, { title: 'Appendix', id: 'tab2', body: schemaFor().nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'x1' }, content: [{ type: 'text', text: 'Raw numbers live here.' }] }] }) }));
      hist.version('named', HUMAN, { label: 'Two tabs' });
      h.write((doc) => deleteTab(doc, 'tab2'), AGENT);
      hist.version('turn', AGENT, { label: 'Deleted the appendix' });
    });
    await openHistory();
    click(row('.*Deleted the appendix'));
    await previewing();
    const tabs = within(bar()).getByRole('combobox', { name: 'Tab' });
    expect([...tabs.querySelectorAll('option')].map((option) => option.textContent)).toEqual(['Main', 'Appendix (deleted)']);
    act(() => void fireEvent.change(tabs, { target: { value: 'tab2' } }));
    await until(() => document.querySelector('.ProseMirror y-del')?.textContent === 'Raw numbers live here.', 'the deleted tab’s text, struck');
    expect(within(bar()).getByText('This tab was deleted.')).toBeTruthy();
    expect(document.querySelector<HTMLElement>('.ProseMirror .doc-change-del')?.style.getPropertyValue('--doc-author')).toBe(`var(${actorDisplay(AGENT).color})`);
  });

  it('offers the new changes uncounted when counting fails, and counts again when asked', async () => {
    const t = { value: Date.now() - 60 * 60_000 };
    let failing = 1;
    await setup(
      async ({ history: hist, agentWrites }) => {
        hist.version('auto', HUMAN);
        await hist.markViewed();
        t.value += 10 * 60_000;
        await agentWrites(agentAppends(' The agent was here.'));
        hist.version('turn', AGENT, { label: 'One addition' });
        const versionState = hist.versionState.bind(hist);
        hist.versionState = (id) => (failing-- > 0 ? Promise.reject(new Error('the host is unavailable')) : versionState(id));
      },
      { now: () => t.value },
    );
    await until(() => screen.queryByRole('button', { name: 'Count the new changes again' }) !== null, 'the retry');
    expect(screen.getByRole('button', { name: 'See new changes' })).toBeTruthy();
    click(screen.getByRole('button', { name: 'Count the new changes again' }));
    await until(() => screen.queryByRole('button', { name: 'See 1 new change' }) !== null, 'the counted pill');
    expect(screen.queryByRole('button', { name: 'Count the new changes again' })).toBeNull();
  });
});

// M5's fix wave 2: the bar counts and steps through the whole comparison, tab changes included, as the pill counts it.
describe('the bar’s count', () => {
  it('counts a rename-only change on a one-tab document, steps to it and shows the rename', async () => {
    await setup(async ({ host: h, history: hist }) => {
      hist.version('named', HUMAN, { label: 'Before the rename' });
      h.write((doc) => renameTab(doc, TAB, 'Field notes'), AGENT);
      hist.version('turn', AGENT, { label: 'Renamed the tab' });
    });
    await openHistory();
    click(row('.*Renamed the tab'));
    await previewing();
    expect(within(bar()).getByText('1 change')).toBeTruthy();
    const tab = within(bar()).getByText('Field notes (renamed from Main)');
    const next = within(bar()).getByRole('button', { name: 'Next change' }) as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    click(next);
    expect(tab.hasAttribute('data-current')).toBe(true);
  });

  it('counts every tab’s changes and steps across tabs', async () => {
    await setup(async ({ host: h, history: hist }) => {
      h.write((doc) => addTab(doc, { title: 'Appendix', id: 'tab2', body: schemaFor().nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'x1' }, content: [{ type: 'text', text: 'Raw numbers.' }] }] }) }));
      hist.version('named', HUMAN, { label: 'Two tabs' });
      h.write((doc) => {
        (tabBody(doc, TAB)!.get(0) as { insert(i: number, s: string): void }).insert(0, 'First. ');
        (tabBody(doc, 'tab2')!.get(0) as { insert(i: number, s: string): void }).insert(0, 'Second. ');
      }, AGENT);
      hist.version('turn', AGENT, { label: 'Two tabs edited' });
    });
    await openHistory();
    click(row('.*Two tabs edited'));
    await previewing();
    expect(within(bar()).getByText('2 changes')).toBeTruthy();
    const tabs = within(bar()).getByRole('combobox', { name: 'Tab' }) as HTMLSelectElement;
    expect(tabs.value).toBe(TAB);
    click(within(bar()).getByRole('button', { name: 'Next change' }));
    await until(() => document.querySelector('.doc-change-current')?.textContent === 'First. ', 'the first tab’s change');
    click(within(bar()).getByRole('button', { name: 'Next change' }));
    await until(() => tabs.value === 'tab2' && document.querySelector('.doc-change-current')?.textContent === 'Second. ', 'the second tab’s change');
    click(within(bar()).getByRole('button', { name: 'Next change' })); // wraps to the first tab
    await until(() => tabs.value === TAB && document.querySelector('.doc-change-current')?.textContent === 'First. ', 'the wrap');
    expect(within(bar()).getByText('2 changes')).toBeTruthy();
  });
});


// M8 (X32): the header above the editor opens and closes its rails, and asks for Save version, from outside the body, so
// the shell holds the rail; the editor follows it and leaves history when the history rail goes.
describe('a rail the caller holds', () => {
  it('opens the history rail and its Save version form on request, and leaves history when the caller closes it', async () => {
    const { history: h, editor } = await setup(async ({ history: hist }) => {
      hist.version('named', HUMAN, { label: 'Clean draft' });
    });
    cleanup();
    const handle = openMemoryHandle(host!, { log: () => {}, actor: HUMAN });
    handles.push(handle);
    await whenSynced(handle);
    const changes: Array<string | null> = [];
    const shown: boolean[] = [];
    const mount = (rail: 'history' | 'comments' | null, saveVersionRequest?: number) => (
      <DocumentEditor
        artifactId="doc1"
        handle={handle}
        host={memoryEditorHost({ actor: HUMAN, name: 'Owner', color: '--author-2' })}
        history={h}
        rail={rail}
        onRailChange={(next) => changes.push(next)}
        saveVersionRequest={saveVersionRequest}
        onPreviewChange={(on) => shown.push(on)}
      />
    );
    const { rerender } = render(mount(null, 3));
    await until(() => screen.queryByRole('toolbar', { name: 'Formatting' }) !== null, 'the editor');
    expect(screen.queryByRole('complementary', { name: 'Version history' })).toBeNull(); // a request seen at mount is not new

    rerender(mount('history', 3));
    await until(() => within(rail()).queryAllByRole('button', { name: /^Version / }).length > 0, 'the version list');
    expect(screen.queryByRole('textbox', { name: 'Version name' })).toBeNull();
    rerender(mount('history', 4));
    expect(screen.getByRole('textbox', { name: 'Version name' })).toBeTruthy();

    click(row('Clean draft'));
    await previewing();
    expect(shown.at(-1)).toBe(true); // the header says read-only while a version shows
    rerender(mount(null, 4));
    await until(() => screen.queryByRole('toolbar', { name: 'Version preview' }) === null, 'history left');
    expect(shown.at(-1)).toBe(false);
    expect(screen.queryByRole('complementary', { name: 'Version history' })).toBeNull();

    // the editor's own toggles ask the caller
    click(within(toolbar()).getByRole('button', { name: 'Version history' }));
    expect(changes.at(-1)).toBe('history');
    expect(screen.queryByRole('complementary', { name: 'Version history' })).toBeNull(); // until the caller says so
    void editor;
  });

  // P3-F (8.2, F7): what the editor shows goes with the preview's report, so the header's Export exports it (the deck's
  // rule, L233): the version previewed, two compared, then the live document again.
  it('tells the caller which version a preview shows, that two are compared, and the live document once history is left', async () => {
    let first = 0;
    const { history: h } = await setup(async ({ history: hist, agentWrites }) => {
      await agentWrites(agentAppends(' Before the first.'));
      first = hist.version('named', HUMAN, { label: 'First' }).id;
      await agentWrites(agentAppends(' After the first.'));
      hist.version('named', HUMAN, { label: 'Third' });
    });
    cleanup();
    const handle = openMemoryHandle(host!, { log: () => {}, actor: HUMAN });
    handles.push(handle);
    await whenSynced(handle);
    const told: unknown[][] = [];
    const mount = (rail: 'history' | null) => (
      <DocumentEditor artifactId="doc1" handle={handle} host={memoryEditorHost({ actor: HUMAN, name: 'Owner', color: '--author-2' })} history={h} rail={rail} onRailChange={() => {}} onPreviewChange={(...args) => told.push(args)} />
    );
    const { rerender } = render(mount('history'));
    await until(() => screen.queryByRole('complementary', { name: 'Version history' }) !== null && within(rail()).queryAllByRole('button', { name: /^Version / }).length > 0, 'the version list');
    expect(told.at(-1)).toEqual([false, null]);
    click(row('First'));
    await previewing();
    expect(told.at(-1)).toEqual([true, { versionId: first }]);
    click(row('Third'), { shiftKey: true });
    await until(() => within(bar()).queryByText('First → Third') !== null, 'the comparison');
    expect(told.at(-1)).toEqual([true, 'compare']);
    rerender(mount(null));
    await until(() => screen.queryByRole('toolbar', { name: 'Version preview' }) === null, 'history left');
    expect(told.at(-1)).toEqual([false, null]);
  });

  it('asks for Save version from a closed rail: the rail opens on the form', async () => {
    const { history: h } = await setup();
    cleanup();
    const handle = openMemoryHandle(host!, { log: () => {}, actor: HUMAN });
    handles.push(handle);
    await whenSynced(handle);
    const changes: Array<string | null> = [];
    const mount = (rail: 'history' | 'comments' | null, saveVersionRequest: number) => (
      <DocumentEditor artifactId="doc1" handle={handle} host={memoryEditorHost({ actor: HUMAN, name: 'Owner', color: '--author-2' })} history={h} rail={rail} onRailChange={(next) => changes.push(next)} saveVersionRequest={saveVersionRequest} />
    );
    const { rerender } = render(mount(null, 0));
    await until(() => screen.queryByRole('toolbar', { name: 'Formatting' }) !== null, 'the editor');
    rerender(mount(null, 1));
    expect(changes).toEqual(['history']);
    rerender(mount('history', 1));
    await until(() => screen.queryByRole('textbox', { name: 'Version name' }) !== null, 'the Save version form');
  });
});
