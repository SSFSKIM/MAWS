// A file's section in the stack (UX wave U5b, M3; the execution document's §F): a header that sticks to the top of the
// scroller while its body is under it, and the body. The header, left to right: the fold mark; the path, relative to
// the repository, its folder part shortening first; a kind's badge; the counts; Viewed; "Open file ↗". A click on the
// header folds and unfolds the section. Card 2 ("Words wide, glyphs narrow", the owner's answer at its recommended
// option) is built here alone: under NARROW_HEADER_WIDTH Viewed is a check box and "Open file ↗" is "↗", each with its
// words as a tooltip.
//
// The body: the file's diff (FileBody, loaded on first use); "Diff too large to display. Open the file"; nothing for a
// rename without a change, nor for a binary, whose badge says Binary (the word cut, N44), but "Binary file" for an
// untracked binary, whose badge says Untracked; "Untracked folder" for an untracked folder (T361); "Diff unavailable: …"
// with Retry for a file whose own read failed; while it is read, the quiet spinner. A folded section has no body; an unfolded one outside the stack's band (M4) is a spacer of the
// height the stack gives it.
//
// UX wave U5b, M5 (§G, decision 10): while the card is open on a line of the file, the file holds still; when the scope's
// re-read brings other hunks for it, the header shows one muted line under its row, "This file changed · Refresh".
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { QuietSpinner } from '../../../ui/spinner';
import { NamedGlyph } from '../../../ui/glyph';
import { Tip } from '../../../ui/tip';
import { REVIEW_COPY } from '../copy';
import type { DiffBlockData } from './FileBody';
import { reviewLayout } from './measure';
import { diffViewHunks, tooLarge, type ReviewFile } from './review-model';
import { useMachineMark } from '../../../app/machine-mark';
import { commitFailure, fileDiffOf, useReview, type DiffTarget, type ScopeDiff } from './review-store';
import type { StackSection } from './Stack';
import type { ReviewMode } from './view-state';

const FileBody = lazy(() => import('./FileBody'));

// Under this width of the stack a header takes its narrow form (card 2; "from about 520 px they are words as today").
export const NARROW_HEADER_WIDTH = 520;

const toggle = 'inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-sm border border-border px-2 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 aria-pressed:bg-bg-active aria-pressed:text-fg';
const quiet = 'inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-sm px-1.5 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2';
const glyph = 'inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2';
const BADGE = 'shrink-0 whitespace-nowrap rounded-sm bg-bg-active px-1.5 text-ui-sm';

// Marked, so the stack does not take a wait's height for the body's, nor its rows for the diff's: the line a wait keeps,
// empty for half a second, then the quiet spinner.
const Loading = () => (
  <div data-review-loading className="flex h-8 items-center px-3">
    <QuietSpinner label={REVIEW_COPY.loading} />
  </div>
);

// The library's `data` for each block of a file, made from the blocks' text: a section keeps the objects while the text
// is equal (P2), whatever arrays a re-read hands it.
function blockData(path: string, oldPath: string | null, text: string): DiffBlockData[] {
  return (JSON.parse(text) as string[][]).map((hunks) => ({ oldFile: { fileName: oldPath ?? path }, newFile: { fileName: path }, hunks: diffViewHunks({ path, oldPath, hunks }) }));
}

export interface FileSectionProps {
  section: StackSection;
  drawn: boolean; // inside the stack's band: its body is drawn, else a spacer stands for it
  near: boolean; // its body or its header inside the band: its own read may be asked
  spacer: number; // the spacer's height outside the band
  width: number; // the stack's, 0 before a layout
  mode: ReviewMode; // as drawn
  wrap: boolean;
  target: DiffTarget | null; // the scope's read, for the file's own
  scopeDiff: ScopeDiff | undefined; // its answer: a re-read drops the files read alone, and an unfolded one asks again
  openLine: number | null; // the line "Open file ↗" opens: the counter's hunk's when it is in this file, else its first
  firstLine: number | null; // the line "Open the file" opens under a file too large to draw
  onFold(): void;
  onViewed(): void;
  onOpen(line: number | null): void;
  onRefresh(): void; // the file held under an open card takes its latest hunks
}

