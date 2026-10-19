import type { Editor } from '@tiptap/core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyV1, applyV2, attributionMap, contentIdsOf, encodeMap, mergeMaps, mergeUpdates, newDoc, newSuggestionDoc, onUpdate, planAccept, planReject, stateV2, transact, type Doc, type SuggestionRange } from '../../yjs';
import { applyEdit } from '../patch-writer';
import { schemaFor } from '../schema';
import { addTab } from '../tabs';
import { nodeOf, pmOf } from '../writer.fixture';
import { DocumentEditor } from './DocumentEditor';
import type { DocumentHandle } from './host-types';
import { MemoryDocumentHost, memoryEditorHost, openMemoryHandle, whenSynced } from './memory-host';
import { Suggestions, type SuggestionHost } from './Suggestions';
import { World, doc, endOf, para, readOnlySwitch, ticks, until } from './test-world';

let world: World | null = null;
let proposal: Doc | null = null;
const closing: Array<() => void> = [];
afterEach(() => { cleanup(); for (const close of closing.splice(0)) close(); proposal?.destroy(); world?.destroy(); proposal = null; world = null; });

const owner = memoryEditorHost({ actor: { kind: 'human' }, name: 'Owner', color: '--author-2' });

async function mount(kind: 'insert' | 'replace' | 'attrs' | 'retype' | 'none' = 'insert', wrap: (handle: DocumentHandle) => DocumentHandle = (handle) => handle) {
  world = new World(doc(kind === 'attrs' ? { type: 'heading', attrs: { id: 'base', level: 2 }, content: [{ type: 'text', text: 'Original.' }] } : para('base', 'Original.')));
  const handle = wrap(await world.bare());
  proposal = newSuggestionDoc();
  applyV2(proposal, stateV2(handle.doc));
  let update: Uint8Array | null = null;
  proposal.on('update', (bytes: Uint8Array) => { update = bytes; });
  if (kind !== 'none') applyEdit(proposal, kind === 'insert' ? [{ op: 'insert', after: 'base', markdown: 'Proposed. ^proposal' }] : [{ op: 'replace_block', id: 'base', markdown: kind === 'attrs' || kind === 'retype' ? '### Original.' : 'Proposed.' }]);
  const attribution = update ? attributionMap(contentIdsOf(update), { insertActor: 'session:agent', deleteActor: 'session:agent', at: Date.now() }) : mergeMaps([]);
  const map = encodeMap(attribution);
  const close = vi.fn();
  const host: SuggestionHost = {
    open: vi.fn(async () => ({ ...handle, doc: proposal!, close })),
    attributions: vi.fn(async () => map),
    acceptSuggestion: vi.fn(async () => ({ revision: 2 })),
    rejectSuggestion: vi.fn(async () => ({ revision: 2 })),
  };
  const item = nodeOf(proposal, kind === 'insert' ? 'proposal' : 'base')._item!.id;
  const range = { start: { client: item.client, clock: item.clock }, end: { client: item.client, clock: item.clock } };
  const onPending = vi.fn();
  const mounted = render(<Suggestions artifactId="doc1" tabId="t1" base={handle} host={host} editorHost={owner} onPending={onPending} />);
  await until(() => kind === 'none' ? onPending.mock.calls.length > 0 : screen.queryByRole('button', { name: 'Accept suggestion 1' }) !== null, 'the proposed block to render');
  return { host, range, mounted, close, handle, attribution };
}

