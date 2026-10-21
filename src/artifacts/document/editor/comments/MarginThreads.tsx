// The margin (P4-B1; docs/doperpowers/plans/2026-10-20-p4-b1-margin-comments.md D1 to D5, D7, D11, D12; the P4 spec
// §4.3): the shown tab's open threads as cards beside the page, each at its passage's first line, stacked by the pure
// layout (src/artifacts/comments/margin-layout.ts) from the pin, the last thread the human activated (the display
// plugin's `pinnedThread`), at its anchor, its neighbours pushed both ways; the pin outlives a deselect, so the stack
// stays where it left it, as Google Docs' does (LC-1, docs/doperpowers/evidence/p4/lc1/lc1-docs-margin.md item 3). The
// active card is marked by its form and its elevation, not moved sideways (item 2). Rendered inside the page's scroll
// box as the page's flex sibling (theme.css's row), so the cards scroll with the text and a scroll runs no layout;
// re-laid when the passages may have moved and on the thread set, the active thread, the pin, a card's resize, a tab
// switch, a view change and a font load. Positions are written to the entries' elements directly from the layout pass,
// so a keystroke re-renders nothing in React: the pass re-reads the anchors (the display's decorations, P4-B1), runs the
// layout and sets transforms. The page frame reports its moves from its frame callback (`relayoutRef`): a frame resize
// re-lays at once; a change that only edits the document (the owner's typing, an agent's write, the provisional layer's
// growth, X35) owes a pass that runs once the edits pause, within a ceiling, in an idle moment (margin-settle.ts; P4-B1's
// follow-up wave), so the frame that paints a keystroke never measures the margin; an edit that draws or removes a
// passage (a deletion, its undo) re-lays at once. Moves caused by an activation, an add or a resolve animate; moves
// caused by edits never, also when an animated pass catches up a stale margin (it lands the edits' moves first).
//
// Three tiers by the side space beside the page (margin-tiers.ts): cards, the icon rail (Docs' Minimize form: an icon
// per thread laid by the same stack at the icon gap, none merged, as Docs' three icons on adjacent lines, LC-1 item 7;
// the active thread's card overlaid beside its icon), and off under a 720 px body, where the drawer applies
// (DocumentEditor hides the margin then). View › Minimize gives the icon rail at any width; Hide hides the margin
// (DocumentEditor). The column reserves its width only while a thread or the compose card is open on the shown tab;
// otherwise it is 0 wide and the page sits centred alone.
//
// Only the human activates a thread [binding]: the editor's display plugin (a click, the local caret, the chords) and
// this margin's own clicks, J and K; the margin reads `active` from the editor's state and never sets it on a remote
// change. The compose card (P2's, hosted by the renderer through `overlay`) is an entry of the stack at the thread it
// is on (`hosting`), measured like any other; that thread's card yields to it meanwhile.
import type { Editor } from '@tiptap/core';
import { memo /* P4-B1 */, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject /* P4-B1 */ } from 'react';
import { actorDisplay } from '@shared/artifacts/actor';
import { ICON_GAP_PX, layoutMargin, MARGIN_CARD_INSET_PX, MARGIN_GAP_PX } from '../../../comments/margin-layout';
import { CARD_MIN_PX, ICON_PX, MARGIN_EDGE_GUTTER_PX, MARGIN_PAGE_GUTTER_PX, tierFor, type MarginTier } from '../../../comments/margin-tiers';
import { ThreadCard, type ThreadCardThread } from '../../../comments/ThreadCard';
import type { CommentsView } from '../../../comments/view';
import type { Doc } from '../../../yjs';
import { nanoid8 } from '../../schema';
import { getThread, reopen, reply, resolve, type Thread } from '../../threads';
import { createSettle } from './margin-settle';
import { activeThread, commentDisplayKey, COMMENTS_ORIGIN, drawnThreads, pinnedThread } from './plugins';
import type { CommentAuthor } from './surface';
import { useOpenThreads } from './use-threads';

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
   * P4-B1: filled with what the margin does when the passages may have moved, which the page frame calls from its frame
   * callback with what moved them: a frame resize (`resize`, a pass at once) or edits alone (`edit`: the document, an
   * agent's write, the provisional layer's growth; a pass owed until the edits pause). Never on a scroll.
   */
  relayoutRef?: { current: (move: PageMove) => void };
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

