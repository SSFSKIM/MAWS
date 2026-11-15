// The stack (UX wave U5b, M3 and M4; the execution document's §F): Review's one scroller, every file of the scope a
// section in the list's order. `useStack` resolves each file against its own read and the view state (its hunks, its
// mark, its fold) and orders the hunks the counter counts; `Stack` draws the sections and wires its scroller to the
// placer (`stack-place.ts`), which keeps the band, the live place and an outstanding reveal: a requested file, ↑ and
// ↓ (which unfold a folded file they land in), the place saved when the stack was last unmounted.
//
// Only the bodies in the band are drawn; every other unfolded section is a spacer of its last height, and a folded one
// is its header alone. A file's own read is asked only near the scroll position: while its section is unfolded and in
// the band, or while it holds a Viewed mark and its header is in the band (the read tells whether the mark still holds;
// M3 decision 13h, kept within the band).
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { AppSessionId } from '@shared/graph/ids';
import { openFile } from '../open-file';
import { FileSection } from './FileSection';
import { useLineCommentsContext } from './LineComments';
import { blocksOf, firstChangedLine, REVIEW_FILE_LINES_CAP, tooLarge, viewedSignature, type ReviewFile } from './review-model';
import { fileDiffOf, useReview, type DiffTarget, type ScopeDiff } from './review-store';
import { bodyLines, hunkOrder, isFolded, type FoldChoice, type StackHunk } from './stack-model';
import { EMPTY_BAND, StackPlacer, type Band } from './stack-place';
import { savePlace, setFold, toggleViewed, type ReviewMode, type ReviewUi } from './view-state';

export interface StackSection {
  file: ReviewFile;
  hunks: string[] | null; // what the body draws: the file's own, or those its read answered; null while none (unread, binary)
  blocks: string[][]; // `hunks` cut into the file's blocks (one per edit in Last turn)
  binary: boolean; // drawn as a binary: its kind, or an untracked file whose read answered a binary patch
  signature: string | null; // what a Viewed mark signs (its hunks, or a binary's header); null while they are not known
  viewed: boolean; // marked, and the mark holds (or its read has not answered yet)
  folded: boolean; // the fold rule's answer
  fetch: boolean; // its own read is wanted now
  failed: string | null; // its own read failed, with the message
  lines: number; // its body's rows for an estimate before it is measured: 0 when it draws no body, 1 for a line of words
  changed: boolean; // held under an open card while the scope's read brought other hunks for it (M5)
}

// UX wave U5b, M5 (§G, decision 10): a file under an open card holds still: its hunks and blocks as they were when the
// card opened, until the card goes or the person asks for the file's latest (Refresh). A hold is one scope's (`placeKey`):
// another scope's file of the same path draws its own hunks.
export interface HeldFile {
  placeKey: string;
  path: string;
  hunks: string[];
  blocks: string[][];
}

// The sections of a scope and the hunks the counter counts (§F): those of every loaded file, folded or not, that is not
// marked Viewed and not past the per-file cap, in stack order. Each file's section is made again only when what it is
// made from changed (its row in the list, its own read, its mark, its fold, its hold), so a file's read, mark or fold
// remakes that file's section and hunks alone.
export function useStack(input: { files: readonly ReviewFile[]; target: DiffTarget | null; placeKey: string; pastCap: boolean; ui: StoreApi<ReviewUi>; held?: HeldFile | null }): { sections: StackSection[]; order: StackHunk[] } {
  const { files, target, placeKey: key, pastCap, ui, held = null } = input;
  const marks = useStore(ui, (s) => s.viewed);
  const folds = useStore(ui, (s) => s.folds);
  const fetched = useReview((s) => s.files);
  // This stack's own sections: another surface over the same files makes its own, from its own folds, marks and hold.
  const [made] = useState(() => new WeakMap<ReviewFile, MadeSection>());
  return useMemo(() => {
    const sections: StackSection[] = [];
    const order: StackHunk[] = [];
    for (const file of files) {
      // P5 O7 M8: an untracked file is read on its own as Source control reads it (the `untracked` scope), so it shows as
      // added; a scope past its cap reads each file on its own; a binary past it reads its header (what its mark signs)
      const ownRead = target !== null && (file.kind === 'binary' ? file.header === null : file.hunks === null && !(file.kind === 'untracked' && file.path.endsWith('/')));
      const from: SectionInputs = {
        file,
        target,
        key,
        pastCap,
        load: ownRead && target ? fileDiffOf({ files: fetched }, target, file.path) : undefined,
        mark: marks.get(key)?.get(file.path),
        choice: folds.get(key)?.get(file.path),
        held: held !== null && held.placeKey === key && held.path === file.path ? held : null,
      };
      const entry = sectionFor(made, from, ownRead);
      sections.push(entry.section);
      for (const hunk of entry.hunks) order.push(hunk);
    }
    return { sections, order };
  }, [made, files, target, key, pastCap, marks, folds, fetched, held]);
}