export function FileSection({ section, drawn, near, spacer, width, mode, wrap, target, scopeDiff, openLine, firstLine, onFold, onViewed, onOpen, onRefresh }: FileSectionProps) {
  const { file, hunks, blocks, binary, signature, viewed, folded, fetch, failed, changed } = section;
  const narrow = width > 0 && width < NARROW_HEADER_WIDTH;
  const untracked = file.kind === 'untracked';
  const untrackedDirectory = untracked && file.path.endsWith('/');

  // The file's own read (a scope past its cap, an untracked file, a binary's header), asked near the scroll position
  // only, and again after the scope re-read.
  const wanted = fetch && near;
  useEffect(() => {
    if (wanted && target) useReview.getState().loadFile(target, file.path, untracked);
  }, [wanted, target, file.path, untracked, scopeDiff]);

  // The diff's data is prepared only for a body that draws it (unfolded, in the band, a text diff small enough to draw),
  // and kept while it draws and its text is equal.
  const shown = !folded && drawn;
  const large = useMemo(() => shown && hunks !== null && tooLarge({ hunks }), [shown, hunks]);
  const draws = shown && !untrackedDirectory && !binary && hunks !== null && hunks.length > 0 && !large;
  const text = useMemo(() => (draws ? JSON.stringify(blocks) : null), [draws, blocks]);
  const data = useMemo(() => (text === null ? null : blockData(file.path, file.oldPath, text)), [file.path, file.oldPath, text]);

  const body = (() => {
    if (!shown) return null;
    if (untrackedDirectory)
      return (
        <p data-review-note className="m-0 px-3 py-2 text-ui-sm text-fg-muted">
          {REVIEW_COPY.untrackedFolder}
        </p>
      );
    // A failed own read says so first, a binary's (its header, what a mark signs) as much as a text file's.
    if (hunks === null && failed !== null)
      return (
        <div role="status" className="flex items-start gap-2 px-3 py-2">
          <p className="m-0 min-w-0 flex-1 text-ui-sm text-fg-muted">{target?.read === 'git.commitDiff' ? <CommitFileFailure target={target} path={file.path} /> : REVIEW_COPY.unavailable(failed)}</p>
          <button type="button" className={`${toggle} min-w-6`} onClick={() => target && useReview.getState().retryFile(target, file.path, untracked)}>
            {REVIEW_COPY.retry}
          </button>
        </div>
      );
    if (binary) return file.kind === 'binary' ? null : <p className="m-0 px-3 py-2 text-ui-sm text-fg-muted">{REVIEW_COPY.binaryFile}</p>;
    if (hunks === null) return <Loading />;
    if (large)
      return (
        <p data-review-too-large className="m-0 px-3 py-2 text-ui-sm text-fg-muted">
          {REVIEW_COPY.tooLarge}{' '}
          {file.openPath !== null ? (
            <button type="button" className="text-accent hover:underline" onClick={() => onOpen(firstLine)}>
              {REVIEW_COPY.openTheFile}
            </button>
          ) : (
            REVIEW_COPY.openTheFile
          )}
        </p>
      );
    if (hunks.length === 0 || data === null) return null; // a rename with no change, a mode change: nothing to draw
    return (
      <Suspense fallback={<Loading />}>
        <FileBody path={file.path} data={data} mode={mode} wrap={wrap} />
      </Suspense>
    );
  })();

  return (
    <section data-review-file={file.path} data-kind={file.kind} data-folded={folded || undefined} data-viewed={viewed || undefined}>
      <div data-review-file-header className="sticky top-0 z-10 border-b border-border bg-bg">
        <div className="flex h-8 items-center gap-2 px-2">
          <Tip content={pathWords(file)} description={renamedFrom(file)}>
            <button type="button" data-review-fold aria-expanded={!folded} onClick={onFold} className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left text-ui-sm outline-accent focus-visible:outline-2">
              <FoldMark folded={folded} />
              <PathLabel file={file} />
              <Badge file={file} />
              <Counts file={file} />
            </button>
          </Tip>
          <ViewedControl markable={signature !== null} viewed={viewed} narrow={narrow} onToggle={onViewed} />
          {file.openPath !== null ? (
            narrow ? (
              <NamedGlyph data-open-file="" label={REVIEW_COPY.openFile} className={glyph} onClick={() => onOpen(openLine)}>
                {REVIEW_COPY.openFileGlyph}
              </NamedGlyph>
            ) : (
              <button type="button" data-open-file className={quiet} onClick={() => onOpen(openLine)}>
                {REVIEW_COPY.openFile}
              </button>
            )
          ) : (
            // a deleted file: nothing to open, and the column kept so the Viewed controls stay in line (D10)
            <span aria-hidden data-review-open-placeholder className={`${narrow ? glyph : quiet} invisible`}>
              {narrow ? REVIEW_COPY.openFileGlyph : REVIEW_COPY.openFile}
            </span>
          )}
        </div>
        {changed && (
          <p data-review-file-changed="" className="m-0 flex items-center gap-1 pb-1 pl-8 text-ui-sm text-fg-muted">
            {REVIEW_COPY.fileChanged}
            <span aria-hidden>·</span>
            <button type="button" className="inline-flex min-h-6 items-center rounded-sm px-1 text-accent outline-accent hover:underline focus-visible:outline-2" onClick={onRefresh}>
              {REVIEW_COPY.refresh}
            </button>
          </p>
        )}
      </div>
      {folded ? null : drawn ? body !== null && <div data-review-body>{body}</div> : <div aria-hidden data-review-spacer style={{ height: spacer }} />}
    </section>
  );
}

// UX wave U5b-2 (§H, S22): a file of a commit's diff whose own read failed says what failed in the commit's words.
function CommitFileFailure({ target, path }: { target: DiffTarget; path: string }) {
  const load = useReview((s) => fileDiffOf(s, target, path));
  const mark = useMachineMark(target.session ?? '');
  if (load?.status !== 'error') return null;
  return <>{commitFailure(load, mark.offline, mark.local ? null : mark.name, mark.name).message}</>;
}

