// A file, opened as a tab beside the session that changed it (DESIGN.md section 18). The file is one object: a card
// of glass with all four of its edges in the window, between the tabs and the composer and as wide as both. Its
// name, where it is and what changed are the card's own top; its lines are numbered in a gutter; the code moves
// inside the card and thins out under its top and at its foot. It is the sheet an edit stands on in the transcript,
// grown to the whole file. What the session changed is marked the way the sheet marks it: a bar of the change's
// colour for each run. The other form (the Code switch) is the file read on the field with no glass under it.
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { DiffLine, FileBody } from '../../content/fixtures';
import { RootCtx, split } from './parts';
import { Tokens } from './syntax';
import { Block } from './Transcript';

export type DiffForm = 'inline' | 'sides';
export type CodeGround = 'card' | 'field';
export type Numbers = 'gutter' | 'pointed';

interface Row extends DiffLine {
  /** The line's number in the file as it reads now; a line that was taken out has none. */
  no?: number;
  /** Its number in the file as it was; a line that was added has none. */
  was?: number;
  /** Its place in the body's lines. */
  at: number;
  first: boolean;
  last: boolean;
}

function rowsOf(lines: DiffLine[]): Row[] {
  let no = 0;
  let was = 0;
  return lines.map((l, i) => ({
    ...l,
    no: l.sign === '-' ? undefined : ++no,
    was: l.sign === '+' ? undefined : ++was,
    at: i,
    first: lines[i - 1]?.sign !== l.sign,
    last: lines[i + 1]?.sign !== l.sign,
  }));
}

/** Before and after, row against row: a run that was taken out stands beside the run that replaced it. */
function pairsOf(rows: Row[]): [Row | null, Row | null][] {
  const out: [Row | null, Row | null][] = [];
  for (let i = 0; i < rows.length; ) {
    if (rows[i]!.sign === ' ') {
      out.push([rows[i]!, rows[i]!]);
      i++;
      continue;
    }
    const gone: Row[] = [];
    const came: Row[] = [];
    while (rows[i]?.sign === '-') gone.push(rows[i++]!);
    while (rows[i]?.sign === '+') came.push(rows[i++]!);
    for (let k = 0; k < Math.max(gone.length, came.length); k++) out.push([gone[k] ?? null, came[k] ?? null]);
  }
  return out;
}

function Line({ row, picked, onPick, old }: { row: Row | null; picked?: boolean; onPick?: () => void; old?: boolean }) {
  if (!row) return <div className="xl-src-line" data-none="" />;
  // Before and after are numbered each in its own file.
  const no = old ? row.was : row.no;
  return (
    <div className="xl-src-line" data-at={row.at} data-sign={row.sign} data-first={row.first || undefined} data-last={row.last || undefined} data-picked={picked || undefined} onClick={onPick}>
      <i />
      <span className="xl-src-text">
        <Tokens text={row.text} />
      </span>
      {no !== undefined && <span className="xl-src-no">{no}</span>}
    </div>
  );
}

/**
 * Where the changes are in the whole file, as marks beside the column: the same bars at the file's scale, and the
 * part of the file that is in the window. A mark is pressed to go to its change.
 */
function Rail({ rows, scroller, body, inside }: { rows: Row[]; scroller: RefObject<HTMLDivElement | null>; body: RefObject<HTMLElement | null>; inside?: boolean }) {
  const runs = useMemo(() => {
    const out: { at: number; len: number; sign: string }[] = [];
    rows.forEach((r, i) => {
      if (r.sign === ' ') return;
      const last = out[out.length - 1];
      if (last && last.sign === r.sign && last.at + last.len === i) last.len++;
      else out.push({ at: i, len: 1, sign: r.sign });
    });
    return out;
  }, [rows]);
  const [seen, setSeen] = useState({ top: 0, height: 1 });
  // The rail ends where the code does: above the composer, however tall that is at the moment.
  const [foot, setFoot] = useState(104);
  // Where each run stands in the page as drawn, as shares of its height: the two forms lay the same lines out differently.
  const [marks, setMarks] = useState<{ top: number; height: number }[]>([]);
  const lineAt = useCallback((at: number) => body.current?.querySelector<HTMLElement>(`.xl-src-line[data-sign][data-at="${at}"]:not([data-sign=" "])`) ?? null, [body]);
  useEffect(() => {
    const el = scroller.current;
    const pre = body.current;
    if (!el || !pre) return;
    const read = () => {
      const view = el.getBoundingClientRect();
      const b = pre.getBoundingClientRect();
      if (b.height === 0) return;
      // Inside the card the window on the file is the card's own; on the field it is the page's, less its bars.
      const bar = inside ? 0 : parseFloat(getComputedStyle(el).getPropertyValue('--vitrea-bar-inset-bottom')) || 64;
      const top = Math.max(0, Math.min(1, (view.top + (inside ? 0 : 60) - b.top) / b.height));
      const end = Math.max(0, Math.min(1, (view.bottom - (inside ? 0 : bar + 6) - b.top) / b.height));
      setSeen({ top, height: Math.max(0.02, end - top) });
      setFoot(Math.round(bar + 40));
    };
    const place = () => {
      const b = pre.getBoundingClientRect();
      if (b.height === 0) return;
      setMarks(
        runs.map((r) => {
          const a = lineAt(r.at)?.getBoundingClientRect();
          const z = lineAt(r.at + r.len - 1)?.getBoundingClientRect();
          return a && z ? { top: (a.top - b.top) / b.height, height: (z.bottom - a.top) / b.height } : { top: 0, height: 0 };
        }),
      );
      read();
    };
    place();
    el.addEventListener('scroll', read, { passive: true });
    window.addEventListener('resize', place);
    // The composer grows under the caret and when its session asks for something.
    const sizes = new ResizeObserver(read);
    const bar = el.closest('.x-layers')?.querySelector('.xl-composer');
    if (bar) sizes.observe(bar);
    if (inside) sizes.observe(el);
    const t = [window.setTimeout(place, 120), window.setTimeout(place, 600)];
    return () => {
      el.removeEventListener('scroll', read);
      window.removeEventListener('resize', place);
      sizes.disconnect();
      t.forEach(window.clearTimeout);
    };
  }, [scroller, body, runs, lineAt]);
  const to = (at: number) => {
    const el = scroller.current;
    const line = lineAt(at);
    if (!el || !line) return;
    el.scrollTo({ top: el.scrollTop + line.getBoundingClientRect().top - el.getBoundingClientRect().top - el.clientHeight * 0.3, behavior: 'smooth' });
  };
  // A file that is new from its first line to its last has no "where", and neither has one that is all in the window.
  // Inside the card the rail is also the only sign that there is more file than card, so there it stays for a new
  // file, with no marks.
  const whole = runs.length === 1 && runs[0]!.len === rows.length;
  if (seen.height > 0.97 || (!inside && (runs.length === 0 || whole))) return null;
  return (
    <div className="xl-rail" data-in={inside ? 'card' : undefined} role="group" aria-label="Changes in this file" style={{ ['--xl-rail-b' as string]: `${foot}px` }}>
      <i className="xl-rail-seen" style={{ top: `${seen.top * 100}%`, height: `${seen.height * 100}%` }} />
      {(whole ? [] : runs).map((r, i) => (
        <button
          key={r.at}
          type="button"
          className="xl-rail-mark"
          data-sign={r.sign}
          aria-label={`${r.sign === '+' ? 'Added' : 'Removed'}: ${r.len} ${r.len === 1 ? 'line' : 'lines'}`}
          style={{ top: `${(marks[i]?.top ?? 0) * 100}%`, height: `max(5px, ${(marks[i]?.height ?? 0) * 100}%)` }}
          onClick={() => to(r.at)}
        />
      ))}
    </div>
  );
}

