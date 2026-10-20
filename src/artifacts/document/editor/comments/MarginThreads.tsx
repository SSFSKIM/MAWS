// The margin (P4-B1; docs/doperpowers/plans/2026-10-20-p4-b1-margin-comments.md D1 to D5, D7, D11, D12; the P4 spec
// §4.3): the shown tab's open threads as cards beside the page, each at its passage's first line, stacked by the pure
// layout (src/artifacts/comments/margin-layout.ts) with the active thread pinned at its anchor and shifted left, its
// neighbours pushed both ways. Rendered inside the page's scroll box as the page's flex sibling (theme.css's row), so
// the cards scroll with the text and a scroll runs no layout; re-laid when the passages may have moved (an edit, a frame
// resize, the provisional layer's growth, X35: the page frame calls `relayoutRef` from its frame callback, P4-B1), and on
// the thread set, the active thread, a card's resize, a tab switch and a font load. Positions are written to the
// entries' elements directly from the layout pass, so a keystroke re-renders nothing in React and the cards move in the
// frame the text moved in: the pass re-reads the anchors (the marks' kept spans, locate.ts), runs the layout and sets
// transforms. Moves caused by an activation, an add or a resolve animate; moves caused by edits never.
//
// Three tiers by the side space beside the page (margin-tiers.ts): cards, the icon rail (Docs' Minimize form: a dot at
// each anchor, dots closer than one dot merged into one carrying the count, the active thread's card overlaid beside its
// dot), and off under a 720 px body, where the drawer applies (DocumentEditor hides the margin then). View › Minimize
// gives the icon rail at any width; Hide hides the margin (DocumentEditor). The column reserves its width only while a
// thread or the compose card is open on the shown tab; otherwise it is 0 wide and the page sits centred alone.
//
// Only the human activates a thread [binding]: the editor's display plugin (a click, the local caret, the chords) and
// this margin's own clicks, J and K; the margin reads `active` from the editor's state and never sets it on a remote
// change. The compose card (P2's, hosted by the renderer through `overlay`) is an entry of the stack at the thread it
// is on (`hosting`), measured like any other; that thread's card yields to it meanwhile.
import type { Editor } from '@tiptap/core';
import { memo /* P4-B1 */, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject /* P4-B1 */ } from 'react';
import { actorDisplay } from '@shared/artifacts/actor';
import { layoutMargin, MARGIN_ACTIVE_SHIFT_PX, MARGIN_GAP_PX } from '../../../comments/margin-layout';
import { ICON_PX, tierFor, type MarginTier } from '../../../comments/margin-tiers';
import { ThreadCard } from '../../../comments/ThreadCard';
import type { CommentsView } from '../../../comments/view';
import type { Doc } from '../../../yjs';
import { nanoid8 } from '../../schema';
import { reopen, reply, resolve, type ThreadState } from '../../threads';
import { firstLineRect, MarginLocator } from './locate';
import { activeThread, COMMENTS_ORIGIN } from './plugins';
import type { CommentAuthor } from './surface';
import { useThreadStates } from './use-threads';

export interface MarginThreadsProps {
  /** The live editor of the shown tab. */
  editor: Editor;
  doc: Doc;
  tabId: string;
  author: CommentAuthor;
  readOnly: boolean;
  /** Expand draws the cards, Minimize the icon rail (Hide is the caller's: the margin is not drawn). */
  view: Exclude<CommentsView, 'hide'>;
  /**
   * P4-B1: filled with the layout pass for passages that may have moved (an edit, a frame resize, the provisional layer's
   * growth), which the page frame calls from its frame callback; never on a scroll.
   */
  relayoutRef?: { current: () => void };
  /** The thread the renderer's compose card is on, or null (`CommentOverlayProps.hosting`). */
  hosting: string | null;
  /** Draws the renderer's compose card (the overlay surface, placement `margin`) in the hosting thread's entry. */
  overlay: (() => ReactNode) | null;
  /** The Comment command (the Add comment button); null when commenting is not offered. */
  onComment: (() => boolean) | null;
  /** The tier changed (the editor reads it for the drawer's fallback and the tests); called with `off` under 720 px. */
  onTier?(tier: MarginTier): void;
  /** ⌃⌘ E then C: filled with the card-focusing function while the margin draws. */
  enterRef?: { current: (threadId: string) => void };
  /** P4-B1: the threads' reply drafts, the editor's, so a card the panel or a tab switch hides keeps its draft (X36). */
  drafts: ReadonlyMap<string, string>;
  onDraftChange(threadId: string, text: string): void;
}

