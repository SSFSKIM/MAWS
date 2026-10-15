// S5's pin table on the ported editor (happy-dom; M4 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, its
// "Proves": S5's pin checks that need a DOM; `spikes/p3-store/s5/s5-pins.mjs` items 1 and 2). Each scenario starts from
// a fresh world (the host, the owner's two editor replicas A and B, a bare agent replica), comments t1 and t2
// (overlapping) on p1 and t3 on p2 from A's editor, applies one edit, and checks that every replica converges, the marks
// cover what S5 says on both editors, the derived thread states, the threads map untouched, the stored pair after the
// host's refresh, and that undo brings back the text, the marks and the states. The agent's rewrites are the writer's
// (patch-writer.marks.test.ts, M2); restore keeping conversations is the adapter's (adapter.test.ts, M2); the model's
// orphan locate is threads.test.ts (M1). Where this schema differs from S5's (a comment survives a retype to code, S5
// pitfall 5 fixed in the schema), the expectation is this schema's.
import { afterEach, describe, expect, it } from 'vitest';
import type { Node as YNodeType } from '../../../yjs';
import { tabBody } from '../../tabs';
import { getThread, listThreads, refreshAnchors, reopen, reply, resolve } from '../../threads';
import { TAB } from '../test-world';
import {
  BASE_COVER,
  agentActor,
  anchorText,
  baseWorld,
  blockTypes,
  clip,
  covered,
  findPos,
  highlighted,
  key,
  now,
  owner,
  pasteHTML,
  select,
  states,
  textOf,
  type,
  undoAll,
  type CommentWorld,
} from './test-support';

let open: CommentWorld[] = [];
afterEach(() => {
  for (const w of open) w.world.destroy();
  open = [];
});
const world = async (options?: { paste?: boolean }) => {
  const w = await baseWorld(options);
  open.push(w);
  return w;
};

interface Row {
  name: string;
  edit(w: CommentWorld): unknown;
  want: Record<string, string>;
  orphans?: string[];
  paste?: boolean;
  /** A duplicated mark has no single extent; the refresh cannot bracket both copies. */
  contrast?: boolean;
}

const A = (w: CommentWorld) => w.A.editor;
/** What the display should draw for covers whose threads are all open: the covered text, its separators gone. */
const drawn = (cover: Record<string, string>) => Object.fromEntries(Object.entries(cover).map(([id, text]) => [id, text.replace(/[|¶]/g, '')]));
const P3_END = (w: CommentWorld) => findPos(A(w), 'Third paragraph.') + 'Third paragraph.'.length;