/** P4-B1: what moved the passages in a page frame's callback: the frame's size, or edits alone. */
export type PageMove = 'resize' | 'edit';

// P4-B1: what React draws (an entry's id and thread); the pass keeps where each is drawn beside it (`from`, the earliest
// position of its decorations; null for the compose card's thread drawn nowhere here), so an edit changes nothing React
// reads
interface Entry {
  id: string;
  thread: ThreadCardThread | null; // null: the compose card's thread before the list caught up with it
}
interface Located extends Entry {
  from: number | null;
  // P4-B1 (the follow-up wave): the anchor the last pass measured, which the catch-up in `pass` hands in for an entry no
  // longer drawn (a resolved thread's card, until the animated pass takes it out); measured from `from` otherwise
  anchor?: number;
}

type Cause = 'activation' | 'set' | 'layout';

const ANIMATED: ReadonlySet<Cause> = new Set<Cause>(['activation', 'set']);

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

export function MarginThreads({ editor, doc, tabId, author, readOnly, view, relayoutRef, hosting, overlay, onComment, onTier, enterRef, drafts, onDraftChange }: MarginThreadsProps) {
  const column = useRef<HTMLDivElement>(null);
  // P4-B1: the tab's open threads from the threads map, at once (a reply, a resolve, a new thread in the task it lands in)
  const open = useCardThreads(useOpenThreads(doc, tabId));

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
  // the tier told as it changes, and off when the margin goes (the panel opening, Hide, a version shown), so the editor
  // never reads a tier the margin no longer draws; the latest callback through a ref, so a new one is not a going
  const onTierRef = useRef(onTier);
  onTierRef.current = onTier;
  useEffect(() => void onTierRef.current?.(tier), [tier]);
  useEffect(() => () => onTierRef.current?.({ kind: 'off' }), []);

  // ── the active thread and the pin, the editor's ──
  const [active, setActive] = useState<string | null>(() => activeThread(editor.state));
  // P4-B1: the pin as React last saw it, so a pin moving with no active change (a resolve of the pinned thread) still
  // runs an animated pass; the pass itself reads the editor's
  const [pin, setPin] = useState<string | null>(() => pinnedThread(editor.state));
  const passSoon = useRef<() => void>(() => {});
  useEffect(() => {
    const report = ({ transaction }: { transaction: { getMeta(key: unknown): unknown } }) => {
      setActive(activeThread(editor.state));
      setPin(pinnedThread(editor.state));
      // P4-B1: the display redrawn for the threads map (a reopen, a new thread drawn): what is drawn may have changed
      const meta = transaction.getMeta(commentDisplayKey) as { threads?: true } | undefined;
      if (meta?.threads) passSoon.current();
    };
    setActive(activeThread(editor.state));
    setPin(pinnedThread(editor.state));
    editor.on('transaction', report);
    return () => {
      editor.off('transaction', report);
    };
  }, [editor]);

  // ── the entries: the open threads of this tab drawn here, in document order ──
  const byId = useMemo(() => new Map(open.map((thread) => [thread.id, thread])), [open]);
  const [entries, setEntries] = useState<Entry[]>([]);
  // P4-B1: the threads wanted here, the compose card's among them regardless; which are drawn (an orphan is not, Z3) and
  // where is read from the display's decorations at each pass
  const wantedKey = useMemo(() => {
    const ids = open.map((thread) => thread.id);
    if (hosting !== null && !ids.includes(hosting)) ids.push(hosting);
    return ids.join(' ');
  }, [open, hosting]);
  // the heights, measured as the cards resize; tops written straight to the elements
  const heights = useRef(new Map<string, number>());
  const nodes = useRef(new Map<string, HTMLElement>());
  const tops = useRef(new Map<string, number>());
  // P4-B1: the entries the last pass put at the column's top for want of a passage (the compose card's thread before
  // the display draws it, or another tab's)
  const unlocated = useRef(new Set<string>());
  const passes = useRef(0);
  // P4-B1: what a pass reads (the committed render's), the last pass's located entries and cause
  const latest = useRef({ wantedKey, byId, hosting, tier, entries });
  useLayoutEffect(() => {
    latest.current = { wantedKey, byId, hosting, tier, entries };
  });
  const located = useRef<Located[]>([]);
  // P4-B1 (the follow-up wave): each entry's anchor as the last pass measured it (the column's coordinates, before the
  // inset), for the catch-up
  const anchors = useRef(new Map<string, number>());
  const lastCause = useRef<Cause>('layout');
  const updateAdd = useRef<() => void>(() => {});
  // P4-B1 (the follow-up wave): the pin the last pass laid the stack from, and the pass the edits owe (margin-settle.ts),
  // which runs the latest pass through `settleRun`
  const laidPin = useRef<string | null>(null);
  const settleRun = useRef<() => void>(() => {});
  const settle = useMemo(() => createSettle(() => settleRun.current()), []);
  useEffect(() => () => settle.dispose(), [settle]);

  // P4-B1: the layout pass, with its cause: the anchors re-read (the character after each thread's first position, so a
  // passage starting at a soft wrap anchors on the line its first character is drawn on, P6), the stack laid from the
  // pin (the editor's, read here; one drawn nowhere here, an orphan's or another tab's, is no pin), the transforms
  // written. Each entry sits Docs' inset below its line (LC-1 items 1 and 7: a card's top and an icon's alike); the icon
  // tier lays every entry as an icon, ICON_PX tall at the icon gap.
  // P4-B1 (the follow-up wave): `pinAs` lays the stack from that pin rather than the editor's (the catch-up in `pass`).
  // Every pass settles what the edits owed, the wait written on the column (`data-stale-max`: the longest since the
  // attribute was last cleared, which the scale gate reads)
  const place = useCallback((cause: Cause, pinAs?: string | null) => {
    const root = column.current;
    if (!root) return;
    const { tier } = latest.current;
    const list = located.current;
    const origin = root.getBoundingClientRect().top;
    const anchorOf = (entry: Located) => entry.anchor ?? (entry.from === null || editor.isDestroyed ? 0 : Math.round(editor.view.coordsAtPos(entry.from, 1).top - origin));
    anchors.current = new Map(list.map((entry) => [entry.id, anchorOf(entry)]));
    const icons = tier.kind === 'icons';
    const items = list.map((entry) => ({ id: entry.id, anchor: anchors.current.get(entry.id)! + MARGIN_CARD_INSET_PX, height: icons ? ICON_PX : (heights.current.get(entry.id) ?? 0) }));
    const pin = pinAs !== undefined ? pinAs : editor.isDestroyed ? null : pinnedThread(editor.state);
    const pinned = pin !== null && list.some((entry) => entry.id === pin && entry.from !== null) ? pin : null;
    const placed = layoutMargin({ entries: items, pinned, gap: icons ? ICON_GAP_PX : MARGIN_GAP_PX });
    tops.current = placed.tops;
    laidPin.current = pinned;
    const waited = settle.settled();
    if (waited !== null) root.dataset.staleMax = String(Math.max(Number(root.dataset.staleMax ?? 0), Math.round(waited)));
    // P4-B1: an animated cause animates its moves; an unanimated pass that moves nothing (the edit's own frame after an
    // add, which now reaches the margin in the same task) leaves a running transition alone, and one that moves a card
    // ends it there (an edit's moves never animate)
    // An entry the last pass put at the top for want of its passage, now located (the compose card's thread once the
    // display draws it), jumps to its line unanimated: the card appears there rather than flying in from the top
    const moves: Array<[HTMLElement, string, boolean]> = [];
    const wasUnlocated = unlocated.current;
    unlocated.current = new Set(list.filter((entry) => entry.from === null).map((entry) => entry.id));
    for (const [id, top] of placed.tops) {
      const node = nodes.current.get(id);
      const transform = transformOf(top);
      if (node && node.style.transform !== transform) moves.push([node, transform, wasUnlocated.has(id) && !unlocated.current.has(id)]);
    }
    if (ANIMATED.has(cause)) root.setAttribute('data-animate', '');
    else if (moves.length > 0) root.removeAttribute('data-animate');
    root.style.setProperty('--doc-margin-height', `${Math.ceil(placed.height)}px`);
    for (const [node, transform, jump] of moves) {
      if (!jump) {
        node.style.transform = transform;
        continue;
      }
      node.style.transition = 'none';
      node.style.transform = transform;
      void getComputedStyle(node).transform; // the jump applied before the transition is restored
      node.style.transition = '';
    }
    passes.current += 1;
    root.dataset.relayouts = String(passes.current);
    updateAdd.current();
  }, [editor, settle]);

  // P4-B1: a pass with its cause: the threads located (React told only when the drawn set changed), the mounted cards'
  // heights read when React has just drawn them (`measure`: an activation grows one card and compacts another), then laid.
  // What is drawn is the display's decorations (`drawnThreads`: one walk of about a hundred decorations, no document or
  // DOM scan), in document order, ties to the older thread.
  const locate = useCallback((): Located[] | null => {
    const { wantedKey, byId, hosting, tier } = latest.current;
    if (!column.current || tier.kind === 'off' || editor.isDestroyed) return null;
    const drawn = drawnThreads(editor.state);
    const wanted = wantedKey === '' ? [] : wantedKey.split(' ');
    const list: Located[] = wanted
      .filter((id) => drawn.has(id))
      .map((id) => ({ id, from: drawn.get(id)!, thread: byId.get(id) ?? null }))
      .sort((a, b) => a.from - b.from);
    // the compose card's thread drawn nowhere here (another tab's) heads the stack at the column's top
    if (hosting !== null && !drawn.has(hosting)) list.unshift({ id: hosting, from: null, thread: byId.get(hosting) ?? null });
    return list;
  }, [editor]);
  const pass = useCallback(
    (cause: Cause, measure: boolean) => {
      const list = locate();
      if (list === null) return;
      // P4-B1 (the follow-up wave): an animated pass over a margin the edits left stale lands the edits' moves first,
      // unanimated, from the stack as last laid (every entry of it, in its order, at its passage's line now; one no longer
      // drawn, a resolve's, at the anchor last measured for it; one unlocated still unlocated; its heights, its pin), so
      // an activation, an add or a resolve that catches the margin up animates its own moves alone (D4): a resolved card
      // leaves and the stack closes up in the animated pass, an added one enters there. The second `place` reads the
      // column's rect first, which applies those moves before the animated ones are written
      if (ANIMATED.has(cause) && settle.stale) {
        const now = new Map(list.map((entry) => [entry.id, entry.from]));
        located.current = located.current.map((entry) => {
          const from = now.get(entry.id);
          if (from !== undefined) return { ...entry, from };
          return entry.from === null ? entry : { ...entry, anchor: anchors.current.get(entry.id) };
        });
        place('layout', laidPin.current);
      }
      located.current = list;
      if (!sameEntries(latest.current.entries, list)) setEntries(list.map(({ id, thread }) => ({ id, thread })));
      lastCause.current = cause;
      if (measure) for (const [id, node] of nodes.current) heights.current.set(id, Math.round(node.getBoundingClientRect().height));
      place(cause);
    },
    [locate, place, settle],
  );
  const passRef = useRef(pass);
  passRef.current = pass;
  settleRun.current = () => passRef.current('layout', false);
  // P4-B1: after the display's redraw for the threads map, a pass caused by the set's change (an add, a resolve's
  // close-up, a reopen animate, D4 and Z1). The display's observer runs before React re-reads the list, so this pass,
  // not React's later one, is the one that moves the cards
  passSoon.current = () => passRef.current('set', false);

  // the passes React's state asks for: the thread set, the active thread, the pin, the tier and the hosting thread (the
  // first layout is not animated, D4; the pin's move is an activation's)
  const previous = useRef<{ active: string | null; pin: string | null; set: string } | null>(null);
  useLayoutEffect(() => {
    if (tier.kind === 'off') return;
    const set = `${wantedKey}|${hosting ?? ''}`;
    const was = previous.current;
    previous.current = { active, pin, set };
    pass(was === null ? 'layout' : was.active !== active || was.pin !== pin ? 'activation' : was.set !== set ? 'set' : 'layout', true);
  }, [wantedKey, byId, hosting, active, pin, tier, pass]);
  // P4-B1: the passages' moves are the page frame's to report, from its frame callback. A frame resize re-lays at once.
  // Edits alone (the follow-up wave) owe the pass, which runs once they pause (margin-settle.ts), unless they drew or
  // removed a passage (a deletion, its undo; the compose card's thread moved between its line and the column's top by
  // one): the drawn set is read from the display's decorations, nothing measured
  useEffect(() => {
    if (!relayoutRef) return;
    relayoutRef.current = (move) => {
      if (move === 'resize') return pass('layout', false);
      const list = locate();
      if (list === null) return;
      if (sameDrawn(list, located.current)) settle.changed();
      else pass('layout', false);
    };
    return () => {
      relayoutRef.current = () => {};
    };
  }, [relayoutRef, pass, locate, settle]);

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
    if (top !== undefined) node.style.transform = transformOf(top);
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
  // P4-B1: read from the tab's open threads (the threads map, at once): a thread leaving the list resolved is announced
  const seen = useRef(new Map<string, number>());
  useEffect(() => {
    const notes: string[] = [];
    const now = new Set<string>();
    for (const thread of open) {
      now.add(thread.id);
      const before = seen.current.get(thread.id);
      if (before !== undefined && thread.messages.length > before && thread.id !== active) {
        const last = thread.messages[thread.messages.length - 1];
        if (last && last.by.kind !== 'human') notes.push(`${actorDisplay(last.by).name} replied`);
      }
      seen.current.set(thread.id, thread.messages.length);
    }
    for (const id of [...seen.current.keys()]) {
      if (now.has(id)) continue;
      seen.current.delete(id);
      if (getThread(doc, id)?.status === 'resolved') notes.push('Comment resolved');
    }
    if (notes.length > 0) setAnnounced(notes.join('. '));
  }, [open, active, doc]);

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
      // an icon opens its thread's card; the open card's icon closes it
      const open = id === active;
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
  // P4-B1: the geometry chrome.css draws from (LC-1 items 6 and 7): the column's basis, the drawn card's width (the
  // icon tier's overlaid card at the least card's), the gutters, the gaps and the icon
  const style = {
    '--doc-margin-reserve': `${reserved ? tier.reserve : 0}px`,
    '--doc-margin-card': `${tier.kind === 'cards' ? Math.floor(tier.width) : CARD_MIN_PX}px`,
    '--doc-margin-page-gutter': `${MARGIN_PAGE_GUTTER_PX}px`,
    '--doc-margin-edge-gutter': `${MARGIN_EDGE_GUTTER_PX}px`,
    '--doc-margin-gap': `${MARGIN_GAP_PX}px`,
    '--doc-margin-icon': `${ICON_PX}px`,
    '--doc-margin-icon-gap': `${ICON_GAP_PX}px`,
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
      {tier.kind === 'icons' && <IconRail entries={entries} active={active} hosting={hosting} overlay={overlay} attach={attach} card={card} handlersFor={handlersFor} />}
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

// P4-B1: the transform the pass writes for an entry at `top` (no sideways shift: Docs' active card stays in the column,
// LC-1 item 2); a card mounting later is given the same
function transformOf(top: number): string {
  return `translateY(${top}px)`;
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

// The icon tier: an icon per thread (P4-B1, N2 on LC-1 item 7: none merged, the pass lays them as it lays cards); the
// active thread's card (or the compose card) is overlaid beside its icon, reaching left over the page.
function IconRail({
  entries,
  active,
  hosting,
  overlay,
  attach,
  card,
  handlersFor,
}: {
  entries: Entry[];
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
        const name = entry.thread ? `Comment by ${actorDisplay(entry.thread.createdBy).name}: ${firstWords(entry.thread)}` : 'Comment';
        return (
          <div key={entry.id} ref={attach(entry.id)} className="doc-margin-entry" data-margin-entry={entry.id} data-icon-entry="" data-active={entry.id === active ? '' : undefined} data-compose={entry.id === hosting && overlay ? '' : undefined}>
            <IconDot label={name} title={entry.thread ? `${actorDisplay(entry.thread.createdBy).name}: ${firstWords(entry.thread)}` : undefined} active={entry.id === active} onDot={handlersFor(entry.id).onDot} />
            {(entry.id === hosting && overlay) || (entry.id === active && !open) ? (
              <div className="doc-margin-overlay">
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
// same object, `useOpenThreads`, and the handlers are kept per id)
const MarginCard = memo(function MarginCard({ thread, active, compact, index, count, readOnly, draft, handlers }: { thread: ThreadCardThread; active: boolean; compact: boolean; index: number; count: number; readOnly: boolean; draft: string; handlers: EntryHandlers }) {
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

// P4-B1: the icon tier's icon, memoized the same way
const IconDot = memo(function IconDot({ label, title, active, onDot }: { label: string; title: string | undefined; active: boolean; onDot: () => void }) {
  return <button type="button" className="doc-margin-icon" data-active={active ? '' : undefined} aria-label={label} title={title} onClick={onDot} />;
});

// P4-B1: the renderer's compose card (the overlay surface), drawn again only when the page frame hands a new `render`
const Hosted = memo(function Hosted({ render }: { render: () => ReactNode }) {
  return <>{render()}</>;
});

// P4-B1 (the follow-up wave): whether two located lists draw the same threads in the same order, each at a passage or at
// the column's top alike (the compose card's thread stays an entry, at the top, once its passage is deleted)
function sameDrawn(a: readonly Located[], b: readonly Located[]): boolean {
  return a.length === b.length && a.every((entry, i) => entry.id === b[i]!.id && (entry.from === null) === (b[i]!.from === null));
}

// P4-B1: whether React's entries are the located ones (the same ids, in order, with the same threads)
function sameEntries(now: readonly Entry[], next: readonly Located[]): boolean {
  return now.length === next.length && now.every((entry, i) => entry.id === next[i]!.id && entry.thread === next[i]!.thread);
}

// P4-B1: the card's form of each open thread (a thread the margin draws has live text: no orphan), kept per thread
// object, so an unchanged thread keeps its card's input
function useCardThreads(threads: readonly Thread[]): readonly ThreadCardThread[] {
  const cards = useRef(new WeakMap<Thread, ThreadCardThread>());
  return useMemo(
    () =>
      threads.map((thread) => {
        let card = cards.current.get(thread);
        if (!card) {
          card = { ...thread, orphan: false };
          cards.current.set(thread, card);
        }
        return card;
      }),
    [threads],
  );
}

const firstWords = (thread: ThreadCardThread): string => (thread.messages[0]?.body ?? thread.quote).split(/\s+/).slice(0, 6).join(' ');

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