// P4-B1: what React draws (an entry's id and thread); the pass keeps each entry's anchoring element beside it, so an
// edit that redraws a passage's span changes nothing React reads
interface Entry {
  id: string;
  thread: ThreadState | null; // null: the compose card's thread before the list caught up with it
}
interface Located extends Entry {
  element: Element;
}

type Cause = 'activation' | 'set' | 'layout';

const ANIMATED: ReadonlySet<Cause> = new Set<Cause>(['activation', 'set']);

// P4-B1: the margin's own quiet moment before it re-reads the thread list. The 200-page workload's keys arrive 60 to 180
// ms apart, and a re-read per pause scans every tab's marks (`liveThreadIds`), so the panel's 50 ms would re-read after
// almost every key; the measured run (D13) re-bases it. An orphan leaves the margin, and returns after undo, within it.
export const MARGIN_LIST_QUIET_MS = 400;

// P4-B1: one entry's handlers, kept per thread id across renders (each reads the margin's latest actions), so a memoized
// card sees the same functions while its thread is drawn
interface EntryHandlers {
  onDraftChange(text: string): void;
  onActivate(): void;
  onReply(body: string): void;
  onResolve(): void;
  onReopen(): void;
  onNext(): void;
  onPrevious(): void;
  onExit(): void;
  onDot(): void;
}
interface EntryActions {
  draft(id: string, text: string): void;
  activate(id: string): void;
  reply(id: string, body: string): void;
  resolve(id: string): void;
  reopen(id: string): void;
  step(id: string, by: 1 | -1): void;
  exit(): void;
  dot(id: string): void;
}

// P4-B1 (N2): in the icon tier, entry id → how many entries its dot stands for (a group's first), or 0 (a later member
// of a group, drawn under the first's dot); an entry not named has a dot of its own
type Groups = ReadonlyMap<string, number>;
const NO_GROUPS: Groups = new Map();