const ROWS: Row[] = [
  { name: 'type before the passage (start of paragraph)', edit: (w) => type(A(w), findPos(A(w), 'The plan'), 'Today, '), want: BASE_COVER },
  { name: 'type right before the passage (at its start)', edit: (w) => type(A(w), findPos(A(w), 'ships'), 'now '), want: BASE_COVER },
  { name: 'type inside the passage', edit: (w) => type(A(w), findPos(A(w), 'quarterly'), 'very '), want: { ...BASE_COVER, t1: 'ships very quarterly with design review' } },
  { name: 'type right after t1 (inside t2)', edit: (w) => type(A(w), findPos(A(w), 'design review') + 13, 'X'), want: { ...BASE_COVER, t2: 'design reviewX notes' } },
  { name: 'type right after the passage', edit: (w) => type(A(w), findPos(A(w), 'notes') + 5, '!'), want: BASE_COVER },
  {
    name: 'delete a word inside the passage',
    edit: (w) => {
      select(A(w), 'quarterly ');
      A(w).commands.keyboardShortcut('Backspace');
    },
    want: { ...BASE_COVER, t1: 'ships with design review' },
  },
  { name: 'Enter in the middle of the passage', edit: (w) => key(A(w), findPos(A(w), 'with design'), 'Enter'), want: { ...BASE_COVER, t1: 'ships quarterly |with design review' } },
  { name: 'Enter before the passage (mid-paragraph)', edit: (w) => key(A(w), findPos(A(w), 'ships'), 'Enter'), want: BASE_COVER },
  { name: 'Enter at the start of the paragraph', edit: (w) => key(A(w), findPos(A(w), 'The plan'), 'Enter'), want: BASE_COVER },
  { name: 'Backspace joining p2 into p1', edit: (w) => key(A(w), findPos(A(w), 'Second'), 'Backspace'), want: BASE_COVER },
  { name: 'Backspace joining p1 into the heading', edit: (w) => key(A(w), findPos(A(w), 'The plan'), 'Backspace'), want: BASE_COVER },
  { name: 'type change: paragraph → heading', edit: (w) => A(w).chain().setTextSelection(findPos(A(w), 'ships')).setNode('heading', { level: 2 }).run(), want: BASE_COVER },
  { name: 'type change: paragraph → bullet list item', edit: (w) => A(w).chain().setTextSelection(findPos(A(w), 'ships')).toggleBulletList().run(), want: BASE_COVER },
  { name: 'type change: paragraph → quote', edit: (w) => A(w).chain().setTextSelection(findPos(A(w), 'ships')).toggleBlockquote().run(), want: BASE_COVER },
  // S5 orphaned t1 and t2 here (its codeBlock admitted only the attribution marks); this schema allows the comment on code
  { name: 'type change: paragraph → code block (the comment kept)', edit: (w) => A(w).chain().setTextSelection(findPos(A(w), 'ships')).setNode('codeBlock').run(), want: BASE_COVER },
  {
    name: 'cut the whole passage and paste it into p3',
    edit: async (w) => {
      select(A(w), 'ships quarterly with design review notes');
      const c = clip(A(w), 'cut');
      await w.settle();
      expect(states(w.world.host.doc), 'between the cut and the paste').toBe('t1:open:orphan t2:open:orphan t3:open');
      A(w).storage.collaboration.undoManager?.stopCapturing();
      A(w).commands.setTextSelection(P3_END(w));
      pasteHTML(A(w), c.html, c.text);
    },
    want: BASE_COVER,
  },
  {
    name: 'cut part of the passage ("quarterly ") and paste it into p3',
    edit: async (w) => {
      select(A(w), 'quarterly ');
      const c = clip(A(w), 'cut');
      await w.settle();
      A(w).storage.collaboration.undoManager?.stopCapturing();
      A(w).commands.setTextSelection(P3_END(w));
      pasteHTML(A(w), c.html, c.text);
    },
    want: { ...BASE_COVER, t1: 'ships with design review' },
  },
  {
    name: 'copy the passage and paste it into p3',
    edit: (w) => {
      select(A(w), 'ships quarterly with design review notes');
      const c = clip(A(w), 'copy');
      A(w).commands.setTextSelection(P3_END(w));
      pasteHTML(A(w), c.html, c.text);
      expect(textOf(A(w)).split('\n')[3]).toBe('Third paragraph.ships quarterly with design review notes');
    },
    want: BASE_COVER,
  },
  {
    name: 'cut, paste, then paste the same clipboard again',
    edit: async (w) => {
      select(A(w), 'ships quarterly with design review notes');
      const c = clip(A(w), 'cut');
      await w.settle();
      A(w).storage.collaboration.undoManager?.stopCapturing();
      A(w).commands.setTextSelection(P3_END(w));
      pasteHTML(A(w), c.html, c.text);
      await w.settle();
      A(w).storage.collaboration.undoManager?.stopCapturing();
      A(w).commands.setTextSelection(findPos(A(w), 'Second paragraph'));
      pasteHTML(A(w), c.html, c.text);
    },
    want: BASE_COVER,
  },
  {
    name: 'paste a foreign comment span (another document) and a stray copy of a live one',
    edit: (w) => {
      A(w).commands.setTextSelection(P3_END(w));
      pasteHTML(A(w), '<span data-thread="tX">foreign</span> and <span data-thread="t1">a stray t1</span>', 'foreign');
    },
    want: BASE_COVER,
  },
  {
    name: 'CONTRAST without the paste dedupe: copy and paste duplicates the comments',
    paste: false,
    contrast: true,
    edit: (w) => {
      select(A(w), 'ships quarterly with design review notes');
      const c = clip(A(w), 'copy');
      A(w).commands.setTextSelection(P3_END(w));
      pasteHTML(A(w), c.html, c.text);
    },
    want: { t1: 'ships quarterly with design review|ships quarterly with design review', t2: 'design review notes|design review notes', t3: 'keeps going' },
  },
  {
    name: 'delete the whole passage (orphans t1 and t2)',
    edit: (w) => {
      select(A(w), 'ships quarterly with design review notes');
      A(w).commands.keyboardShortcut('Backspace');
    },
    want: { t3: 'keeps going' },
    orphans: ['t1', 't2'],
  },
  {
    name: 'delete the whole paragraph p1 (block gone)',
    edit: (w) => A(w).chain().setNodeSelection(findPos(A(w), 'The plan') - 1).deleteSelection().run(),
    want: { t3: 'keeps going' },
    orphans: ['t1', 't2'],
  },
];