describe('document suggestion review', () => {
  // The whole-branch review's P2: Accept and Reject write the document, so they follow the base's read-only state.
  it('offers Accept and Reject only while the store is writable, following its read-only state', async () => {
    let switched: ReturnType<typeof readOnlySwitch> | null = null;
    await mount('insert', (handle) => (switched = readOnlySwitch(handle)).handle);
    const accept = () => screen.getByRole('button', { name: 'Accept suggestion 1' });
    const reject = () => screen.getByRole('button', { name: 'Reject suggestion 1' });
    expect([accept(), reject()].map((button) => (button as HTMLButtonElement).disabled)).toEqual([false, false]);
    act(() => switched!.set(true));
    expect([accept(), reject()].map((button) => (button as HTMLButtonElement).disabled)).toEqual([true, true]);
    act(() => switched!.set(false));
    expect([accept(), reject()].map((button) => (button as HTMLButtonElement).disabled)).toEqual([false, false]);
  });

  it.each(['Accept', 'Reject'] as const)('%s sends the binding’s item-id block range to the host', async (action) => {
    const { host, range } = await mount();
    expect(host.open).toHaveBeenCalledWith('doc1', { doc: 'suggestions' });
    expect(host.attributions).toHaveBeenCalledWith('doc1', 0, Number.MAX_SAFE_INTEGER, { doc: 'suggestions' });
    expect(screen.getByLabelText('Suggested document').textContent).toContain('Proposed.');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: `${action} suggestion 1` })); });
    expect(action === 'Accept' ? host.acceptSuggestion : host.rejectSuggestion).toHaveBeenCalledWith('doc1', [range]);
  });

  it.each(['replace', 'attrs', 'retype'] as const)('maps an existing block’s %s change to a range A can accept', async (kind) => {
    const { host, handle, attribution } = await mount(kind);
    const expected = pmOf(proposal!, 'base').toJSON();
    expect(screen.getByRole('combobox', { name: 'Suggested block' }).querySelectorAll('option')).toHaveLength(1);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Accept suggestion 1' })); });
    const ranges = vi.mocked(host.acceptSuggestion).mock.calls[0]?.[1] as SuggestionRange[];
    expect(ranges?.length).toBeGreaterThan(0);
    const plan = planAccept(handle.doc, proposal!, attribution, ranges);
    expect(plan.edit).not.toBeNull();
    transact(handle.doc, () => plan.edit!(handle.doc));
    expect(pmOf(handle.doc, 'base').toJSON()).toEqual(expected);
  });

  it('removes an accepted insertion from review after the service copies it and withdraws the original', async () => {
    const { host, handle, attribution } = await mount();
    vi.mocked(host.acceptSuggestion).mockImplementation(async (_id, ranges) => {
      const plan = planAccept(handle.doc, proposal!, attribution, ranges);
      transact(handle.doc, () => plan.edit?.(handle.doc));
      if (plan.remove) applyV1(proposal!, plan.remove);
      return { revision: 2 };
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Accept suggestion 1' })); });
    await until(() => screen.queryByLabelText('Suggestion review') === null, 'accepted originals to leave the review');
    expect(pmOf(handle.doc, 'proposal').textContent).toBe('Proposed.');
  });

  it('does not fetch attribution or build a review for ordinary typing with no proposals', async () => {
    const { host, handle } = await mount('none');
    const reads = vi.mocked(host.attributions).mock.calls.length;
    act(() => { applyEdit(handle.doc, [{ op: 'replace_text', block: 'base', old: 'Original.', new: 'The owner typed.' }]); });
    await act(async () => { await ticks(10); });
    expect(host.attributions).toHaveBeenCalledTimes(reads);
    expect(screen.queryByLabelText('Suggestion review')).toBeNull();
  });

  // M9 addendum fix wave: the renderer's coverage keeps settled proposals (withdrawn inserts), so the fast path reads
  // what the review lists, not that coverage: typing after the last proposal is accepted or rejected costs nothing.
  it.each(['Accept', 'Reject'] as const)('does not fetch attribution for typing after the last proposal is settled by %s', async (action) => {
    const { host, handle, attribution } = await mount();
    const settle = async (_id: string, ranges: SuggestionRange[]) => {
      const plan = (action === 'Accept' ? planAccept : planReject)(handle.doc, proposal!, attribution, ranges);
      if (plan.edit) transact(handle.doc, () => plan.edit!(handle.doc));
      if (plan.remove) applyV1(proposal!, plan.remove);
      return { revision: 2 };
    };
    vi.mocked(action === 'Accept' ? host.acceptSuggestion : host.rejectSuggestion).mockImplementation(settle);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: `${action} suggestion 1` })); });
    await until(() => screen.queryByLabelText('Suggestion review') === null, 'the settled proposal to leave the review');
    await act(async () => { await ticks(10); });
    const reads = vi.mocked(host.attributions).mock.calls.length;
    for (const word of ['one', 'two', 'three']) {
      act(() => { applyEdit(handle.doc, [{ op: 'replace_text', block: 'base', old: 'Original.', new: `Original ${word}.` }]); });
      act(() => { applyEdit(handle.doc, [{ op: 'replace_text', block: 'base', old: `Original ${word}.`, new: 'Original.' }]); });
    }
    await act(async () => { await ticks(10); });
    expect(host.attributions).toHaveBeenCalledTimes(reads);
    expect(screen.queryByLabelText('Suggestion review')).toBeNull();
  });

  it.each(['insert', 'delete'] as const)('a new %s proposal after the last one settled is reviewed again', async (kind) => {
    const { host, handle, attribution } = await mount();
    vi.mocked(host.rejectSuggestion).mockImplementation(async (_id, ranges) => {
      const plan = planReject(handle.doc, proposal!, attribution, ranges);
      if (plan.remove) applyV1(proposal!, plan.remove);
      return { revision: 2 };
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reject suggestion 1' })); });
    await until(() => screen.queryByLabelText('Suggestion review') === null, 'the rejected proposal to leave the review');
    const reads = vi.mocked(host.attributions).mock.calls.length;
    act(() => { applyEdit(proposal!, [kind === 'insert' ? { op: 'insert', after: 'base', markdown: 'Another proposal. ^again' } : { op: 'replace_text', block: 'base', old: 'Original.', new: 'Orig.' }]); });
    await until(() => vi.mocked(host.attributions).mock.calls.length > reads, 'the new proposal to be read');
    await until(() => screen.queryByLabelText('Suggestion review') !== null, 'the new proposal to be reviewed');
    expect(screen.getByLabelText('Suggested document').textContent).toContain(kind === 'insert' ? 'Another proposal.' : 'Orig.');
  });

  it('closes its suggestion replica when the review unmounts', async () => {
    const { mounted, close } = await mount();
    mounted.unmount();
    expect(close).toHaveBeenCalledOnce();
  });

  // P3-F panel scalpel-3#1: the review's page reads its ground as the live page does (usePageGround), so code on a dark
  // ground takes shiki's dark colours there too
  it('gives the review’s page its ground: dark on a dark page, light again on a light one', async () => {
    const ground = document.head.appendChild(document.createElement('style'));
    ground.textContent = '.ds-doc { background-color: rgb(31, 30, 27); }';
    try {
      await mount();
      const page = screen.getByLabelText('Suggested document').closest<HTMLElement>('.ds-doc')!;
      expect(page.dataset.ground).toBe('dark');
      ground.remove();
      await until(() => page.dataset.ground === 'light', 'the light ground');
    } finally {
      ground.remove();
    }
  });

  // P3-F panel scalpel-4#1: the suggestion replica is the artifact's, not the tab's: a document-tab switch keeps its port
  // and the review state, so a review on screen shows the new tab's proposal on its first read (no settle window anew)
  it('keeps its replica and its review state across a document-tab switch', async () => {
    world = new World(doc(para('base', 'Original.')));
    world.host.write((d) => void addTab(d, { title: 'Second', id: 't2', body: schemaFor().nodeFromJSON(doc(para('b2', 'Second.'))) }));
    const handle = await world.bare();
    proposal = newSuggestionDoc();
    applyV2(proposal, stateV2(handle.doc));
    const updates: Uint8Array[] = [];
    proposal.on('update', (bytes: Uint8Array) => void updates.push(bytes));
    applyEdit(proposal, [{ op: 'insert', after: 'base', markdown: 'Proposed first. ^one' }]);
    applyEdit(proposal, [{ op: 'insert', after: 'b2', markdown: 'Proposed second. ^two' }]);
    const map = encodeMap(attributionMap(contentIdsOf(mergeUpdates(updates)), { insertActor: 'session:agent', deleteActor: 'session:agent', at: Date.now() }));
    const close = vi.fn();
    const host: SuggestionHost = {
      open: vi.fn(async () => ({ ...handle, doc: proposal!, close })),
      attributions: vi.fn(async () => map),
      acceptSuggestion: vi.fn(async () => ({ revision: 2 })),
      rejectSuggestion: vi.fn(async () => ({ revision: 2 })),
    };
    const onPending = vi.fn(); // one callback, as DocumentEditor's state setter is
    const shown = (tabId: string) => <Suggestions artifactId="doc1" tabId={tabId} base={handle} host={host} editorHost={owner} onPending={onPending} />;
    const reviewed = () => screen.queryByLabelText('Suggested document')?.textContent ?? '';
    const { rerender } = render(shown('t1'));
    await until(() => reviewed().includes('Proposed first.'), 't1’s review');
    const reads = vi.mocked(host.attributions).mock.calls.length;
    rerender(shown('t2'));
    await until(() => reviewed().includes('Proposed second.'), 't2’s review');
    expect(host.open, 'replicas opened').toHaveBeenCalledOnce();
    expect(close, 'the replica closed').not.toHaveBeenCalled();
    expect(vi.mocked(host.attributions).mock.calls.length - reads, 'reads before t2’s review').toBe(1);
    expect(reviewed()).not.toContain('Proposed first.');
    rerender(shown('t1'));
    await until(() => reviewed().includes('Proposed first.'), 't1’s review again');
    expect(host.open).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
  });
});

