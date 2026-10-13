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
import { createDocument, tabBody } from '../../tabs';
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
    expect(editor().isEditable).toBe(false);
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
    expect(liveText(editor())).toBe('first paragraph.The second paragraph. The agent adds this.The third paragraph.');

    click(within(bar()).getByRole('button', { name: 'Back to document' }));
    await until(() => screen.queryByRole('toolbar', { name: 'Formatting' }) !== null && editor().isEditable, 'the live document');
    expect(editor().can().undo()).toBe(false); // nothing of the preview is undoable
  });

  it('keeps the editor read-only through a StrictMode remount while a version shows (editable from history state)', async () => {
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
    expect(editor().isEditable).toBe(false);
    expect(editor().view.dom.getAttribute('contenteditable')).toBe('false');
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

  it('offers See N new changes after an agent changed the document since the last view, and opens that comparison', async () => {
    const t = { value: Date.now() - 60 * 60_000 };
    const { history: h, editor } = await setup(
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
    expect(editor().isEditable).toBe(false);
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