// What one file's section is made from, and what was made.
interface SectionInputs {
  file: ReviewFile;
  target: DiffTarget | null;
  key: string;
  pastCap: boolean;
  load: ReturnType<typeof fileDiffOf>;
  mark: string | undefined;
  choice: FoldChoice | undefined;
  held: HeldFile | null;
}
interface MadeSection {
  from: SectionInputs;
  section: StackSection;
  hunks: StackHunk[];
}
const sameInputs = (a: SectionInputs, b: SectionInputs): boolean =>
  a.file === b.file && a.target === b.target && a.key === b.key && a.pastCap === b.pastCap && a.load === b.load && a.mark === b.mark && a.choice === b.choice && a.held === b.held;

// The section a stack last made for each of the list's files, by the file's own object (a re-read of the list makes new
// ones): made again only when one of its inputs differs.
function sectionFor(made: WeakMap<ReviewFile, MadeSection>, from: SectionInputs, ownRead: boolean): MadeSection {
  const was = made.get(from.file);
  if (was && sameInputs(was.from, from)) return was;
  const next = sectionOf(from, ownRead);
  made.set(from.file, next);
  return next;
}

function sectionOf(from: SectionInputs, ownRead: boolean): MadeSection {
  const { file, load, mark, choice, pastCap } = from;
  const untracked = file.kind === 'untracked';
  const untrackedDirectory = untracked && file.path.endsWith('/');
  const binary = file.kind === 'binary' || (untracked && load?.status === 'ok' && load.file?.kind === 'binary');
  const latest = binary ? null : (file.hunks ?? (load?.status === 'ok' ? (load.file?.hunks ?? []) : null));
  const hold = binary ? null : from.held;
  const hunks = hold ? hold.hunks : latest;
  const header = file.header ?? (load?.status === 'ok' ? (load.file?.header ?? null) : null);
  const markable = binary ? header !== null : !untrackedDirectory && hunks !== null;
  const signature = markable ? viewedSignature({ kind: binary ? 'binary' : file.kind, header }, hunks) : null;
  // A mark on a file whose own read has not answered yet holds until it does, so the file does not unfold meanwhile;
  // one that no longer signs the file's change has dropped, and unfolds it.
  const viewed = mark !== undefined && (signature === null ? ownRead : mark === signature);
  const dropped = mark !== undefined && signature !== null && mark !== signature;
  const folded = isFolded({ choice, viewed, dropped, pastCap });
  const failed = load?.status === 'error' ? load.message : null;
  const section: StackSection = {
    file,
    hunks,
    blocks: hold ? hold.blocks : hunks === null ? [] : blocksOf(hunks, file.hunks === null ? [hunks.length] : file.blocks),
    binary,
    signature,
    viewed,
    folded,
    fetch: ownRead && (!folded || mark !== undefined),
    failed,
    lines: estimateLines(file, hunks, binary || untrackedDirectory || (hunks === null && failed !== null)),
    changed: hold !== null && latest !== null && latest.join('\n') !== hold.hunks.join('\n'),
  };
  const counted = hunkOrder([{ path: file.path, hunks: section.hunks, blocks: section.blocks.map((block) => block.length), viewed: section.viewed }]);
  return { from, section, hunks: counted };
}

// What a body is estimated from before it is measured: nothing for a section that draws no body (a rename with no
// change), one row for a line of words (a binary, an untracked folder, a failed read, a file too large to draw), else
// its diff's lines, or its counts' while it is not read.
function estimateLines(file: ReviewFile, hunks: readonly string[] | null, words: boolean): number {
  if (words) return 1;
  if (hunks === null) return file.added + file.removed > REVIEW_FILE_LINES_CAP ? 1 : Math.max(1, file.added + file.removed);
  if (hunks.length === 0) return 0;
  return tooLarge({ hunks }) ? 1 : bodyLines({ hunks, added: file.added, removed: file.removed });
}