function FoldMark({ folded }: { folded: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={`size-3.5 shrink-0 text-fg-muted ${folded ? '-rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

// The path whole (a rename's "old → new"), the header's tip; and the old path of a rename, which the badge names and the
// header's description says (board ticket 815: these were the path's and the badge's titles, the fold button their owner).
const renamedWords = (file: ReviewFile): string | null => (file.kind === 'renamed' && file.oldPath !== null ? REVIEW_COPY.renamed(file.oldPath, file.displayPath) : null);
const pathWords = (file: ReviewFile): string => renamedWords(file) ?? file.displayPath;
const renamedFrom = (file: ReviewFile): string | null => (file.kind === 'renamed' && file.oldPath !== null ? REVIEW_COPY.renamedFrom(file.oldPath) : null);

// The path, its folder part shortening first; a rename reads "old → new" only while both paths fit whole (D2), else the
// new path, its badge naming the old one. The fit is measured against the room the header leaves the path, by a probe
// beside the path (not in it, so the path reads only what is drawn).
function PathLabel({ file }: { file: ReviewFile }) {
  const slot = useRef<HTMLSpanElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const renamed = renamedWords(file);
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const el = slot.current;
    const text = probe.current;
    if (renamed === null || !el || !text) return;
    const measure = () => {
      const room = reviewLayout.width(el);
      setFits(room <= 0 || reviewLayout.width(text) <= room);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [renamed]);

  const cut = file.displayPath.lastIndexOf('/') + 1;
  return (
    <span className="relative flex min-w-0 flex-1">
      <span ref={slot} data-review-path className="flex min-w-0 flex-1 items-baseline overflow-hidden whitespace-nowrap">
        {renamed !== null && fits ? (
          <span className="min-w-0 truncate text-fg">{renamed}</span>
        ) : (
          <>
            {cut > 0 && (
              <span data-review-path-folder className="min-w-0 shrink-[1000] truncate text-fg-muted">
                {file.displayPath.slice(0, cut)}
              </span>
            )}
            <span data-review-path-name className="min-w-0 truncate text-fg">
              {file.displayPath.slice(cut)}
            </span>
          </>
        )}
      </span>
      {renamed !== null && (
        <span ref={probe} aria-hidden data-review-rename-measure className="invisible absolute top-0 left-0 whitespace-nowrap">
          {renamed}
        </span>
      )}
    </span>
  );
}

// A badge for each kind but Modified; an untracked file its read answered as binary stays Untracked.
function Badge({ file }: { file: ReviewFile }) {
  if (file.kind === 'modified') return null;
  return (
    <span data-review-badge className={`${BADGE} ${file.kind === 'conflict' ? 'text-danger' : 'text-fg-muted'}`}>
      {REVIEW_COPY.kinds[file.kind]}
    </span>
  );
}

// A new file shows its added lines alone, an untracked one too once the working-tree read counted it (UX wave U5b-2,
// l5-code-04; none while it is not counted); a pure rename and a binary show none; every other kind both sides.
function Counts({ file }: { file: ReviewFile }) {
  if (file.kind === 'binary' || (file.kind === 'untracked' && file.uncounted === true)) return null;
  if (file.kind === 'renamed' && file.added === 0 && file.removed === 0) return null;
  return (
    <span data-review-counts className="shrink-0 whitespace-nowrap font-mono text-ui-sm">
      <span className="text-success">{REVIEW_COPY.added(file.added)}</span>
      {file.kind !== 'added' && file.kind !== 'untracked' && (
        <>
          {' '}
          <span className="text-danger">{REVIEW_COPY.removed(file.removed)}</span>
        </>
      )}
    </span>
  );
}

// Viewed keeps today's words ("Mark viewed", then "Viewed"); in a narrow header it is a check box with them as its
// tooltip. A file whose mark cannot be signed yet (its own read not answered) keeps the control's room.
function ViewedControl({ markable, viewed, narrow, onToggle }: { markable: boolean; viewed: boolean; narrow: boolean; onToggle(): void }) {
  const words = viewed ? REVIEW_COPY.viewed : REVIEW_COPY.markViewed;
  const box = useRef<HTMLLabelElement>(null);
  if (!markable) return <span aria-hidden className={narrow ? 'size-6 shrink-0' : `${toggle} invisible`}>{narrow ? null : REVIEW_COPY.markViewed}</span>;
  if (narrow)
    return (
      <label ref={box} className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center">
        {/* board ticket 815: its words, its name, are a tip the keyboard reaches, pointed at anywhere in its 24 px box */}
        <Tip content={words} pointedWithin={box}>
          <input type="checkbox" data-review-viewed checked={viewed} aria-label={words} onChange={onToggle} className="accent-accent outline-accent focus-visible:outline-2" />
        </Tip>
      </label>
    );
  return (
    <button type="button" data-review-viewed aria-pressed={viewed} className={toggle} onClick={onToggle}>
      {words}
    </button>
  );
}
