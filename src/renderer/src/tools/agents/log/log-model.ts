// The Log tool's paging (C8b execution document, Interfaces *Log paging*): pages of LOG_PAGE_BYTES read through
// `fs.readSpill`, at most LOG_WINDOW_PAGES of them in the DOM. C4 ends a UTF-8 page on a character boundary and answers
// the bytes it consumed as `length`, so page i+1 starts at `offset + length` of page i, never at a multiple of the page
// size. The chain of every page read keeps its offset after the page's text leaves the window, so Show earlier re-reads
// a dropped page where it was. Pure.
import type { FsReadSpillOutput } from '@shared/ipc/schema/fs';

export const LOG_PAGE_BYTES = 256 * 1024;
export const LOG_WINDOW_PAGES = 4;

export interface PageSpan {
  offset: number; // what the read asked for
  length: number; // what the answer consumed
  truncated: boolean; // more of the file follows this page
}
export interface LogPage {
  text: string;
  offset: number;
  length: number;
}
export interface PageWindow {
  from: number;
  to: number;
}
export interface LogPages {
  chain: PageSpan[]; // every page read so far, by index
  pages: Map<number, LogPage>; // the window's pages, the only ones whose text is kept
  window: PageWindow | null; // page indices rendered, inclusive; null before the first answer
  bytes: number | null; // the file's size at the latest answer
}

export const NO_PAGES: LogPages = { chain: [], pages: new Map(), window: null, bytes: null };

// The window after showing page `index`: grown to include it, then trimmed from the side away from it to
// LOG_WINDOW_PAGES (Load more at the end drops `from`; Show earlier at the top drops `to`).
export function pageWindow(window: PageWindow | null, index: number): PageWindow {
  if (window === null) return { from: index, to: index };
  let from = Math.min(window.from, index);
  let to = Math.max(window.to, index);
  if (to - from + 1 > LOG_WINDOW_PAGES) {
    if (index >= window.to) from = to - LOG_WINDOW_PAGES + 1;
    else to = from + LOG_WINDOW_PAGES - 1;
  }
  return { from, to };
}

// Page `index` answered. A re-read whose span changed (Refresh over a growing file's last page) drops the chain after
// it, since the later offsets no longer follow; a page leaving the window leaves `pages`.
export function withPage(state: LogPages, index: number, answer: FsReadSpillOutput): LogPages {
  const span: PageSpan = { offset: answer.offset, length: answer.length, truncated: answer.truncated };
  const prior = state.chain[index];
  const chain = prior && prior.length === span.length && prior.truncated === span.truncated ? [...state.chain] : state.chain.slice(0, index);
  chain[index] = span;
  const grown = pageWindow(state.window, index);
  const window = { from: grown.from, to: Math.min(grown.to, chain.length - 1) };
  const pages = new Map([...state.pages].filter(([i]) => i >= window.from && i <= window.to));
  pages.set(index, { text: answer.content, offset: answer.offset, length: answer.length });
  return { chain, pages, window, bytes: answer.bytes };
}

export interface PageRead {
  index: number;
  offset: number;
}

// The first page, then the page after the window's last at `offset + length`; null once the last page ends the file.
export function nextRead(state: LogPages): PageRead | null {
  if (state.window === null) return { index: 0, offset: 0 };
  const last = state.chain[state.window.to];
  return last.truncated ? { index: state.window.to + 1, offset: last.offset + last.length } : null;
}

// The page before the window's first, at the offset it was read at.
export function earlierRead(state: LogPages): PageRead | null {
  if (state.window === null || state.window.from === 0) return null;
  const index = state.window.from - 1;
  return { index, offset: state.chain[index].offset };
}

// Refresh: the window's last page again at its offset (a growing output file shows its new tail), with the size.
export function refreshRead(state: LogPages): PageRead {
  if (state.window === null) return { index: 0, offset: 0 };
  return { index: state.window.to, offset: state.chain[state.window.to].offset };
}

export const atEnd = (state: LogPages): boolean => state.window !== null && state.chain[state.window.to]?.truncated === false;

// `512 bytes`, `12 KB`, `1.5 MB` (binary units, the transcript's spill size form).
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Number((bytes / (1024 * 1024)).toFixed(1))} MB`;
}