export function FilePage({
  body,
  diff,
  ground,
  numbers,
  start,
  scroller,
  picked,
  onPick,
}: {
  body: FileBody;
  diff: DiffForm;
  ground: CodeGround;
  numbers: Numbers;
  /** Where the card's own scroll starts (a capture aid; the field form scrolls with the page). */
  start: 'top' | 'mid' | 'end';
  scroller: RefObject<HTMLDivElement | null>;
  /** The line the person pointed at, by its number in the file. */
  picked: number | null;
  onPick: (no: number | null) => void;
}) {
  const rows = useMemo(() => rowsOf(body.lines), [body]);
  const pre = useRef<HTMLPreElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const root = useContext(RootCtx);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const put = () => {
      const end = el.scrollHeight - el.clientHeight;
      el.scrollTop = start === 'mid' ? end * 0.45 : start === 'end' ? end : 0;
    };
    put();
    const t = [window.setTimeout(put, 80), window.setTimeout(put, 420)];
    return () => t.forEach(window.clearTimeout);
  }, [start, body, diff, ground]);
  const [dir, name] = split(body.path);
  const added = rows.filter((r) => r.sign === '+').length;
  const removed = rows.filter((r) => r.sign === '-').length;
  // A line is pointed at with a press; a press that ends a selection of text is not one.
  const pick = useCallback(
    (row: Row | null) =>
      row?.no === undefined
        ? undefined
        : () => {
            if (window.getSelection()?.toString()) return;
            onPick(picked === row.no ? null : row.no!);
          },
    [onPick, picked],
  );

  const code =
    diff === 'sides' ? (
      <pre className="xl-src" data-form="sides" ref={pre}>
        {pairsOf(rows).map(([was, now], i) => (
          <div key={i} className="xl-src-pair">
            <Line row={was} old />
            <Line row={now} picked={now?.no !== undefined && now.no === picked} onPick={pick(now)} />
          </div>
        ))}
      </pre>
    ) : (
      <pre className="xl-src" ref={pre}>
        {rows.map((r, i) => (
          <Line key={i} row={r} picked={r.no !== undefined && r.no === picked} onPick={pick(r)} />
        ))}
      </pre>
    );

  const stat = (
    <span className="xl-stat">
      <span className="xl-add">+{added}</span>
      {removed > 0 && <span className="xl-del"> −{removed}</span>}
    </span>
  );
  const where = dir.replace(/\/$/, '');

  if (ground === 'card')
    return (
      <div className="xl-items xl-file" data-ground="card" data-diff={diff} data-nums={numbers} key={body.path}>
        <Block className="xl-file-card" radius={20}>
          <div className="xl-file-top">
            <span className="xl-file-name">{name}</span>
            <span className="xl-file-dir">{where}</span>
            {stat}
          </div>
          <div className="xl-src-scroll" ref={inner} tabIndex={-1}>
            {code}
          </div>
          <Rail key={diff} rows={rows} scroller={inner} body={pre} inside />
        </Block>
      </div>
    );

  return (
    <div className="xl-items xl-file" data-ground="field" data-diff={diff} key={body.path}>
      <div className="xl-file-head">
        <span className="xl-cap-name">{name}</span>
        {where}
        {stat}
      </div>
      {code}
      {root && createPortal(<Rail key={diff} rows={rows} scroller={scroller} body={pre} />, root)}
    </div>
  );
}