// The cards a surface's stack has handled, kept with the surface (its view state's store) rather than with a stack's
// mount: Review hidden and shown again remounts the stack, and an open card it already handled is not a new opening
// there (X-072: the saved place is restored, the card left where it is). `waiting`: the card waiting on its file's read,
// and the person's inputs in the scroller when it began; `cancelled`: a card whose opening the person's input during
// that wait cancelled, whose field's focus scroll is then not theirs either.
interface CardsHandled {
  card: number | null;
  waiting: { serial: number; inputs: number } | null;
  cancelled: number | null;
}
const cardsHandled = new WeakMap<StoreApi<ReviewUi>, CardsHandled>();
function cardsOf(ui: StoreApi<ReviewUi>): CardsHandled {
  let cards = cardsHandled.get(ui);
  if (!cards) {
    cards = { card: null, waiting: null, cancelled: null };
    cardsHandled.set(ui, cards);
  }
  return cards;
}

// The browser's own scroll anchoring would move the scroller when a body above changes height, under the placer, which
// keeps the place itself; it is off here (inline, so it does not depend on a utility being generated).
const NO_SCROLL_ANCHORING = { overflowAnchor: 'none' } as const;

export interface StackProps {
  appSessionId: AppSessionId;
  ui: StoreApi<ReviewUi>;
  sections: readonly StackSection[];
  order: readonly StackHunk[];
  placeKey: string; // the stack is mounted once per key: its place is saved under it
  target: DiffTarget | null;
  scopeDiff: ScopeDiff | undefined;
  width: number; // the stack's, 0 before a layout
  mode: ReviewMode; // as drawn
  wrap: boolean;
  reveal: { path: string; n: number } | null; // a requested file the list holds, by its identity
  onRevealed(): void;
  onRefresh(path: string): void; // a file held under an open card takes its latest hunks (M5)
}