// M9 addendum fix wave (the scale gate's Korean case): the live editor's composition hold buffers remote updates on the
// base replica; the suggestion replica, fed the same main updates by the host, must hold with it, or the agent's held
// writes read as proposals over the lagging base, the review replaces the live editor mid-composition and the
// composed text lands at the block's start.
describe('the composition hold and the suggestion replica', () => {
  it('a remote write held from the live editor during a composition is no proposal: no review, the live editor stays', async () => {
    world = new World(doc(para('p1', 'Mine.'), para('p2', 'Theirs.')));
    const handle = openMemoryHandle(world.host, { log: () => {} });
    closing.push(() => handle.close());
    await whenSynced(handle);
    // the host's suggestion doc: the main doc's state, then every main update flowing in (A's `inStep`)
    const suggestionHost = new MemoryDocumentHost();
    closing.push(() => suggestionHost.destroy());
    applyV2(suggestionHost.doc, stateV2(world.host.doc));
    closing.push(world.host.onLanded(({ update }) => applyV1(suggestionHost.doc, update)));
    let replica: DocumentHandle | null = null;
    const host: SuggestionHost = {
      open: vi.fn(async () => {
        const opened = openMemoryHandle(suggestionHost, { log: () => {} });
        await whenSynced(opened);
        replica = opened;
        return opened;
      }),
      attributions: vi.fn(async () => encodeMap(mergeMaps([]))),
      acceptSuggestion: vi.fn(async () => ({ revision: 2 })),
      rejectSuggestion: vi.fn(async () => ({ revision: 2 })),
    };
    const previewing: boolean[] = [];
    let live: Editor | null = null;
    render(<DocumentEditor artifactId="doc1" handle={handle} host={owner} suggestions={host} onPreviewChange={(on) => previewing.push(on)} onEditor={(editor) => (live = editor)} />);
    await until(() => live !== null && live.getText().length > 0 && vi.mocked(host.attributions).mock.calls.length > 0, 'the live editor and the first review check');
    await act(async () => { await ticks(5); });
    const editor = live as unknown as Editor;
    const p2 = (d: Doc) => pmOf(d, 'p2').textContent;
    act(() => { editor.commands.setTextSelection(endOf(editor, 'p1')); });
    act(() => { editor.view.dom.dispatchEvent(new Event('compositionstart', { bubbles: true })); });
    world.host.write((d) => void applyEdit(d, [{ op: 'replace_text', block: 'p2', old: 'Theirs.', new: 'Theirs, edited.' }]), { kind: 'session', appSessionId: 'agent' } as never);
    await until(() => p2(suggestionHost.doc) === 'Theirs, edited.', 'the write in the suggestion doc');
    await act(async () => { await ticks(20); });
    expect(p2(handle.doc), 'the base holds the write').toBe('Theirs.');
    expect(screen.queryByLabelText('Suggestion review')).toBeNull();
    expect(previewing).not.toContain(true);
    act(() => { editor.view.dom.dispatchEvent(new Event('compositionend', { bubbles: true })); });
    await until(() => p2(handle.doc) === 'Theirs, edited.' && replica !== null && p2((replica as DocumentHandle).doc) === 'Theirs, edited.', 'both replicas after the hold');
    await act(async () => { await ticks(20); });
    expect(screen.queryByLabelText('Suggestion review')).toBeNull();
    expect(previewing).not.toContain(true);
  });
});

