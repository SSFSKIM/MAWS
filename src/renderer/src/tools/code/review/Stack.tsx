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
import { blocksOf, firstChangedLine, REVIEW_FILE_LINES_CAP, tooLarge, viewedSignature, type ReviewFile } from './review-model';
import { fileDiffOf, useReview, type DiffTarget, type ScopeDiff } from './review-store';
import { bodyLines, hunkOrder, isFolded, type StackHunk } from './stack-model';
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
}

// The sections of a scope and the hunks the counter counts (§F): those of every loaded file, folded or not, that is not
// marked Viewed and not past the per-file cap, in stack order.
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
      // A mark on a file whose own read has not answered yet holds until it does, so the file does not unfold meanwhile;
      // one that no longer signs the file's change has dropped, and unfolds it.
      const viewed = mark !== undefined && (signature === null ? ownRead : mark === signature);
      const dropped = mark !== undefined && signature !== null && mark !== signature;
      const folded = isFolded({ choice: folds.get(key)?.get(file.path), viewed, dropped, pastCap });
      const failed = load?.status === 'error' ? load.message : null;
      return {
        file,
        hunks,
        blocks: hunks === null ? [] : blocksOf(hunks, file.hunks === null ? [hunks.length] : file.blocks),
        binary,
        signature,
        viewed,
        folded,
        fetch: ownRead && (!folded || mark !== undefined),
        failed,
        lines: estimateLines(file, hunks, binary || untrackedDirectory || (hunks === null && failed !== null)),
      };
    });
    const order = hunkOrder(sections.map((section) => ({ path: section.file.path, hunks: section.hunks, blocks: section.blocks.map((block) => block.length), viewed: section.viewed })));
    return { sections, order };
  }, [files, target, key, pastCap, marks, folds, fetched]);
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
}

export function Stack({ appSessionId, ui, sections, order, placeKey: key, target, scopeDiff, width, mode, wrap, reveal, onRevealed }: StackProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const placer = useRef<StackPlacer | null>(null);
  const [band, setBand] = useState<Band>(EMPTY_BAND);
  const hunk = useStore(ui, (s) => s.hunk);
  const navigate = useStore(ui, (s) => s.navigate);
  const current = Math.min(hunk, Math.max(0, order.length - 1));

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
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => placed.relayout());
      ro.observe(el);
      observer.current = { ro, watched: new Set([el]) };
    }
    return () => {
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
    placed.drawn();
    const seen = handled.current;
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
      onScroll={() => placer.current?.scrolled()}
      onWheel={() => placer.current?.cancel()}
      onTouchStart={() => placer.current?.cancel()}
      onKeyDown={() => placer.current?.cancel()}
      onPointerDown={() => placer.current?.cancel()}
      className="review-diff min-h-0 flex-1 overflow-y-auto overflow-x-hidden [overflow-anchor:none]"
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
          />
        );
      })}
    </div>
  );
}
