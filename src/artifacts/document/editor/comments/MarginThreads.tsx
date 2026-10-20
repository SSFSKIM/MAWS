// The margin (P4-B1; docs/doperpowers/plans/2026-10-20-p4-b1-margin-comments.md D1 to D5, D7, D11, D12; the P4 spec
// §4.3): the shown tab's open threads as cards beside the page, each at its passage's first line, stacked by the pure
// layout (src/artifacts/comments/margin-layout.ts) with the active thread pinned at its anchor and shifted left, its
// neighbours pushed both ways. Rendered inside the page's scroll box as the page's flex sibling (theme.css's row), so
// the cards scroll with the text and a scroll runs no layout; re-laid on `layoutKey` (an edit, a frame resize, the
// provisional layer's growth, X35), the thread set, the active thread, a card's resize, a tab switch and a font load.
// Positions are written to the entries' elements directly from the layout pass, so a keystroke re-renders nothing in
// React: it re-reads the anchors (the marks' kept spans, locate.ts), runs the layout and sets transforms. Moves caused
// by an activation, an add or a resolve animate; moves caused by edits never.
//
// Three tiers by the side space beside the page (margin-tiers.ts): cards, the icon rail (Docs' Minimize form: a dot at
// each anchor, colliding dots merged into a count, the active thread's card overlaid beside its dot), and off under a
// 720 px body, where the drawer applies (DocumentEditor hides the margin then). View › Minimize gives the icon rail at
// any width; Hide hides the margin (DocumentEditor). The column reserves its width only while a thread or the compose
// card is open on the shown tab; otherwise it is 0 wide and the page sits centred alone.
//
// Only the human activates a thread [binding]: the editor's display plugin (a click, the local caret, the chords) and
// this margin's own clicks, J and K; the margin reads `active` from the editor's state and never sets it on a remote
// change. The compose card (P2's, hosted by the renderer through `overlay`) is an entry of the stack at the thread it
// is on (`hosting`), measured like any other; that thread's card yields to it meanwhile.
import type { Editor } from '@tiptap/core';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
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
  /** Changes when passages may have moved (an edit, a frame resize, the provisional layer's growth); never on a scroll. */
  layoutKey: string;
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
}

interface Entry {
  id: string;
  element: Element;
  thread: ThreadState | null; // null: the compose card's thread before the list caught up with it
}

type Cause = 'activation' | 'set' | 'layout';

const ANIMATED: ReadonlySet<Cause> = new Set<Cause>(['activation', 'set']);