// M9 follow-up (Decision Log 51): the live editor and the suggestion replica as DocumentEditor holds them, over a main
// host and a suggestion host fed every main update (A's `inStep`).
async function mountLive(options: { openAfter?: Promise<void> } = {}) {
  world = new World(doc(para('p1', 'Mine.'), para('p2', 'Theirs.')));
  const handle = openMemoryHandle(world.host, { log: () => {} });
  closing.push(() => handle.close());
  await whenSynced(handle);
  const suggestionHost = new MemoryDocumentHost();
  closing.push(() => suggestionHost.destroy());
  applyV2(suggestionHost.doc, stateV2(world.host.doc));
  closing.push(world.host.onLanded(({ update }) => applyV1(suggestionHost.doc, update)));
  let replica: (DocumentHandle & { provider: unknown }) | null = null;
  const host: SuggestionHost = {
    open: vi.fn(async () => {
      await options.openAfter;
      const opened = openMemoryHandle(suggestionHost, { log: () => {} });
      await whenSynced(opened);
      replica = opened;
      return opened;
    }),
    attributions: vi.fn(async () => encodeMap(mergeMaps([]))),
    acceptSuggestion: vi.fn(async () => ({ revision: 2 })),
    rejectSuggestion: vi.fn(async () => ({ revision: 2 })),
  };
  const previewing: boolean[] = [];
  let live: Editor | null = null;
  render(<DocumentEditor artifactId="doc1" handle={handle} host={owner} suggestions={host} onPreviewChange={(on) => previewing.push(on)} onEditor={(editor) => (live = editor)} />);
  await until(() => live !== null && live.getText().length > 0 && (options.openAfter !== undefined || (replica !== null && vi.mocked(host.attributions).mock.calls.length > 0)), 'the live editor and the first review check');
  await act(async () => { await ticks(5); });
  /** Content frames the suggestion replica has sent its host. */
  const replicaFrames = () => (replica as unknown as { provider: { sent: number } }).provider.sent;
  return { handle, suggestionHost, host, previewing, editor: live as unknown as Editor, replicaFrames, replica: () => replica };
}

