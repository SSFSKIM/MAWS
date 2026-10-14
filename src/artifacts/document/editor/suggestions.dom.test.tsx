import type { Editor } from '@tiptap/core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyV1, applyV2, attributionMap, contentIdsOf, encodeMap, mergeMaps, newSuggestionDoc, planAccept, planReject, stateV2, transact, type Doc, type SuggestionRange } from '../../yjs';
import { applyEdit } from '../patch-writer';
import { nodeOf, pmOf } from '../writer.fixture';
import { DocumentEditor } from './DocumentEditor';
import type { DocumentHandle } from './host-types';
import { MemoryDocumentHost, memoryEditorHost, openMemoryHandle, whenSynced } from './memory-host';
import { Suggestions, type SuggestionHost } from './Suggestions';
import { World, doc, endOf, para, ticks, until } from './test-world';

let world: World | null = null;
let proposal: Doc | null = null;
const closing: Array<() => void> = [];
afterEach(() => { cleanup(); for (const close of closing.splice(0)) close(); proposal?.destroy(); world?.destroy(); proposal = null; world = null; });

const owner = memoryEditorHost({ actor: { kind: 'human' }, name: 'Owner', color: '--author-2' });

async function mount(kind: 'insert' | 'replace' | 'attrs' | 'retype' | 'none' = 'insert') {
  world = new World(doc(kind === 'attrs' ? { type: 'heading', attrs: { id: 'base', level: 2 }, content: [{ type: 'text', text: 'Original.' }] } : para('base', 'Original.')));
  const handle = await world.bare();
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
