// The history rail in DocumentEditor (M5 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D10; §4.7 of the
// parent; happy-dom over the in-memory host and history, real ports): the list by day with runs folded, author chips
// in --author-N and Named only; Save version; the preview read-only in the authors' colours with "N changes" ↑ ↓ and
// Show changes, moved and retyped blocks labelled, the version's pinned tokens; Restore leaving history with undo cleared
// and the banner; Make a copy; Compare by shift-click; the "See N new changes" pill; Show editors on a selection.
import type { Editor } from '@tiptap/core';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { actorDisplay, type Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import { applyEdit } from '../../patch-writer';
import { schemaFor } from '../../schema';
import { addTab, createDocument, deleteTab, renameTab, tabBody } from '../../tabs';
import { isBindingTransaction } from '../../../yjs';
import { ynodeToPmnode } from '../../../yjs/prosemirror';
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
  render(wrap(<DocumentEditor artifactId="doc1" handle={handle} host={memoryEditorHost({ actor: HUMAN, name: 'Owner', color: '--author-2' })} history={history} onEditor={(e) => (editor = e)} />));
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
    const now = Date.now();
    const at = { value: now - 3 * DAY };
    await setup(
      async ({ history: h, agentWrites }) => {
        h.version('auto', HUMAN);
        at.value = now - DAY;
        await agentWrites(agentAppends(' One.'));
        h.version('turn', AGENT, { summary: 'Appended one sentence' });
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

    click(within(bar()).getByRole('button', { name: 'Back to document' }));
    await until(() => screen.queryByRole('toolbar', { name: 'Formatting' }) !== null && previewEditor() === null, 'the live document');
    expect(rebound).toBe(0);
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
      h.version('turn', AGENT, { summary: 'Two edits' });
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
      hist.version('turn', AGENT, { summary: 'Moved and retyped' });
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
    expect(screen.getByText('A copy of this version was made.')).toBeTruthy();
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
        hist.version('turn', AGENT, { summary: 'Two additions' });
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
});

// M5's fix wave 1: what the review found missing, through the rail.
describe('a deleted tab and a failed count', () => {
  it('lists a tab the agent deleted in the preview’s tabs, and shows its text as deleted', async () => {
    await setup(async ({ host: h, history: hist }) => {
      h.write((doc) => addTab(doc, { title: 'Appendix', id: 'tab2', body: schemaFor().nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'x1' }, content: [{ type: 'text', text: 'Raw numbers live here.' }] }] }) }));
      hist.version('named', HUMAN, { label: 'Two tabs' });
      h.write((doc) => deleteTab(doc, 'tab2'), AGENT);
      hist.version('turn', AGENT, { summary: 'Deleted the appendix' });
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
        hist.version('turn', AGENT, { summary: 'One addition' });
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
      hist.version('turn', AGENT, { summary: 'Renamed the tab' });
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
      hist.version('turn', AGENT, { summary: 'Two tabs edited' });
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
