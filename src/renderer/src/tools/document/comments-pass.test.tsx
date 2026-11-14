// UX wave U5a (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, M3, decision 17), over the real editor and a
// tab's state: a document's unsent comment lives in the card's pass, and its thread lives exactly as long as the comment
// is in the pass. Hidden and shown again, the comment and its thread stay; the person's discard withdraws them; the
// tab's close asks about it. A tab closed while a comment is in flight withdraws its ordinary draft at once and leaves
// the comment in flight its thread, its replica hold and its settlement: success records the message under its mark, a
// refusal withdraws both, and the replica closes once all is written.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { select } from '@artifacts/document/editor/comments/test-support';
import { DocumentEditor } from '@artifacts/document/editor/DocumentEditor';
import type { DocumentHandle } from '@artifacts/document/editor/host-types';
import { MemoryDocumentHost, memoryEditorHost, openMemoryHandle, whenSynced } from '@artifacts/document/editor/memory-host';
import { doc, para, ticks, until } from '@artifacts/document/editor/test-world';
import { schemaFor } from '@artifacts/document/schema';
import { createDocument } from '@artifacts/document/tabs';
import { getThread, liveThreadIds } from '@artifacts/document/threads';
import type { ArtifactHost } from '@artifacts/host';
import type { AppSessionId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { record, status } from '../../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { at } from '../../../../../test/support/machine';
import { holdArtifactEditorState, releaseArtifactEditorState, type ArtifactEditor } from '../../artifacts/registry';
import { cardHostEntry, resetPlaceNotes, useCommentCard } from '../../side/card/store';
import { openComment } from '../../side/register';
import { useSessions } from '../../stores/sessions';
import { resetShellStores } from '../../test-support/shell-stores';
import { registerCommentComposer } from '../code/anchor/anchor';
import { commentDraftOf } from './comment-drafts';
import { useDocumentComments } from './comments';
import { DocumentTabState, type DocumentTabDeps } from './tab-state';

const PARENT = at('a1111111-1111-4111-8111-111111111111' as AppSessionId);
const A = '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e';
const SCOPE = { surface: 'panel', tabId: 'artifact-tab-1' } as const;
const owner = memoryEditorHost({ actor: { kind: 'human' }, name: 'Owner', color: '--author-2' });

let fake: FakeClient;
let offComposer = () => {};
let memory: MemoryDocumentHost;
beforeEach(() => {
  resetShellStores();
  resetPlaceNotes();
  fake = fakeClient({ 'session.intent.get': null, 'session.queue.list': { entries: [], paused: false } });
  window.maws = fake.client as unknown as PreloadBridge;
  offComposer = registerCommentComposer(openComment);
  const s = useSessions.getState();
  useSessions.setState({ records: new Map([[PARENT, record(PARENT, { title: { text: 'Q3 plan', source: 'user' } })]]), engine: new Map([[PARENT, status(PARENT, { process: 'ready' } as never)]]), recordsVersion: s.recordsVersion + 1 });
  memory = new MemoryDocumentHost();
  memory.write((d) => createDocument(d, { title: 'Draft', body: schemaFor().nodeFromJSON(doc(para('p1', 'The plan ships quarterly.'))) }));
});
afterEach(() => {
  cleanup();
  offComposer();
  releaseArtifactEditorState(SCOPE);
  resetPlaceNotes();
  useCommentCard.setState({ open: null });
  memory.destroy();
  delete (window as { maws?: unknown }).maws;
});

// The tab: its state held through the registry, as a surface holds it, and its body over that state.
async function openTab(confirm: () => boolean = () => false) {
  let tabHandle: (DocumentHandle & { closed?: boolean }) | null = null;
  const deps = {
    host: {
      ...owner,
      open: async () => {
        const opened = openMemoryHandle(memory, { log: () => {} });
        const close = opened.close.bind(opened);
        tabHandle = Object.assign(opened, { close: () => ((tabHandle!.closed = true), close()) });
        await whenSynced(opened);
        return opened;
      },
      versionState: async () => new Uint8Array(),
      attributions: async () => new Uint8Array(),
      acceptSuggestion: async () => ({ revision: 1 }),
      rejectSuggestion: async () => ({ revision: 1 }),
    } as unknown as ArtifactHost,
    ipc: { invoke: async () => ({ ok: true, value: { artifact: { id: A, kind: 'document', title: 'Draft', lastViewedAt: null, revision: 1 } } }), on: () => () => {} } as unknown as DocumentTabDeps['ipc'],
    log: () => {},
    confirm,
    sessionTitle: () => undefined,
    sessions: () => [],
  } as DocumentTabDeps;
  const editor: ArtifactEditor<DocumentTabState> = { Panel: () => null, createState: (target) => new DocumentTabState(target, deps), dispose: (state) => state.dispose() };
  const { state } = holdArtifactEditorState(SCOPE, A, 'document', editor);
  await until(() => state.snapshot().ready, 'the tab to open');
  // M3's review, finding 4: every hold of the replica is counted, and each release, so a second release shows
  const holds = { taken: 0, released: 0, twice: 0 };
  const holdReplica = () => {
    holds.taken += 1;
    const release = state.hold();
    let done = false;
    return () => {
      if (done) holds.twice += 1;
      else holds.released += 1;
      done = true;
      release();
    };
  };
  let current: Editor | null = null;
  function Surface() {
    const comments = useDocumentComments({ artifactId: A, appSessionId: PARENT, title: 'Draft', holdReplica, hostId: state.commentHostId });
    return <DocumentEditor artifactId={A} handle={tabHandle!} host={owner} comments={comments} onEditor={(e) => (current = e)} />;
  }
  const view = render(<Surface />);
  await until(() => current !== null && current.getText().includes('quarterly'), 'the editor to bind');
  const comment = async (passage: string, text: string): Promise<string> => {
    act(() => void select(current!, passage));
    act(() => fireEvent.click(within(screen.getByRole('toolbar', { name: 'Formatting' })).getByRole('button', { name: 'Add comment' })));
    await until(() => document.querySelector('[data-comment-card] textarea') !== null, 'the card');
    fireEvent.change(screen.getByRole('textbox', { name: 'Comment' }), { target: { value: text } });
    const open = useCommentCard.getState().open!;
    return open.target?.kind === 'artifact' ? open.target.threadId : '';
  };
  // each settlement a send of the card's host is told, counted as it is told (the host's registration, wrapped)
  const settled: boolean[] = [];
  const countSettlements = () => {
    const entry = cardHostEntry(state.commentHostId)!;
    const sending = entry.sending!;
    entry.sending = (comment, how) => {
      const settle = sending(comment, how);
      return (went) => {
        settled.push(went);
        settle(went);
      };
    };
  };
  return { state, view, comment, handle: () => tabHandle!, hide: () => view.rerender(<></>), show: () => view.rerender(<Surface />), holds, settled, countSettlements };
}
const card = () => document.querySelector<HTMLElement>('[data-comment-card]');
const messages = (d: DocumentHandle['doc'], threadId: string) => getThread(d, threadId)?.messages.map((m) => m.body) ?? null;

describe('a document’s unsent comment', () => {
  it('survives its tab being hidden and shown, with its thread; the person’s Close withdraws them', async () => {
    const tab = await openTab();
    const threadId = await tab.comment('ships quarterly', 'Monthly?');
    tab.hide();
    await act(() => ticks(4));
    expect(commentDraftOf(A)).toEqual({ threadId, text: 'Monthly?' });
    expect(getThread(tab.handle().doc, threadId)).not.toBeNull();
    tab.show();
    await act(() => ticks(4));
    fireEvent.click(document.querySelector<HTMLElement>('[data-unsent-chip]')!);
    expect((screen.getByRole('textbox', { name: 'Comment' }) as HTMLTextAreaElement).value).toBe('Monthly?');
    fireEvent.click(within(card()!).getByRole('button', { name: 'Close' }));
    expect(getThread(tab.handle().doc, threadId)).toBeNull();
    expect(liveThreadIds(tab.handle().doc).has(threadId)).toBe(false);
  });

  it('the tab’s close guard asks about it', async () => {
    let asked = 0;
    const tab = await openTab(() => ((asked += 1), false));
    await tab.comment('ships quarterly', 'Monthly?');
    tab.hide();
    expect(await tab.state.closeGuard()).toBe(false);
    expect(asked).toBe(1);
  });
});

// decision 17, each route's promise held open as the tab closes
describe('a document tab closed during a flight', () => {
  const routes = [
    { name: 'ticked, the content held', ticked: true, held: 'side.comment.content' as const },
    { name: 'ticked, the send held', ticked: true, held: 'session.send' as const },
    { name: 'unchecked, the side thread held', ticked: false, held: 'side.thread.open' as const },
  ];
  for (const route of routes)
    for (const outcome of ['went', 'refused'] as const) {
      it(`${route.name}: ${outcome === 'went' ? 'the thread keeps the message under its mark' : 'neither thread nor mark is left'}; the draft beside it is withdrawn at the close`, async () => {
        const tab = await openTab();
        const sent = await tab.comment('ships quarterly', 'Monthly?');
        if (route.ticked) fireEvent.click(screen.getByRole('checkbox', { name: 'Send to main' }));
        tab.countSettlements();
        fireEvent.click(within(card()!).getByRole('button', { name: 'Send' }));
        if (route.held === 'session.send') await act(() => fake.reply('side.comment.content', { content: [{ type: 'text', text: 'the built message' }] }));
        const draft = await tab.comment('The plan', 'Draft beside it');
        const ydoc = tab.handle().doc;
        // the tab closes: its state is given back (L disposes it), then its body unmounts
        releaseArtifactEditorState(SCOPE);
        tab.view.unmount();
        await act(() => ticks(4));
        expect(getThread(ydoc, draft), 'the ordinary draft is withdrawn at the close').toBeNull();
        expect(getThread(ydoc, sent), 'the comment in flight keeps its thread').not.toBeNull();
        expect(tab.handle().closed, 'the flight holds the replica').not.toBe(true);
        if (outcome === 'went') {
          if (route.held === 'side.thread.open') await act(() => fake.reply('side.thread.open', { status: 'starting', appSessionId: 'b2222222-2222-4222-8222-222222222222' }));
          else {
            if (route.held === 'side.comment.content') await act(() => fake.reply('side.comment.content', { content: [{ type: 'text', text: 'the built message' }] }));
            await act(() => fake.reply('session.send', { messageUuid: null, disposition: 'sent', queueId: 'q0' }));
          }
        } else await act(() => fake.fail(route.held, 'Not now'));
        await act(() => ticks(4));
        if (outcome === 'went') {
          expect(messages(ydoc, sent)).toEqual(['Monthly?']);
          expect(liveThreadIds(ydoc).has(sent)).toBe(true);
        } else {
          expect(getThread(ydoc, sent)).toBeNull();
          expect(liveThreadIds(ydoc).has(sent)).toBe(false);
        }
        await until(() => tab.handle().closed === true, 'the replica released and closed');
        expect(useCommentCard.getState().passes.size).toBe(0);
        expect(tab.settled, 'the comment in flight is settled once').toEqual([outcome === 'went']);
        expect(tab.holds.twice, 'no hold is released twice').toBe(0);
        expect(tab.holds.released, 'every hold is released').toBe(tab.holds.taken);
      });
    }
});