export function Stack({ appSessionId, ui, sections, order, placeKey: key, target, scopeDiff, width, mode, wrap, reveal, onRevealed, onRefresh }: StackProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const placer = useRef<StackPlacer | null>(null);
  const [band, setBand] = useState<Band>(EMPTY_BAND);
  const hunk = useStore(ui, (s) => s.hunk);
  const navigate = useStore(ui, (s) => s.navigate);
  const current = Math.min(hunk, Math.max(0, order.length - 1));
  const card = useLineCommentsContext()?.card ?? null; // M5: this surface's open card, under its line
  const waiting = useLineCommentsContext()?.waiting ?? null; // M5 fix 5: the open card's file, its place waiting on its read

  // Mounted: the placer, the observers of every box that can move the page, and the saved place as the first reveal;
  // unmounted, the place in force is saved.
  const observer = useRef<{ ro: ResizeObserver; watched: Set<Element> } | null>(null);
  useLayoutEffect(() => {
    const el = scroller.current!;
    const placed = new StackPlacer({
      band: setBand,
      saved: (place) => ui.setState((s) => savePlace(s, key, place)),
      counted: (index) => ui.setState({ hunk: index }),
    });
    placed.attach(el, ui.getState().places.get(key) ?? null);
    placer.current = placed;
    const release = () => placed.release();
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    // A card still waiting on its read across a remount opens where it is: the saved place is restored meanwhile.
    const cards = cardsOf(ui);
    if (cards.waiting) cards.waiting = { serial: cards.waiting.serial, inputs: -1 };
    // The field of a card whose opening was cancelled takes the keyboard (as it mounts in its row, or later): the
    // browser's scroll to it is not the person's.
    const focused = (event: FocusEvent) => {
      const now = cardsOf(ui);
      if (now.cancelled === null || now.cancelled !== now.card) return;
      if (event.target instanceof Element && event.target.closest('[data-review-card-row]')) placed.holdFocus();
    };
    el.addEventListener('focusin', focused);
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => placed.relayout());
      ro.observe(el);
      observer.current = { ro, watched: new Set([el]) };
    }
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      el.removeEventListener('focusin', focused);
      observer.current?.ro.disconnect();
      observer.current = null;
      placer.current = null;
      const place = placed.detach();
      if (place) ui.setState((s) => savePlace(s, key, place));
    };
  }, [ui, key]);

  // Every commit is a layout change: the placer takes the sections as drawn, the requests made since (a file, a hunk
  // jump), and applies the place again.
  const handled = useRef<{ reveal: { path: string; n: number } | null; navigate: number }>({ reveal: null, navigate });
  useLayoutEffect(() => {
    const placed = placer.current;
    if (!placed) return;
    placed.update({ sections: sections.map((section) => ({ path: section.file.path, folded: section.folded, lines: section.lines })), order, current });
    placed.drawn(band);
    const seen = handled.current;
    if (reveal === null) seen.reveal = null; // the request handled was cleared: the next one, even for the same file, is new
    if (reveal !== null && (seen.reveal?.path !== reveal.path || seen.reveal.n !== reveal.n)) {
      seen.reveal = reveal;
      if (sections.find((section) => section.file.path === reveal.path)?.folded) ui.setState((s) => setFold(s, key, reveal.path, 'open'));
      placed.revealSection(reveal.path);
      onRevealed();
    }
    if (seen.navigate !== navigate) {
      seen.navigate = navigate;
      const jump = order[current];
      if (jump) {
        if (sections.find((section) => section.file.path === jump.path)?.folded) ui.setState((s) => setFold(s, key, jump.path, 'open'));
        placed.revealHunk(jump);
      }
    }
    // M5: a card opened on a line out of view (the chip's newest comment: in a folded file, far from the scroll position,
    // or drawn above or below the viewport) is brought into view, its file unfolded; one opened where the person points
    // (their pointer held in the scroller) or on a line wholly in view stays where it is.
    // M5 fix 5: one whose file is folded in a scope past the cap waits on a read the fold holds back: the file unfolds, as
    // a request's reveal unfolds its file (§F), is read, and the card is revealed at its line above once it is placed.
    // The architect's review: the person's input in the scroller while the card waited on its read is theirs; the card
    // then opens under its line where that is, neither revealed nor shown.
    const cards = cardsOf(ui);
    if (waiting !== null && cards.waiting?.serial !== waiting.serial) {
      cards.waiting = { serial: waiting.serial, inputs: placed.inputCount() };
      if (sections.find((each) => each.file.path === waiting.path)?.folded) ui.setState((s) => setFold(s, key, waiting.path, 'open'));
    }
    if (card !== null && cards.card !== card.serial) {
      cards.card = card.serial;
      const section = sections.find((each) => each.file.path === card.path);
      const place = { path: card.path, row: { block: card.block, side: card.side, line: card.line }, offset: 0 };
      const movedOn = cards.waiting?.serial === card.serial && placed.inputCount() !== cards.waiting.inputs;
      if (movedOn) cards.cancelled = card.serial;
      else {
        if (section && (section.folded || (!placed.pointing() && !placed.inView(place)))) {
          if (section.folded) ui.setState((s) => setFold(s, key, card.path, 'open'));
          placed.revealPlace(place);
        }
        // the branch's task review: once drawn under its line, the card is shown down to its bottom (one opened where the
        // person points too: the field's scroll as it takes the keyboard can come after their gesture, or be overtaken by
        // a layout change); installed after its own reveal, which would replace it
        placed.showCard(place);
      }
    }
    if (card === null) placed.showCard(null);
    const watching = observer.current;
    if (watching) {
      for (const element of watching.watched) {
        if (element.isConnected) continue;
        watching.ro.unobserve(element);
        watching.watched.delete(element);
      }
      for (const section of scroller.current!.querySelectorAll(':scope > [data-review-file]')) {
        if (watching.watched.has(section)) continue;
        watching.ro.observe(section);
        watching.watched.add(section);
      }
    }
    placed.relayout();
  });

  const counted = order[current];
  return (
    <div
      ref={scroller}
      data-review-stack
      tabIndex={-1} /* M5 fix 2: where the keyboard goes when a comment’s card does; not a tab stop */
      onScroll={() => placer.current?.scrolled()}
      onWheel={() => placer.current?.interact()}
      onTouchStart={() => placer.current?.interact()}
      onTouchMove={() => placer.current?.interact()}
      onKeyDown={() => placer.current?.interact()}
      onPointerDown={() => placer.current?.press()}
      className="review-diff min-h-0 flex-1 overflow-y-auto overflow-x-hidden outline-accent -outline-offset-2 focus-visible:outline-2"
      style={NO_SCROLL_ANCHORING}
    >
      {sections.map((section) => {
        const { file, hunks } = section;
        const lineAt = (index: number) => (file.kind === 'untracked' ? 1 : hunks && hunks.length > 0 ? firstChangedLine(hunks[Math.min(index, hunks.length - 1)]) : null);
        const drawn = band.drawn.has(file.path);
        return (
          <FileSection
            key={file.path}
            section={section}
            drawn={drawn}
            near={drawn || band.near.has(file.path)}
            spacer={band.spacers.get(file.path) ?? 0}
            width={width}
            mode={mode}
            wrap={wrap}
            target={target}
            scopeDiff={scopeDiff}
            openLine={lineAt(counted?.path === file.path ? counted.index : 0)}
            firstLine={lineAt(0)}
            onFold={() => ui.setState((s) => setFold(s, key, file.path, section.folded ? 'open' : 'closed'))}
            onViewed={() => section.signature !== null && ui.setState((s) => toggleViewed(s, key, file.path, section.signature!))}
            onOpen={(line) => file.openPath !== null && openFile(appSessionId, file.openPath, line)}
            onRefresh={() => onRefresh(file.path)}
          />
        );
      })}
    </div>
  );
}