export function MarginThreads({ editor, doc, tabId, author, readOnly, view, relayoutRef, hosting, overlay, onComment, onTier, enterRef, drafts, onDraftChange }: MarginThreadsProps) {
  const column = useRef<HTMLDivElement>(null);
  const states = useThreadStates(doc, { quietMs: MARGIN_LIST_QUIET_MS }); // P4-B1: the margin's quiet moment
  const locator = useMemo(() => new MarginLocator(editor, doc), [editor, doc]);

  // ── the tier: the body's, the scroll box's and the page's widths through one observer ──
  const [tier, setTier] = useState<MarginTier>({ kind: 'off' });
  useLayoutEffect(() => {
    const element = column.current;
    if (!element) return;
    const scroller = element.parentElement;
    const page = element.previousElementSibling;
    const body = element.closest<HTMLElement>('.doc-editor-body');
    if (!scroller || !page) return;
    const measure = () => {
      const next = tierFor({ bodyWidth: body?.clientWidth ?? scroller.clientWidth, scrollWidth: scroller.clientWidth, pageWidth: page.getBoundingClientRect().width, view });
      setTier((now) => (sameTier(now, next) ? now : next));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(scroller);
    observer?.observe(page);
    if (body) observer?.observe(body);
    return () => observer?.disconnect();
  }, [view]);
  useEffect(() => onTier?.(tier), [tier, onTier]);

  // ── the active thread, the editor's ──
  const [active, setActive] = useState<string | null>(() => activeThread(editor.state));
  useEffect(() => {
    const report = () => setActive(activeThread(editor.state));
    report();
    editor.on('transaction', report);
    return () => {
      editor.off('transaction', report);
    };
  }, [editor]);

  // ── the entries: the open threads of this tab drawn here, in document order ──
  // P4-B1: a thread unchanged since the list's last reading keeps its object (the list is re-read after every typing
  // pause), so the cards re-render only for a thread that changed
  const open = useStableThreads(states, tabId);
  const byId = useMemo(() => new Map(open.map((thread) => [thread.id, thread])), [open]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [groups, setGroups] = useState<Groups>(NO_GROUPS);
  // P4-B1 (Z3): an orphan (no live text) is not looked for; undo's return makes it live, hence wanted, again. The
  // compose card's thread is wanted regardless.
  const wantedKey = useMemo(() => {
    const ids = open.filter((thread) => thread.live).map((thread) => thread.id);
    if (hosting !== null && !ids.includes(hosting)) ids.push(hosting);
    return ids.join(' ');
  }, [open, hosting]);
  // the heights, measured as the cards resize; tops written straight to the elements
  const heights = useRef(new Map<string, number>());
  const nodes = useRef(new Map<string, HTMLElement>());
  const tops = useRef(new Map<string, number>());
  const passes = useRef(0);
  // P4-B1: what a pass reads (the committed render's), the last pass's located entries and cause, the groups drawn
  const latest = useRef({ wantedKey, byId, hosting, active, tier, entries });
  useLayoutEffect(() => {
    latest.current = { wantedKey, byId, hosting, active, tier, entries };
  });
  const located = useRef<Located[]>([]);
  const lastCause = useRef<Cause>('layout');
  const groupsKey = useRef('');
  const updateAdd = useRef<() => void>(() => {});

  // P4-B1: the layout pass, with its cause: the anchors re-read (the kept elements, locate.ts), the stack laid, the
  // transforms written. The icon tier lays its groups (a dot each, ICON_PX tall) rather than its entries.
  const place = useCallback((cause: Cause) => {
    const root = column.current;
    if (!root) return;
    const { active, tier } = latest.current;
    const list = located.current;
    const origin = root.getBoundingClientRect().top;
    const anchorOf = (entry: Located) => Math.round(firstLineRect(entry.element).top - origin);
    const leaderOf = new Map<string, string>();
    let items: Array<{ id: string; anchor: number; height: number }>;
    if (tier.kind === 'icons') {
      const counts = new Map<string, number>();
      items = [];
      let lead: { id: string; anchor: number } | null = null;
      for (const entry of list) {
        const anchor = anchorOf(entry);
        if (lead && Math.abs(anchor - lead.anchor) < ICON_PX) {
          leaderOf.set(entry.id, lead.id);
          counts.set(lead.id, (counts.get(lead.id) ?? 1) + 1);
          counts.set(entry.id, 0);
          continue;
        }
        lead = { id: entry.id, anchor };
        leaderOf.set(entry.id, entry.id);
        counts.set(entry.id, 1);
        items.push({ id: entry.id, anchor, height: ICON_PX });
      }
      const key = [...counts].map(([id, n]) => `${id}:${n}`).join(' ');
      if (key !== groupsKey.current) {
        groupsKey.current = key;
        setGroups(counts);
      }
    } else items = list.map((entry) => ({ id: entry.id, anchor: anchorOf(entry), height: heights.current.get(entry.id) ?? 0 }));
    const laid = layoutMargin({ entries: items, active: active === null ? null : (leaderOf.get(active) ?? active), gap: MARGIN_GAP_PX });
    const placed = new Map<string, number>();
    for (const { id } of list) {
      const top = laid.tops.get(leaderOf.get(id) ?? id);
      if (top !== undefined) placed.set(id, top);
    }
    tops.current = placed;
    root.toggleAttribute('data-animate', ANIMATED.has(cause));
    root.style.setProperty('--doc-margin-height', `${Math.ceil(laid.height)}px`);
    for (const [id, top] of placed) {
      const node = nodes.current.get(id);
      if (node) node.style.transform = transformOf(latest.current, id, top);
    }
    passes.current += 1;
    root.dataset.relayouts = String(passes.current);
    updateAdd.current();
  }, []);

  // P4-B1: a pass with its cause: the threads located (React told only when the drawn set changed), the mounted cards'
  // heights read when React has just drawn them (`measure`: an activation grows one card and compacts another), then laid
  const pass = useCallback(
    (cause: Cause, measure: boolean) => {
      const root = column.current;
      const { wantedKey, byId, hosting, tier, entries } = latest.current;
      if (!root || tier.kind === 'off') return;
      const found = locator.refresh(wantedKey === '' ? [] : wantedKey.split(' '));
      const list: Located[] = found.map(({ id, element }) => ({ id, element, thread: byId.get(id) ?? null }));
      // the compose card's thread drawn nowhere here (another tab's) heads the stack at the column's top
      if (hosting !== null && !found.some(({ id }) => id === hosting)) list.unshift({ id: hosting, element: root, thread: byId.get(hosting) ?? null });
      located.current = list;
      if (!sameEntries(entries, list)) setEntries(list.map(({ id, thread }) => ({ id, thread })));
      lastCause.current = cause;
      if (measure) for (const [id, node] of nodes.current) heights.current.set(id, Math.round(node.getBoundingClientRect().height));
      place(cause);
    },
    [locator, place],
  );
  const passRef = useRef(pass);
  passRef.current = pass;

  // the passes React's state asks for: the thread set, the active thread, the tier and the hosting thread (the first
  // layout is not animated, D4)
  const previous = useRef<{ active: string | null; set: string } | null>(null);
  useLayoutEffect(() => {
    if (tier.kind === 'off') return;
    const set = `${wantedKey}|${hosting ?? ''}`;
    const was = previous.current;
    previous.current = { active, set };
    pass(was === null ? 'layout' : was.active !== active ? 'activation' : was.set !== set ? 'set' : 'layout', true);
  }, [wantedKey, byId, hosting, active, tier, pass]);
  // P4-B1: the passages' moves (an edit, a frame resize, the layer's growth) are the page frame's to report, from its
  // frame callback: an edit costs this pass and no render
  useEffect(() => {
    if (!relayoutRef) return;
    relayoutRef.current = () => pass('layout', false);
    return () => {
      relayoutRef.current = () => {};
    };
  }, [relayoutRef, pass]);

  // a card's resize (its reply field growing, an agent's reply) re-lays the stack, not animated; the elements are
  // observed as they mount
  const resizes = useMemo(
    () =>
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((records) => {
            let changed = false;
            for (const record of records) {
              const id = (record.target as HTMLElement).dataset.marginEntry;
              if (id === undefined) continue;
              const height = Math.round(record.contentRect.height);
              if (heights.current.get(id) !== height) {
                heights.current.set(id, height);
                changed = true;
              }
            }
            if (changed) passRef.current('layout', false);
          }),
    [],
  );
  useEffect(() => () => resizes?.disconnect(), [resizes]);
  // P4-B1: one ref per entry id, kept across renders, so React attaches an entry once, as it mounts; its first height
  // re-lays the stack once the commit's refs have all run (one pass for the lot), with the cause of the pass that drew
  // it, so an add stays animated
  const refs = useRef(new Map<string, (node: HTMLElement | null) => void>());
  const relayoutQueued = useRef(false);
  const attachRef = useRef((id: string, node: HTMLElement | null) => {
    const was = nodes.current.get(id);
    if (was && was !== node) {
      resizes?.unobserve(was);
      nodes.current.delete(id);
    }
    if (!node) return;
    nodes.current.set(id, node);
    const height = Math.round(node.getBoundingClientRect().height);
    if (heights.current.get(id) !== height) {
      heights.current.set(id, height);
      if (!relayoutQueued.current) {
        relayoutQueued.current = true;
        queueMicrotask(() => {
          relayoutQueued.current = false;
          passRef.current(lastCause.current, false);
        });
      }
    }
    const top = tops.current.get(id);
    if (top !== undefined) node.style.transform = transformOf(latest.current, id, top);
    resizes?.observe(node);
  });
  const attach = (id: string) => {
    let ref = refs.current.get(id);
    if (!ref) {
      ref = (node) => attachRef.current(id, node);
      refs.current.set(id, ref);
    }
    return ref;
  };
  useEffect(() => {
    const ids = new Set(entries.map(({ id }) => id));
    for (const id of refs.current.keys()) if (!ids.has(id)) refs.current.delete(id);
  }, [entries]);

  // a font loading re-wraps the text: every anchor moves
  useEffect(() => {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (!fonts?.addEventListener) return;
    const loaded = () => passRef.current('layout', false);
    fonts.addEventListener('loadingdone', loaded);
    return () => fonts.removeEventListener('loadingdone', loaded);
  }, []);

  // ── the activations the margin makes (the human's): a card click, J and K; U and Escape return to the text ──
  const activate = useCallback((id: string | null) => void (!editor.isDestroyed && editor.commands.setActiveThread(id)), [editor]);
  const focusCard = (id: string) => {
    const node = nodes.current.get(id);
    (node?.querySelector<HTMLElement>('[data-thread]') ?? node)?.focus({ preventScroll: true });
  };
  const step = (from: string, by: 1 | -1) => {
    const ids = latest.current.entries.map(({ id }) => id);
    const at = ids.indexOf(from);
    const next = ids[at + by];
    if (next === undefined) return;
    activate(next);
    scrollPassage(editor, next);
    requestAnimationFrame(() => focusCard(next));
  };
  const exit = () => {
    if (tier.kind === 'icons') activate(null); // the overlaid card closes; its draft is kept below
    if (!editor.isDestroyed) editor.view.dom.focus({ preventScroll: true }); // at once (the focus command waits a frame)
  };
  // the chord's enter: the active card takes the keyboard (its reply field through R once there)
  useEffect(() => {
    if (!enterRef) return;
    enterRef.current = (id) => focusCard(id);
    return () => {
      enterRef.current = () => {};
    };
  });

  // ── the drafts (X36: one per thread, kept while a card is hidden; P4-B1: the editor's, shared with the panel) and
  // the announcements (K4) ──
  const draftOf = (id: string) => drafts.get(id) ?? '';
  const [announced, setAnnounced] = useState('');
  const seen = useRef(new Map<string, { status: ThreadState['status']; messages: number }>());
  useEffect(() => {
    const notes: string[] = [];
    for (const thread of states) {
      const before = seen.current.get(thread.id);
      if (before && before.status === 'open' && thread.status === 'resolved') notes.push('Comment resolved');
      if (before && thread.status === 'open' && thread.messages.length > before.messages && thread.id !== active) {
        const last = thread.messages[thread.messages.length - 1];
        if (last && last.by.kind !== 'human') notes.push(`${actorDisplay(last.by).name} replied`);
      }
      seen.current.set(thread.id, { status: thread.status, messages: thread.messages.length });
    }
    if (notes.length > 0) setAnnounced(notes.join('. '));
  }, [states, active]);

  // P4-B1: the entries' actions as of this render, reached through each entry's kept handlers
  const write = (change: () => void) => !readOnly && change();
  const actions = useRef<EntryActions | null>(null);
  actions.current = {
    draft: (id, text) => onDraftChange(id, text),
    activate: (id) => activate(id),
    reply: (id, body) => write(() => reply(doc, id, { id: `${id}:${nanoid8()}`, by: author.actor, at: author.now(), body }, COMMENTS_ORIGIN)),
    resolve: (id) => write(() => resolve(doc, id, author.actor, author.now(), COMMENTS_ORIGIN)),
    reopen: (id) => write(() => reopen(doc, id, author.actor, author.now(), COMMENTS_ORIGIN)),
    step,
    exit,
    dot: (id) => {
      // the group's first opens; the dot of an open group closes it
      const at = entries.findIndex((entry) => entry.id === id);
      const open = active !== null && entries.slice(at, at + (groups.get(id) ?? 1)).some((member) => member.id === active);
      activate(open ? null : id);
      if (!open) scrollPassage(editor, id);
    },
  };
  const handlers = useRef(new Map<string, EntryHandlers>());
  const handlersFor = (id: string): EntryHandlers => {
    let kept = handlers.current.get(id);
    if (!kept) {
      const now = () => actions.current!;
      kept = {
        onDraftChange: (text) => now().draft(id, text),
        onActivate: () => now().activate(id),
        onReply: (body) => now().reply(id, body),
        onResolve: () => now().resolve(id),
        onReopen: () => now().reopen(id),
        onNext: () => now().step(id, 1),
        onPrevious: () => now().step(id, -1),
        onExit: () => now().exit(),
        onDot: () => now().dot(id),
      };
      handlers.current.set(id, kept);
    }
    return kept;
  };
  useEffect(() => {
    const ids = new Set(entries.map(({ id }) => id));
    for (const id of handlers.current.keys()) if (!ids.has(id)) handlers.current.delete(id);
  }, [entries]);

  // off (a narrow body): the column stays in the row, 0 wide and empty, so its measurements go on (the tier returns
  // when the body widens); it is no region then
  if (tier.kind === 'off') return <div ref={column} className="doc-margin" data-margin-tier="off" style={{ '--doc-margin-reserve': '0px' } as CSSProperties} />;
  const reserved = entries.length > 0 || hosting !== null;
  const style = {
    '--doc-margin-reserve': `${reserved ? tier.reserve : 0}px`,
    '--doc-margin-gap': `${MARGIN_GAP_PX}px`,
    '--doc-margin-overlap': `${tier.kind === 'icons' && reserved ? tier.overlap : 0}px`,
  } as CSSProperties;
  // P4-B1: a memoized card per entry (MarginCard)
  const card = (entry: Entry, index: number, compact: boolean) =>
    entry.thread && <MarginCard thread={entry.thread} active={entry.id === active} compact={compact} index={index + 1} count={entries.length} readOnly={readOnly} draft={draftOf(entry.id)} handlers={handlersFor(entry.id)} />;
  return (
    <div ref={column} className="doc-margin" role="region" aria-label="Comments" data-margin-tier={tier.kind} data-markup-occluder style={style}>
      {tier.kind === 'cards' &&
        entries.map((entry, index) => (
          <div key={entry.id} ref={attach(entry.id)} className="doc-margin-entry" data-margin-entry={entry.id} data-active={entry.id === active ? '' : undefined} data-compose={entry.id === hosting ? '' : undefined}>
            {entry.id === hosting && overlay ? <Hosted render={overlay} /> : card(entry, index, entry.id !== active)}
          </div>
        ))}
      {tier.kind === 'icons' && <IconRail entries={entries} groups={groups} active={active} hosting={hosting} overlay={overlay} attach={attach} card={card} handlersFor={handlersFor} />}
      {/* the surface's card host stays mounted while no card is up (it claims a card as it opens and then names its thread) */}
      {overlay && (hosting === null || !entries.some((entry) => entry.id === hosting)) && (
        <div className="doc-margin-slot" data-margin-slot>
          <Hosted render={overlay} />
        </div>
      )}
      {onComment && <AddComment editor={editor} column={column} hosting={hosting} onComment={onComment} updateRef={updateAdd} />}
      <div className="doc-margin-live" aria-live="polite" data-margin-live>
        {announced}
      </div>
    </div>
  );
}

// P4-B1: the transform the pass writes for an entry at `top` (the active card's left shift in the cards tier); a card
// mounting later is given the same
function transformOf(now: { active: string | null; tier: MarginTier }, id: string, top: number): string {
  return id === now.active && now.tier.kind === 'cards' ? `translate(${-MARGIN_ACTIVE_SHIFT_PX}px, ${top}px)` : `translateY(${top}px)`;
}

// The Add comment button beside a non-empty selection (C1), at the selection head's line. P4-B1: a component of its own,
// so a selection moving re-renders the button alone, and the layout pass moves it with the text (`updateRef`).
function AddComment({ editor, column, hosting, onComment, updateRef }: { editor: Editor; column: RefObject<HTMLDivElement | null>; hosting: string | null; onComment: () => boolean; updateRef: { current: () => void } }) {
  const [at, setAt] = useState<number | null>(null);
  const shown = useRef<number | null>(null);
  useEffect(() => {
    const show = (next: number | null) => {
      if (shown.current === next) return;
      shown.current = next;
      setAt(next);
    };
    const update = () => {
      const root = column.current;
      if (editor.isDestroyed || !root || !editor.isEditable || !editor.isFocused) return show(null);
      const { selection } = editor.state;
      if (selection.empty || hosting !== null) return show(null);
      const head = editor.view.coordsAtPos(selection.head);
      show(Math.round(head.top - root.getBoundingClientRect().top));
    };
    update();
    updateRef.current = update;
    editor.on('selectionUpdate', update);
    editor.on('focus', update);
    editor.on('blur', update);
    return () => {
      updateRef.current = () => {};
      editor.off('selectionUpdate', update);
      editor.off('focus', update);
      editor.off('blur', update);
    };
  }, [editor, column, hosting, updateRef]);
  if (at === null) return null;
  return (
    <button type="button" className="doc-margin-add" aria-label="Add comment" title="Add comment (⌘⌥M)" style={{ transform: `translateY(${at}px)` }} onMouseDown={(event) => event.preventDefault()} onClick={() => onComment()}>
      +
    </button>
  );
}

// The icon tier: a dot per group of entries whose anchors lie within one dot's height of the group's first (P4-B1, N2:
// the pass forms the groups and lays them, each member at its group's top), the dot carrying the group's count; the
// active thread's card (or the compose card) is overlaid beside the dot, reaching left over the page.
function IconRail({
  entries,
  groups,
  active,
  hosting,
  overlay,
  attach,
  card,
  handlersFor,
}: {
  entries: Entry[];
  groups: Groups;
  active: string | null;
  hosting: string | null;
  overlay: (() => ReactNode) | null;
  attach: (id: string) => (node: HTMLElement | null) => void;
  card: (entry: Entry, index: number, compact: boolean) => ReactNode;
  handlersFor: (id: string) => EntryHandlers;
}) {
  const open = hosting !== null ? entries.find((entry) => entry.id === hosting) : undefined;
  return (
    <>
      {entries.map((entry, index) => {
        const count = groups.get(entry.id) ?? 1; // 0: drawn under an earlier entry's dot
        const groupActive = active !== null && entries.slice(index, index + count).some((member) => member.id === active);
        const name = entry.thread ? `Comment by ${actorDisplay(entry.thread.createdBy).name}: ${firstWords(entry.thread)}` : 'Comment';
        return (
          <div key={entry.id} ref={attach(entry.id)} className="doc-margin-entry" data-margin-entry={entry.id} data-icon-entry="" data-active={entry.id === active ? '' : undefined}>
            {count > 0 && (
              <IconDot
                label={count > 1 ? `${name}, and ${count - 1} more` : name}
                title={entry.thread ? `${actorDisplay(entry.thread.createdBy).name}: ${firstWords(entry.thread)}` : undefined}
                count={count}
                active={groupActive}
                onDot={handlersFor(entry.id).onDot}
              />
            )}
            {(entry.id === hosting && overlay) || (entry.id === active && !open) ? (
              <div className="doc-margin-overlay" data-compose={entry.id === hosting ? '' : undefined}>
                {entry.id === hosting && overlay ? <Hosted render={overlay} /> : card(entry, index, false)}
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

// P4-B1: a thread's card, re-rendered only when its own inputs change (a list re-read hands an unchanged thread the
// same object, `useStableThreads`, and the handlers are kept per id)
const MarginCard = memo(function MarginCard({ thread, active, compact, index, count, readOnly, draft, handlers }: { thread: ThreadState; active: boolean; compact: boolean; index: number; count: number; readOnly: boolean; draft: string; handlers: EntryHandlers }) {
  return (
    <ThreadCard
      thread={thread}
      active={active}
      compact={compact}
      position={{ index, count }}
      readOnly={readOnly}
      draft={draft}
      onDraftChange={handlers.onDraftChange}
      onActivate={handlers.onActivate}
      onReply={handlers.onReply}
      onResolve={handlers.onResolve}
      onReopen={handlers.onReopen}
      onNext={handlers.onNext}
      onPrevious={handlers.onPrevious}
      onExit={handlers.onExit}
    />
  );
});

// P4-B1: the icon tier's dot, memoized the same way
const IconDot = memo(function IconDot({ label, title, count, active, onDot }: { label: string; title: string | undefined; count: number; active: boolean; onDot: () => void }) {
  return (
    <button type="button" className="doc-margin-icon" data-active={active ? '' : undefined} aria-label={label} title={title} onClick={onDot}>
      {count > 1 ? String(count) : ''}
    </button>
  );
});

// P4-B1: the renderer's compose card (the overlay surface), drawn again only when the page frame hands a new `render`
const Hosted = memo(function Hosted({ render }: { render: () => ReactNode }) {
  return <>{render()}</>;
});

// P4-B1: whether React's entries are the located ones (the same ids, in order, with the same threads)
function sameEntries(now: readonly Entry[], next: readonly Located[]): boolean {
  return now.length === next.length && now.every((entry, i) => entry.id === next[i]!.id && entry.thread === next[i]!.thread);
}

// P4-B1: the tab's open threads, each keeping its object while it is unchanged (the list re-reads every thread after
// each typing pause), and the list itself while none changed
function useStableThreads(states: readonly ThreadState[], tabId: string): ThreadState[] {
  const kept = useRef<ThreadState[]>([]);
  return useMemo(() => {
    const before = new Map(kept.current.map((thread) => [thread.id, thread]));
    const next = states.filter((thread) => thread.status === 'open' && thread.tabId === tabId).map((thread) => {
      const was = before.get(thread.id);
      return was && sameThread(was, thread) ? was : thread;
    });
    if (next.length !== kept.current.length || next.some((thread, i) => thread !== kept.current[i])) kept.current = next;
    return kept.current;
  }, [states, tabId]);
}

function sameThread(a: ThreadState, b: ThreadState): boolean {
  if (a.status !== b.status || a.live !== b.live || a.orphan !== b.orphan || a.quote !== b.quote || a.tabId !== b.tabId) return false;
  if (a.createdAt !== b.createdAt || a.resolvedAt !== b.resolvedAt || a.reopenedAt !== b.reopenedAt || a.messages.length !== b.messages.length) return false;
  return a.messages.every((message, i) => {
    const other = b.messages[i]!;
    return message === other || (message.id === other.id && message.at === other.at && message.body === other.body);
  });
}

const firstWords = (thread: ThreadState): string => (thread.messages[0]?.body ?? thread.quote).split(/\s+/).slice(0, 6).join(' ');

function sameTier(a: MarginTier, b: MarginTier): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'cards' && b.kind === 'cards') return a.width === b.width && a.reserve === b.reserve;
  if (a.kind === 'icons' && b.kind === 'icons') return a.reserve === b.reserve && a.overlap === b.overlap;
  return true;
}

// The passage of a thread scrolled into view with `block: 'nearest'` (the margin's own activations; the editor's
// `scrollIntoView` would centre it)
function scrollPassage(editor: Editor, threadId: string): void {
  if (editor.isDestroyed) return;
  const span = editor.view.dom.querySelector(`[data-thread="${CSS.escape(threadId)}"]`);
  span?.scrollIntoView?.({ block: 'nearest' });
}
