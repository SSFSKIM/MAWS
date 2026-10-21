// X10's field helper (E11; P4 W2-C, tracker 2026-10-07): the one strip-and-fit rule every producer builds an anchor's
// text with, E2's artifact pick, E6's pr-line label and E4d's browser pick alike. Zod-free and DOM-free, so the browser
// preload, which is bundled without zod (`src/preload/bundle.test.ts`), carries it through `src/shared/browser/describe.ts`;
// `anchor.ts`, whose schema needs zod, re-exports it.

// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\x00-\x1f\x7f]/g; // the characters X10's ONE_LINE refuses (`anchor.ts`)

// Control characters as spaces, then whitespace runs one space and the ends trimmed.
export const oneLine = (text: string): string => text.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();

export interface AnchorFieldOptions {
  control?: 'space' | 'mark' | 'drop'; // a space (then whitespace runs collapse and the ends trim: `oneLine`), U+FFFD, or nothing
  keep?: 'head' | 'tail'; // the end a cut keeps: a label's start, or a path's end
  ellipsis?: boolean; // a cut is marked with `…` (counted in `max`) unless false (a locator, an address cut bare)
}

// A value a page, an artifact or a repository controls, made to meet ONE_LINE and its cap: control characters handled
// per `control`, then at most `max` UTF-16 units (what the schema's `max` counts), never half a surrogate pair.
export function anchorField(text: string, max: number, options: AnchorFieldOptions = {}): string {
  const { control = 'space', keep = 'head', ellipsis = true } = options;
  const line = control === 'space' ? oneLine(text) : text.replace(CONTROL, control === 'mark' ? '�' : '');
  if (line.length <= max) return line;
  const mark = ellipsis ? '…' : '';
  const room = Math.max(0, max - mark.length);
  if (keep === 'tail') {
    let kept = line.slice(line.length - room);
    if (/^[\uDC00-\uDFFF]/.test(kept)) kept = kept.slice(1);
    return `${mark}${kept}`;
  }
  let kept = line.slice(0, room);
  if (/[\uD800-\uDBFF]$/.test(kept)) kept = kept.slice(0, -1);
  return `${kept}${mark}`;
}