describe('the typing pause (M9 follow-up)', () => {
  const keystroke = (editor: Editor, text: string) => act(() => {
    fireEvent.keyDown(editor.view.dom, { key: text });
    editor.commands.insertContent(text);
  });
  const propose = (suggestionHost: MemoryDocumentHost) => suggestionHost.write((d) => void applyEdit(d, [{ op: 'insert', after: 'p2', markdown: 'Proposed. ^prop' }]));

  it('a proposal arriving within a second of a keystroke waits: the live editor stays mounted and focused until a second passes with no keystroke', async () => {
    const { suggestionHost, previewing, editor } = await mountLive();
    act(() => { editor.chain().focus().setTextSelection(endOf(editor, 'p1')).run(); });
    keystroke(editor, 'a');
    propose(suggestionHost);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 500)); });
    keystroke(editor, 'b'); // still typing: the wait restarts
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 700)); });
    expect(screen.queryByLabelText('Suggestion review'), 'the review while the person types').toBeNull();
    expect(previewing).not.toContain(true);
    expect(editor.isFocused, 'the live editor keeps focus').toBe(true);
    expect((editor.view.dom.closest('.doc-tab-editor') as HTMLElement).style.display).not.toBe('none');
    expect(pmOf(world!.host.doc, 'p1').textContent).toBe('Mine.ab');
    await until(() => screen.queryByLabelText('Suggestion review') !== null, 'the review at the pause');
    expect(screen.getByLabelText('Suggested document').textContent).toContain('Proposed.');
    expect(previewing).toContain(true);
  });

  it('with no keystroke for a second, a proposal is reviewed at once', async () => {
    const { suggestionHost, editor } = await mountLive();
    keystroke(editor, 'a');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1_050)); });
    const at = Date.now();
    propose(suggestionHost);
    await until(() => screen.queryByLabelText('Suggestion review') !== null, 'the review');
    expect(Date.now() - at).toBeLessThan(500);
  });
});

