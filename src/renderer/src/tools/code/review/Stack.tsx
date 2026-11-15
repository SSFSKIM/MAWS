// The stack (UX wave U5b, M3; the execution document's §F): Review's one scroller, every file of the scope a section in
// the list's order. `useStack` resolves each file against its own read and the view state (its hunks, its mark, its
// fold) and orders the hunks the counter counts; `Stack` draws the sections, scrolls to the counter's hunk when ↑ or ↓
// moves it, reports the hunk at the top when the person scrolls, and brings a requested file's section into view once.
//
// Every unfolded body is drawn here; the band, the place kept through a layout change and a jump into a folded file are
// M4's. A file's own read is asked while its section is unfolded, and while it holds a Viewed mark, which cannot be
// known to hold until the read answers.
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { AppSessionId } from '@shared/graph/ids';
import { openFile } from '../open-file';
import { FileSection } from './FileSection';
import { blocksOf, firstChangedLine, viewedSignature, type ReviewFile } from './review-model';
import { fileDiffOf, useReview, type DiffTarget, type ScopeDiff } from './review-store';
import { hunkOrder, isFolded, type StackHunk } from './stack-model';
import { setFold, toggleViewed, type ReviewMode, type ReviewUi } from './view-state';

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
}

// The sections of a scope and the hunks the counter counts: those of every unfolded section, loaded, not marked Viewed
// and not past the per-file cap, in stack order (M4 counts a folded file's too, and unfolds it at a jump).
export function useStack(input: { files: readonly ReviewFile[]; target: DiffTarget | null; placeKey: string; pastCap: boolean; ui: StoreApi<ReviewUi> }): { sections: StackSection[]; order: StackHunk[] } {
  const { files, target, placeKey: key, pastCap, ui } = input;
  const marks = useStore(ui, (s) => s.viewed);
  const folds = useStore(ui, (s) => s.folds);
  const fetched = useReview((s) => s.files);
  return useMemo(() => {
    const sections = files.map((file): StackSection => {
      const untracked = file.kind === 'untracked';
      const untrackedDirectory = untracked && file.path.endsWith('/');
      // P5 O7 M8: an untracked file is read on its own as Source control reads it (the `untracked` scope), so it shows as
      // added; a scope past its cap reads each file on its own; a binary past it reads its header (what its mark signs)
      const ownRead = target !== null && (file.kind === 'binary' ? file.header === null : file.hunks === null && !untrackedDirectory);
      const load = ownRead && target ? fileDiffOf({ files: fetched }, target, file.path) : undefined;
      const binary = file.kind === 'binary' || (untracked && load?.status === 'ok' && load.file?.kind === 'binary');
      const hunks = binary ? null : (file.hunks ?? (load?.status === 'ok' ? (load.file?.hunks ?? []) : null));
      const header = file.header ?? (load?.status === 'ok' ? (load.file?.header ?? null) : null);
      const markable = binary ? header !== null : !untrackedDirectory && hunks !== null;
      const signature = markable ? viewedSignature({ kind: binary ? 'binary' : file.kind, header }, hunks) : null;
      const mark = marks.get(key)?.get(file.path);
      // A mark on a file whose own read has not answered yet holds until it does, so the file does not unfold meanwhile.
      const viewed = mark !== undefined && (signature === null ? ownRead : mark === signature);
      const folded = isFolded({ choice: folds.get(key)?.get(file.path), viewed, pastCap });
      return {
        file,
        hunks,
        blocks: hunks === null ? [] : blocksOf(hunks, file.hunks === null ? [hunks.length] : file.blocks),
        binary,
        signature,
        viewed,
        folded,
        fetch: ownRead && (!folded || mark !== undefined),
        failed: load?.status === 'error' ? load.message : null,
      };
    });
    const order = hunkOrder(sections.filter((section) => !section.folded).map((section) => ({ path: section.file.path, hunks: section.hunks, blocks: section.blocks.map((block) => block.length), viewed: section.viewed })));
    return { sections, order };
  }, [files, target, key, pastCap, marks, folds, fetched]);
}

// ---- where a hunk is in the scroller ---------------------------------------------------------------------------------

// A hunk's row inside its block: the one showing its first line's number (unified rows carry `data-line-{new,old}-num`,
// split rows `data-line-num` on their side), or the header row the library drew above it when a gap precedes it.
function rowOf(block: Element, { side, line }: StackHunk['anchor']): HTMLElement | null {
  const cell = block.querySelector(`tr[data-state="diff"]:not([data-side]) [data-line-${side}-num="${line}"]`) ?? block.querySelector(`tr[data-state="diff"][data-side="${side}"] [data-line-num="${line}"]`);
  const row = cell?.closest<HTMLElement>('tr') ?? null;
  const header = row ? block.querySelector<HTMLElement>(`tr[data-state="hunk"][data-line="${row.dataset.line}-hunk"]:not([data-side="new"])`) : null;
  return header ?? row;
}

