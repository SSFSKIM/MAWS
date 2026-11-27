// What Source control's page draws in more than one part (UX wave U5b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md,
// §H; constraint 8, law 7: today's tokens and shapes). A part's frame, a count's badge, the refresh control the Pull
// request part has (and a failed Commits part carries), a word measured where it is not drawn, and the one measuring
// hook: the page reads the layout through Review's seam (`review/measure.ts`), which the tests replace, and decides from
// the widths what each line gives up first (page-model.ts).
import { useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { reviewLayout } from '../code/review/measure';
import { Tip } from '../../ui/tip';
import { SCM_COPY } from './copy';

// A part of the page under the Where line: its own block, ruled off below as today's header row is
export function Part({ name, label, children }: { name: 'uncommitted' | 'commits' | 'pr'; label: string; children: ReactNode }) {
  return (
    <section data-scm-part={name} aria-label={label} className="flex min-w-0 flex-col border-b border-border px-3 py-1.5 text-ui">
      {children}
    </section>
  );
}

// A count in the badge shape the acting pane's group counts use
export function CountBadge({ n, fixed = false }: { n: number; fixed?: boolean }) {
  return (
    <span data-scm-count {...(fixed && { 'data-scm-fixed': '' })} className="shrink-0 rounded-sm bg-bg-active px-1 text-ui-sm text-fg-muted tabular-nums">
      {SCM_COPY.count(n)}
    </span>
  );
}

// A quiet text control of a part ("Review ›", "Show all …", "Show fewer", a fold's line): 24 px tall by its own height
// (frames' S13), the drawn look a muted word
export const quietControl = 'inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-sm px-1 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2';

// The refresh control: the Pull request part's (the card's refresh glyph), which a failed Commits part carries too.
// `tip`, its tooltip (board ticket 815: a tip the keyboard reaches), is its label unless it says more ("Checked 3:04 PM"),
// which is its description then; it is greyed while a refresh runs.
export function RefreshButton({ label, tip = label, disabled = false, onClick }: { label: string; tip?: string; disabled?: boolean; onClick(): void }) {
  return (
    <Tip content={tip} description={tip === label ? null : tip}>
      <button
        type="button"
        data-scm-refresh
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        className="ml-auto inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
          <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" />
        </svg>
      </button>
    </Tip>
  );
}

// A word measured and never seen: drawn by its ::before from an attribute, so the line's text holds nothing of it, in the
// same type as the drawn word (`className`) and laid out on its own line, unbreakable
export function Measured({ name, text, className = '' }: { name: string; text: string; className?: string }) {
  return <span aria-hidden data-scm-measure={name} data-text={text} className={`invisible absolute top-0 left-0 whitespace-nowrap before:content-[attr(data-text)] ${className}`} />;
}

// The natural width of the measured word `name` inside `line` (0 while it is not laid out)
export function measuredWidth(line: Element, name: string): number {
  const found = line.querySelector(`[data-scm-measure="${name}"]`);
  return found ? reviewLayout.width(found) : 0;
}

// The summed widths of the line's own parts that are always drawn whole (a part's name, its count, its "Review ›")
export function fixedWidth(line: Element): number {
  return [...line.querySelectorAll('[data-scm-fixed]')].reduce((sum, element) => sum + reviewLayout.width(element), 0);
}

// A line's fit, from its room and its parts' widths, measured at every change of what it says (`key`) and of its size.
// `key` holds every word the line draws, its fixed parts' too (a count that gains a digit widens them), since nothing
// observes the parts themselves: a change of words that is not in `key` keeps the old fit.
export function useLineFit<F>(line: RefObject<HTMLElement | null>, fitOf: (line: HTMLElement, room: number) => F, same: (a: F, b: F) => boolean, initial: F, key: string): F {
  const [fit, setFit] = useState<F>(initial);
  useLayoutEffect(() => {
    const el = line.current;
    if (!el) return;
    const measure = () => {
      const next = fitOf(el, reviewLayout.contentWidth(el));
      setFit((prev) => (same(prev, next) ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [line, key, fitOf, same]); // `key`: what the line says, so a change of words is measured again
  return fit;
}

// A name shortened at its end, to no fewer than eight characters and an ellipsis (frames' S4, S6)
export const SHORTEST = 8;
export const shortest = (name: string): string => (name.length > SHORTEST ? `${name.slice(0, SHORTEST)}…` : name);