describe('S5’s pins through ordinary edits, on the editor', () => {
  for (const row of ROWS) {
    it(row.name, async () => {
      const w = await world(row.paste === false ? { paste: false } : undefined);
      const text0 = textOf(A(w));
      A(w).storage.collaboration.undoManager?.stopCapturing();
      await row.edit(w);
      await w.settle();

      expect(covered(A(w)), 'the marks on A').toEqual(row.want);
      expect(covered(w.B.editor), 'the marks on B').toEqual(row.want);
      // the display, rebuilt only where each transaction touched, draws exactly the open threads' live text
      expect(highlighted(A(w)), 'the highlights on A').toEqual(drawn(row.want));
      expect(highlighted(w.B.editor), 'the highlights on B').toEqual(drawn(row.want));
      const orphans = row.orphans ?? [];
      expect(states(w.world.host.doc), 'the thread states').toBe(['t1', 't2', 't3'].map((id) => `${id}:open${orphans.includes(id) ? ':orphan' : ''}`).join(' '));
      expect(states(w.agent.doc), 'the agent replica’s thread states').toBe(states(w.world.host.doc));
      expect(listThreads(w.world.host.doc).map((t) => t.id), 'the threads map untouched').toEqual(['t1', 't2', 't3']);

      // the host's anchor refresh, then the stored pair again
      refreshAnchors(w.world.host.doc);
      await w.settle();
      const t1 = covered(A(w)).t1;
      if (row.contrast) expect(anchorText(A(w), w.A.handle.doc, 't1'), 'a duplicated mark has no single extent').not.toBe(t1?.replaceAll('|', '¶'));
      else if (t1) expect(anchorText(A(w), w.A.handle.doc, 't1'), 'after the host’s refresh, t1’s pair brackets its mark').toBe(t1.replaceAll('|', '¶'));

      undoAll(A(w));
      await w.settle();
      expect(covered(A(w)), 'undo restores the marks on A').toEqual(BASE_COVER);
      expect(covered(w.B.editor), 'undo restores the marks on B').toEqual(BASE_COVER);
      expect(textOf(A(w)), 'undo restores the text').toBe(text0);
      expect(states(w.world.host.doc), 'undo restores the thread states').toBe('t1:open t2:open t3:open');
      expect(highlighted(A(w)), 'undo restores the highlights on A').toEqual(BASE_COVER);
      expect(highlighted(w.B.editor), 'undo restores the highlights on B').toEqual(BASE_COVER);
    });
  }
});