const offsetIn = (scroller: HTMLElement, el: Element) => el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
const atEnd = (scroller: HTMLElement) => scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 1;

const sectionsIn = (scroller: HTMLElement) => new Map([...scroller.querySelectorAll<HTMLElement>('[data-review-file]')].map((section) => [section.dataset.reviewFile!, section]));

// The scroller's top at which each hunk's first row stands just under its section's sticky header; null while undrawn.
function stopsOf(scroller: HTMLElement, order: readonly StackHunk[]): (number | null)[] {
  const sections = sectionsIn(scroller);
  return order.map((hunk) => {
    const section = sections.get(hunk.path);
    const block = section?.querySelectorAll('[data-review-block]')[hunk.block];
    const row = block ? rowOf(block, hunk.anchor) : null;
    if (!section || !row) return null;
    return offsetIn(scroller, row) - (section.querySelector('[data-review-file-header]')?.getBoundingClientRect().height ?? 0);
  });
}

export interface StackProps {
  appSessionId: AppSessionId;
  ui: StoreApi<ReviewUi>;
  sections: readonly StackSection[];
  order: readonly StackHunk[];
  placeKey: string;
  target: DiffTarget | null;
  scopeDiff: ScopeDiff | undefined;
  width: number; // the stack's, 0 before a layout
  mode: ReviewMode; // as drawn
  wrap: boolean;
  reveal: { path: string; n: number } | null; // a requested file the list holds, by its identity
  onRevealed(): void;
}

export function Stack({ appSessionId, ui, sections, order, placeKey: key, target, scopeDiff, width, mode, wrap, reveal, onRevealed }: StackProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const hunk = useStore(ui, (s) => s.hunk);
  const navigate = useStore(ui, (s) => s.navigate);
  const current = Math.min(hunk, Math.max(0, order.length - 1));

  // ↑ and ↓: the counter's hunk to the top, under its section's header (a hunk in the last screenful cannot reach it).
  const navigated = useRef(navigate);
  const jumping = useRef(false); // a jump moved the scroller: its own scroll event is not the person's
  useLayoutEffect(() => {
    if (navigated.current === navigate) return;
    navigated.current = navigate;
    const el = scroller.current;
    const stop = el && order[current] ? stopsOf(el, [order[current]])[0] : null;
    if (!el || stop === null) return;
    const top = Math.max(0, Math.min(stop, el.scrollHeight - el.clientHeight));
    if (Math.abs(top - el.scrollTop) < 1) return; // no move, so no scroll event to ignore
    jumping.current = true;
    el.scrollTop = top;
  }, [navigate, current, order]);

  // A request that named a file: its section unfolded and brought to the top, once.
  const revealPath = reveal?.path ?? null;
  const revealN = reveal?.n ?? 0;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (revealPath === null || !el) return;
    if (sections.find((section) => section.file.path === revealPath)?.folded) ui.setState((s) => setFold(s, key, revealPath, 'open'));
    const section = sectionsIn(el).get(revealPath);
    if (section) el.scrollTop = offsetIn(el, section);
    onRevealed();
  }, [revealPath, revealN, sections, ui, key, onRevealed]);

  // Scrolling by hand moves the counter to the hunk at the top (the first before any has scrolled past); at the end of
  // the scroller a later hunk jumped to stands.
  const scrolled = () => {
    if (jumping.current) {
      jumping.current = false;
      return;
    }
    const el = scroller.current;
    if (!el) return;
    let at = 0;
    stopsOf(el, order).forEach((stop, index) => {
      if (stop !== null && stop <= el.scrollTop + 4) at = index;
    });
    if (at < current && atEnd(el)) return;
    if (at !== current) ui.setState({ hunk: at });
  };

  const counted = order[current];
  return (
    <div ref={scroller} data-review-stack onScroll={scrolled} className="review-diff min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      {sections.map((section) => {
        const { file, hunks } = section;
        const lineAt = (index: number) => (file.kind === 'untracked' ? 1 : hunks && hunks.length > 0 ? firstChangedLine(hunks[Math.min(index, hunks.length - 1)]) : null);
        return (
          <FileSection
            key={file.path}
            section={section}
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
          />
        );
      })}
    </div>
  );
}