export function MarginThreads({ editor, doc, tabId, author, readOnly, view, layoutKey, hosting, overlay, onComment, onTier, enterRef }: MarginThreadsProps) {
  const column = useRef<HTMLDivElement>(null);
  const states = useThreadStates(doc);
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
  const open = useMemo(() => states.filter((thread) => thread.status === 'open' && thread.tabId === tabId), [states, tabId]);
  const byId = useMemo(() => new Map(open.map((thread) => [thread.id, thread])), [open]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const wanted = useMemo(() => {
    const ids = open.map((thread) => thread.id);
    if (hosting !== null && !byId.has(hosting)) ids.push(hosting);
    return ids;
  }, [open, byId, hosting]);
  // the heights, measured as the cards resize; tops written straight to the elements
  const heights = useRef(new Map<string, number>());
  const nodes = useRef(new Map<string, HTMLElement>());
  const tops = useRef(new Map<string, number>());
  const cause = useRef<Cause>('layout');
  const previous = useRef<{ active: string | null; ids: string }>({ active: null, ids: '' });
  const passes = useRef(0);

  const place = useCallback(
    (list: Entry[], activeId: string | null) => {
      const root = column.current;
      if (!root) return;
      const origin = root.getBoundingClientRect().top;
      const gap = MARGIN_GAP_PX;
      const laid = layoutMargin({
        entries: list.map(({ id, element }) => ({ id, anchor: Math.round(firstLineRect(element).top - origin), height: heights.current.get(id) ?? 0 })),
        active: activeId,
        gap,
      });
      tops.current = laid.tops;
      const animate = ANIMATED.has(cause.current);
      root.toggleAttribute('data-animate', animate);
      root.style.setProperty('--doc-margin-height', `${Math.ceil(laid.height)}px`);
      for (const { id } of list) {
        const node = nodes.current.get(id);
        const top = laid.tops.get(id);
        if (!node || top === undefined) continue;
        node.style.transform = id === activeId && tier.kind === 'cards' ? `translate(${-MARGIN_ACTIVE_SHIFT_PX}px, ${top}px)` : `translateY(${top}px)`;
      }
      passes.current += 1;
      root.dataset.relayouts = String(passes.current);
      cause.current = 'layout';
    },
    [tier.kind],
  );

  // the layout pass: on every key, the thread set, the active thread, the tier and the hosting thread; the entries'
  // elements are re-read each time (a kept span answers at once, a redrawn one is found again)
  useLayoutEffect(() => {
    if (tier.kind === 'off') return;
    const found = locator.refresh(wanted);
    const list: Entry[] = found.map(({ id, element }) => ({ id, element, thread: byId.get(id) ?? null }));
    // the compose card's thread drawn nowhere here (another tab's) heads the stack at the column's top
    if (hosting !== null && !found.some(({ id }) => id === hosting)) list.unshift({ id: hosting, element: column.current ?? editor.view.dom, thread: byId.get(hosting) ?? null });
    const ids = list.map(({ id }) => id).join(' ');
    const was = previous.current;
    if (was.active !== active) cause.current = 'activation';
    else if (was.ids !== ids) cause.current = 'set';
    previous.current = { active, ids };
    setEntries((now) => (now.length === list.length && now.every((entry, i) => entry.id === list[i]!.id && entry.element === list[i]!.element && entry.thread === list[i]!.thread) ? now : list));
    place(list, active);
  }, [layoutKey, wanted, byId, hosting, active, tier, locator, place, editor]);

  // a card's resize (its reply field growing, an agent's reply) re-lays the stack; the elements are observed as they mount
  const resizes = useMemo(() => (typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((records) => {
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
    if (changed) place(entriesRef.current, activeRef.current);
  })), [place]);
  useEffect(() => () => resizes?.disconnect(), [resizes]);
  const entriesRef = useRef(entries);
  const activeRef = useRef(active);
  entriesRef.current = entries;
  activeRef.current = active;
  // a mounted entry's first height re-lays the stack once the commit's refs have all run (one pass for the lot)
  const replaceQueued = useRef(false);
  const relayoutSoon = useCallback(() => {
    if (replaceQueued.current) return;
    replaceQueued.current = true;
    queueMicrotask(() => {
      replaceQueued.current = false;
      if (column.current) place(entriesRef.current, activeRef.current);
    });
  }, [place]);
  const attach = useCallback(
    (id: string) => (node: HTMLElement | null) => {
      const was = nodes.current.get(id);
      if (was && was !== node) {
        resizes?.unobserve(was);
        nodes.current.delete(id);
      }
      if (node) {
        nodes.current.set(id, node);
        const height = Math.round(node.getBoundingClientRect().height);
        if (heights.current.get(id) !== height) {
          heights.current.set(id, height);
          relayoutSoon();
        }
        const top = tops.current.get(id);
        if (top !== undefined) node.style.transform = `translateY(${top}px)`;
        resizes?.observe(node);
      }
    },
    [resizes, relayoutSoon],
  );

  // a font loading re-wraps the text: every anchor moves
  useEffect(() => {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (!fonts?.addEventListener) return;
    const loaded = () => place(entriesRef.current, activeRef.current);
    fonts.addEventListener('loadingdone', loaded);
    return () => fonts.removeEventListener('loadingdone', loaded);
  }, [place]);

  // ── the activations the margin makes (the human's): a card click, J and K; U and Escape return to the text ──
  const activate = useCallback((id: string | null) => void (!editor.isDestroyed && editor.commands.setActiveThread(id)), [editor]);
  const focusCard = (id: string) => {
    const node = nodes.current.get(id);
    (node?.querySelector<HTMLElement>('[data-thread]') ?? node)?.focus({ preventScroll: true });
  };
  const step = (from: string, by: 1 | -1) => {
    const ids = entriesRef.current.map(({ id }) => id);
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

  // ── the drafts (X36: one per thread, kept while a card is hidden) and the announcements (K4) ──
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(new Map());
  const draftOf = (id: string) => drafts.get(id) ?? '';
  const setDraft = (id: string, text: string) =>
    setDrafts((now) => {
      if ((now.get(id) ?? '') === text) return now;
      const next = new Map(now);
      if (text === '') next.delete(id);
      else next.set(id, text);
      return next;
    });
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

  // ── the Add comment button beside a non-empty selection (C1), at the selection head's line ──
  const [addAt, setAddAt] = useState<number | null>(null);
  useEffect(() => {
    if (!onComment) return;
    const update = () => {
      const root = column.current;
      if (editor.isDestroyed || !root || !editor.isEditable || !editor.isFocused) return setAddAt(null);
      const { selection } = editor.state;
      if (selection.empty || hosting !== null) return setAddAt(null);
      const head = editor.view.coordsAtPos(selection.head);
      setAddAt(Math.round(head.top - root.getBoundingClientRect().top));
    };
    update();
    editor.on('selectionUpdate', update);
    editor.on('focus', update);
    editor.on('blur', update);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('focus', update);
      editor.off('blur', update);
    };
  }, [editor, onComment, hosting, layoutKey]);

  // off (a narrow body): the column stays in the row, 0 wide and empty, so its measurements go on (the tier returns
  // when the body widens); it is no region then
  if (tier.kind === 'off') return <div ref={column} className="doc-margin" data-margin-tier="off" style={{ '--doc-margin-reserve': '0px' } as CSSProperties} />;
  const reserved = entries.length > 0 || hosting !== null;
  const style = {
    '--doc-margin-reserve': `${reserved ? tier.reserve : 0}px`,
    '--doc-margin-gap': `${MARGIN_GAP_PX}px`,
    '--doc-margin-overlap': `${tier.kind === 'icons' && reserved ? tier.overlap : 0}px`,
  } as CSSProperties;
  const write = (change: () => void) => !readOnly && change();
  const card = (entry: Entry, index: number, compact: boolean) => {
    const { thread } = entry;
    if (!thread) return null;
    return (
      <ThreadCard
        thread={thread}
        active={entry.id === active}
        compact={compact}
        position={{ index: index + 1, count: entries.length }}
        readOnly={readOnly}
        draft={draftOf(entry.id)}
        onDraftChange={(text: string) => setDraft(entry.id, text)}
        onActivate={() => activate(entry.id)}
        onReply={(body: string) => write(() => reply(doc, entry.id, { id: `${entry.id}:${nanoid8()}`, by: author.actor, at: author.now(), body }, COMMENTS_ORIGIN))}
        onResolve={() => write(() => resolve(doc, entry.id, author.actor, author.now(), COMMENTS_ORIGIN))}
        onReopen={() => write(() => reopen(doc, entry.id, author.actor, author.now(), COMMENTS_ORIGIN))}
        onNext={() => step(entry.id, 1)}
        onPrevious={() => step(entry.id, -1)}
        onExit={exit}
      />
    );
  };
  return (
    <div ref={column} className="doc-margin" role="region" aria-label="Comments" data-margin-tier={tier.kind} data-markup-occluder style={style}>
      {tier.kind === 'cards' &&
        entries.map((entry, index) => (
          <div key={entry.id} ref={attach(entry.id)} className="doc-margin-entry" data-margin-entry={entry.id} data-active={entry.id === active ? '' : undefined} data-compose={entry.id === hosting ? '' : undefined}>
            {entry.id === hosting && overlay ? overlay() : card(entry, index, entry.id !== active)}
          </div>
        ))}
      {tier.kind === 'icons' && <IconRail entries={entries} active={active} hosting={hosting} overlay={overlay} attach={attach} card={card} onActivate={activate} editor={editor} />}
      {/* the surface's card host stays mounted while no card is up (it claims a card as it opens and then names its thread) */}
      {overlay && (hosting === null || !entries.some((entry) => entry.id === hosting)) && (
        <div className="doc-margin-slot" data-margin-slot>
          {overlay()}
        </div>
      )}
      {addAt !== null && onComment && (
        <button type="button" className="doc-margin-add" aria-label="Add comment" title="Add comment (⌘⌥M)" style={{ transform: `translateY(${addAt}px)` }} onMouseDown={(event) => event.preventDefault()} onClick={() => onComment()}>
          +
        </button>
      )}
      <div className="doc-margin-live" aria-live="polite" data-margin-live>
        {announced}
      </div>
    </div>
  );
}

// The icon tier: a dot per entry at its anchor's top; dots closer than one dot's height merge into a count at the first
// one's anchor; the active thread's card (or the compose card) is overlaid beside its dot, reaching left over the page.
function IconRail({
  entries,
  active,
  hosting,
  overlay,
  attach,
  card,
  onActivate,
  editor,
}: {
  entries: Entry[];
  active: string | null;
  hosting: string | null;
  overlay: (() => ReactNode) | null;
  attach: (id: string) => (node: HTMLElement | null) => void;
  card: (entry: Entry, index: number, compact: boolean) => ReactNode;
  onActivate: (id: string | null) => void;
  editor: Editor;
}) {
  // the groups are formed from the laid tops, which the entries' elements carry as transforms; the margin lays the
  // dots as entries (one element each) and the groups are read from their anchors at render: an icon's entry element
  // is positioned by the layout pass like a card, so colliding ones are merged by the pass's own tops at the next render
  const shown = active !== null ? entries.find((entry) => entry.id === active) : undefined;
  const open = hosting !== null ? entries.find((entry) => entry.id === hosting) : undefined;
  return (
    <>
      {entries.map((entry, index) => {
        const merged = entry.id !== (open?.id ?? shown?.id) && index > 0 && entry.element === entries[index - 1]!.element; // the same passage element: one dot for both
        return (
          <div key={entry.id} ref={attach(entry.id)} className="doc-margin-entry" data-margin-entry={entry.id} data-icon-entry="" data-active={entry.id === active ? '' : undefined}>
            {!merged && (
              <button
                type="button"
                className="doc-margin-icon"
                data-active={entry.id === active ? '' : undefined}
                aria-label={entry.thread ? `Comment by ${actorDisplay(entry.thread.createdBy).name}: ${firstWords(entry.thread)}` : 'Comment'}
                title={entry.thread ? `${actorDisplay(entry.thread.createdBy).name}: ${firstWords(entry.thread)}` : undefined}
                onClick={() => {
                  onActivate(entry.id === active ? null : entry.id);
                  scrollPassage(editor, entry.id);
                }}
              >
                {countAt(entries, index, ICON_PX)}
              </button>
            )}
            {(entry.id === hosting && overlay) || (entry.id === active && !open) ? (
              <div className="doc-margin-overlay" data-compose={entry.id === hosting ? '' : undefined}>
                {entry.id === hosting && overlay ? overlay() : card(entry, index, false)}
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

// How many consecutive entries from `index` share the dot (their anchors within one dot's height); '' for one.
function countAt(entries: Entry[], index: number, within: number): string {
  const top = (entry: Entry) => firstLineRect(entry.element).top;
  const base = top(entries[index]!);
  let n = 1;
  while (index + n < entries.length && Math.abs(top(entries[index + n]!) - base) < within) n += 1;
  return n > 1 ? String(n) : '';
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