describe('create, overlap, resolve, reopen (S5 item 1)', () => {
  it('stores the overlapping comments under two keys and highlights every open thread on the other replica', async () => {
    const w = await world();
    const p1 = tabBody(w.agent.doc, TAB)!.toArray()[1] as YNodeType;
    expect(new Set(JSON.stringify(p1.toDelta().toJSON()).match(/comment--[A-Za-z0-9+/=]+/g)).size).toBe(2);
    expect(highlighted(w.B.editor)).toEqual(BASE_COVER);
    // the creation is not text editing: nothing of it is in the owner's undo
    expect(A(w).storage.collaboration.undoManager?.canUndo()).toBe(false);
  });

  it('resolve on B: one write, the mark stays, A stops highlighting it, the owner’s undo does not reopen it', async () => {
    const w = await world();
    const revision = w.world.host.revision;
    resolve(w.B.handle.doc, 't1', owner, now());
    await w.settle();
    expect(w.world.host.revision - revision, 'one update').toBe(1);
    expect(highlighted(A(w))).toEqual({ t2: BASE_COVER.t2, t3: BASE_COVER.t3 });
    expect(covered(A(w)).t1).toBe(BASE_COVER.t1);
    expect(states(w.agent.doc)).toBe('t1:resolved t2:open t3:open');
    expect(w.B.editor.storage.collaboration.undoManager?.canUndo()).toBe(false);
  });

  it('reopen by the agent highlights the passage as it now reads; a resolved thread whose text went is resolved, reopened it is orphaned', async () => {
    const w = await world();
    resolve(w.B.handle.doc, 't1', owner, now());
    await w.settle();
    type(A(w), findPos(A(w), 'quarterly'), 'very ');
    await w.settle();
    reopen(w.agent.doc, 't1', agentActor, now());
    await w.settle();
    expect(highlighted(A(w)).t1).toBe('ships very quarterly with design review');
    expect(highlighted(w.B.editor).t1).toBe('ships very quarterly with design review');

    resolve(w.A.handle.doc, 't2', owner, now());
    await w.settle();
    select(A(w), ' notes');
    A(w).commands.keyboardShortcut('Backspace');
    select(A(w), 'design review');
    A(w).commands.keyboardShortcut('Backspace');
    await w.settle();
    expect(states(w.world.host.doc)).toContain('t2:resolved');
    expect(states(w.world.host.doc)).not.toContain('t2:resolved:orphan');
    reopen(w.B.handle.doc, 't2', owner, now());
    await w.settle();
    expect(states(w.world.host.doc)).toContain('t2:open:orphan');
  });

  it('a reply lands in the thread on every replica', async () => {
    const w = await world();
    reply(w.agent.doc, 't1', { id: 't1:m1', by: agentActor, at: now(), body: 'Changed to monthly.' });
    await w.settle();
    expect(getThread(w.A.handle.doc, 't1')!.messages.map((m) => m.by.kind)).toEqual(['human', 'session']);
  });

  it('a resolve racing a reply on two replicas loses neither', async () => {
    const w = await world();
    resolve(w.A.handle.doc, 't3', owner, now());
    reply(w.agent.doc, 't3', { id: 't3:m1', by: agentActor, at: now(), body: 'Made it concrete.' });
    await w.settle();
    for (const doc of [w.world.host.doc, w.A.handle.doc, w.B.handle.doc, w.agent.doc]) {
      expect(getThread(doc, 't3')).toMatchObject({ status: 'resolved', messages: [{ body: 'Too vague.' }, { body: 'Made it concrete.' }] });
    }
    expect(highlighted(w.B.editor).t3).toBeUndefined();
  });
});

describe('a reload (S5 item 2’s restart row)', () => {
  it('brings the marks, the statuses and the highlights back, the stored pair still resolving, with no write on bind', async () => {
    const w = await world();
    resolve(w.A.handle.doc, 't2', owner, now());
    type(A(w), findPos(A(w), 'quarterly'), 'very ');
    await w.settle();
    const revision = w.world.host.revision;
    const { A: A2, B: B2 } = await w.reload();
    await w.settle();
    expect(covered(A2.editor)).toEqual({ ...BASE_COVER, t1: 'ships very quarterly with design review' });
    expect(covered(B2.editor)).toEqual(covered(A2.editor));
    expect(states(w.world.host.doc)).toBe('t1:open t2:resolved t3:open');
    expect(Object.keys(highlighted(A2.editor))).toEqual(['t1', 't3']);
    expect(anchorText(A2.editor, A2.handle.doc, 't1')).toBe('ships very quarterly with design review');
    expect(w.world.host.revision, 'no normalisation write').toBe(revision);
    expect(blockTypes(A2.editor)).toEqual(['heading#h1', 'paragraph#p1', 'paragraph#p2', 'paragraph#p3']);
  });
});