// The whole-branch review's follow-up (Decision Log 51(a)'s window): another replica's typing reaches the suggestion
// replica before the base replica, so for a moment the suggestion doc holds text the base lacks. That is no proposal: the
// review opens only once the difference has held for the settle window with the base caught up.
describe('another replica’s typing reaching the suggestion replica before the base', () => {
  it('opens no review while the base catches up; a real proposal is still reviewed, after the settle', async () => {
    const { suggestionHost, host, previewing } = await mountLive();
    let map = mergeMaps([]);
    vi.mocked(host.attributions).mockImplementation(async () => encodeMap(map));
    // another replica types in p2; the host has it attributed (the main map beneath the suggestion's)
    const typist = newDoc();
    applyV2(typist, stateV2(world!.host.doc));
    const updates: Uint8Array[] = [];
    const off = onUpdate(typist, (update) => updates.push(update));
    applyEdit(typist, [{ op: 'replace_text', block: 'p2', old: 'Theirs.', new: 'Theirs, typed.' }]);
    off();
    typist.destroy();
    const typed = mergeUpdates(updates);
    map = attributionMap(contentIdsOf(typed), { insertActor: 'human', deleteActor: 'human', at: Date.now() });
    // the suggestion doc first, the base 150 ms later
    act(() => applyV1(suggestionHost.doc, typed));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });
    act(() => world!.host.write((d) => applyV1(d, typed)));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 500)); });
    expect(screen.queryByLabelText('Suggestion review'), 'a review of the other replica’s typing').toBeNull();
    expect(previewing).not.toContain(true);

    const proposing = onUpdate(suggestionHost.doc, (update) => {
      map = mergeMaps([map, attributionMap(contentIdsOf(update), { insertActor: 'session:agent', deleteActor: 'session:agent', at: Date.now() })]);
    });
    const at = Date.now();
    suggestionHost.write((d) => void applyEdit(d, [{ op: 'insert', after: 'p2', markdown: 'Proposed. ^prop' }]));
    proposing();
    await until(() => screen.queryByLabelText('Suggestion review') !== null, 'the review of the proposal');
    expect(Date.now() - at, 'held for the settle window').toBeGreaterThanOrEqual(250);
    expect(screen.getByLabelText('Suggested document').textContent).toContain('Proposed.');
  });
});

describe('the base reaches the suggestion doc through the host only (M9 follow-up)', () => {
  it('typing in the live editor sends the suggestion replica no frame', async () => {
    const { editor, handle, suggestionHost, replicaFrames } = await mountLive();
    const before = replicaFrames();
    act(() => { editor.chain().focus().setTextSelection(endOf(editor, 'p1')).run(); });
    for (const ch of 'typed') act(() => void editor.commands.insertContent(ch));
    await until(() => pmOf(suggestionHost.doc, 'p1').textContent === 'Mine.typed', 'the typing in the suggestion doc through the host');
    await act(async () => { await ticks(10); });
    expect(pmOf(handle.doc, 'p1').textContent).toBe('Mine.typed');
    expect(replicaFrames() - before, 'frames from the suggestion replica').toBe(0);
  });
});

// M9 follow-up (the re-review's probe): the suggestion replica opens while the person composes and an agent's write
// lands in between; the replica joins the hold only after its sync, already holding the write the base holds back, so
// the first review check would read it as a proposal. The first review goes through the typing pause too.
describe('the first review check while the person composes (M9 follow-up)', () => {
  it('a replica that opens mid-composition with a write the base holds back shows no review; none appears once the base catches up', async () => {
    let open!: () => void;
    const openAfter = new Promise<void>((resolve) => (open = resolve));
    const { handle, suggestionHost, host, previewing, editor, replica } = await mountLive({ openAfter });
    const p2 = (d: Doc) => pmOf(d, 'p2').textContent;
    act(() => { editor.chain().focus().setTextSelection(endOf(editor, 'p1')).run(); });
    act(() => { editor.view.dom.dispatchEvent(new Event('compositionstart', { bubbles: true })); });
    world!.host.write((d) => void applyEdit(d, [{ op: 'replace_text', block: 'p2', old: 'Theirs.', new: 'Theirs, edited.' }]), { kind: 'session', appSessionId: 'agent' } as never);
    await until(() => p2(suggestionHost.doc) === 'Theirs, edited.', 'the write in the suggestion doc');
    open();
    await until(() => replica() !== null && vi.mocked(host.attributions).mock.calls.length > 0, 'the replica opened and first checked');
    await act(async () => { await ticks(20); });
    expect(editor.view.composing, 'still composing').toBe(true);
    expect(p2(handle.doc), 'the base holds the write').toBe('Theirs.');
    expect(screen.queryByLabelText('Suggestion review')).toBeNull();
    expect(previewing).not.toContain(true);
    act(() => { editor.view.dom.dispatchEvent(new Event('compositionend', { bubbles: true })); });
    await until(() => p2(handle.doc) === 'Theirs, edited.', 'the base after the hold');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1_200)); });
    expect(screen.queryByLabelText('Suggestion review')).toBeNull();
    expect(previewing).not.toContain(true);
  });
});
