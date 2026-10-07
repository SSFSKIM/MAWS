// What a browser tool's target names on the page (E4c execution document, Design §6 `locate.ts`; Decision Log 16, 30, 37).
//
// A ref resolves through Playwright's `aria-ref` engine at once: a frame ordinal Playwright no longer knows is a ref of
// a previous document; no match is one too when the page's main document changed since the snapshot that named it
// (Electron's `did-navigate`: a cross-document commit), else it is stale or missing. A locator resolves css-first: css
// alone (as Playwright css, so `>>` or `text=` in it stay css) after up to BROWSER_LOCATE_MS for a first match; one
// element whose role or name disagrees with Playwright's computation is `targetNotFound` naming what css matched, with
// no fallback (it would act on another element than the selector names); several are narrowed by the role and name;
// none (or none left) falls back to role plus name when they name exactly one element (E4d's anchor after a re-render).
// A name given without a role cannot narrow several matches (Playwright queries a name only through a role): the first
// is used and the name is left out of what resolved.
//
// Every aria snapshot Playwright takes, of any element and in any mode, replaces its frame's ref table, and a later
// whole-page ai snapshot of the same document brings the same refs back (Playwright keeps each element's ref on the
// element). So the role and name a ref names come from the snapshots the tools already took, and the two cases that
// read an element's own aria node (a name given without a role, and the element a disagreement names) take a whole-page
// ai snapshot right after it, which restores the model's refs.
import type { Locator, Page } from 'playwright-core';
import { refElementsOf, type RefElement } from '@shared/browser/snapshot';
import { type BrowserLocator } from '@shared/browser/locator';
import { BROWSER_LOCATE_MS, BROWSER_TOOL_ERRORS, type BrowserResolvedTarget, type BrowserTarget, type BrowserToolName, type NamedBrowserLocator } from '@shared/maws/browser';
import { BrowserToolError } from './errors';

export interface Located {
  locator: Locator;
  resolved: BrowserResolvedTarget;
}

// The refs the tools' snapshots of one tab's page named, with the main-frame document each was named in.
export class RefBook {
  private document = 0;
  private readonly elements = new Map<string, RefElement & { document: number }>();

  constructor(contents: Pick<NodeJS.EventEmitter, 'on'>) {
    contents.on('did-navigate', () => void (this.document += 1)); // main frame, cross-document only
  }

  record(snapshot: string): void {
    for (const [ref, element] of refElementsOf(snapshot)) this.elements.set(ref, { ...element, document: this.document });
  }

  elementOf(ref: string): RefElement | undefined {
    const element = this.elements.get(ref);
    return element && (element.name === undefined ? { role: element.role } : { role: element.role, name: element.name });
  }

  namedInEarlierDocument(ref: string): boolean {
    const element = this.elements.get(ref);
    return element !== undefined && element.document < this.document;
  }
}

export interface LocateOptions {
  tool: BrowserToolName;
  signal: AbortSignal;
  refs: RefBook;
  locateMs?: number;
}

export function locate(page: Page, target: BrowserTarget, options: LocateOptions): Promise<Located> {
  return typeof target === 'string' ? locateRef(page, target, options) : locateLocator(page, target, options);
}

async function locateRef(page: Page, ref: string, { tool, signal, refs }: LocateOptions): Promise<Located> {
  signal.throwIfAborted();
  const locator = page.locator(`aria-ref=${ref}`);
  let count: number;
  try {
    count = await locator.count();
  } catch (error) {
    if (isGoneFrame(error)) throw new BrowserToolError(BROWSER_TOOL_ERRORS.staleRef(tool, ref, 'previous-document'));
    throw error;
  }
  if (count === 0) throw new BrowserToolError(BROWSER_TOOL_ERRORS.staleRef(tool, ref, refs.namedInEarlierDocument(ref) ? 'previous-document' : 'missing'));
  return { locator, resolved: { ref, ...refs.elementOf(ref) } };
}

async function locateLocator(page: Page, target: BrowserLocator, { tool, signal, refs, locateMs = BROWSER_LOCATE_MS }: LocateOptions): Promise<Located> {
  const { css, role, name } = target;
  const echo = { css, ...(role === undefined ? {} : { role }), ...(name === undefined ? {} : { name }) };
  const byCss = page.locator(`css=${css}`);
  try {
    await byCss.first().waitFor({ state: 'attached', timeout: locateMs, signal });
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (!isTimeout(error)) throw error; // a selector Playwright cannot parse, a page that went
  }
  const count = await byCss.count();

  if (count === 1) {
    const one = { locator: byCss, resolved: { ...echo, matches: 1 } };
    if (role === undefined && name === undefined) return one;
    // hidden elements included: whether the element is shown is the readiness wait's question, not this one's
    if (role !== undefined && (await byCss.and(byRole(page, role, name, { includeHidden: true })).count()) === 1) return one;
    const found = await elementOf(page, byCss, { signal, refs });
    if (role === undefined && found.name === name) return one;
    throw new BrowserToolError(BROWSER_TOOL_ERRORS.targetNotFound(tool, target as NamedBrowserLocator, found));
  }
  if (count > 1) {
    if (role === undefined) return { locator: byCss.first(), resolved: { css, matches: count } }; // a name alone narrows nothing
    const narrowed = byCss.and(byRole(page, role, name));
    const matches = await narrowed.count();
    if (matches > 0) return { locator: narrowed.first(), resolved: { ...echo, matches } };
  }
  if (role !== undefined && name !== undefined) {
    const fallback = byRole(page, role, name);
    if ((await fallback.count()) === 1) return { locator: fallback, resolved: { ...echo, matches: 1 } };
  }
  throw new BrowserToolError(BROWSER_TOOL_ERRORS.targetNotFound(tool, target));
}

const byRole = (page: Page, role: string, name: string | undefined, options: { includeHidden?: boolean } = {}) =>
  page.getByRole(role as Parameters<Page['getByRole']>[0], name === undefined ? options : { name, exact: true, ...options });

// The role and name Playwright computes for one element, from its default-mode aria tree: the element's own node, or
// `generic` when Playwright leaves the element out (a generic container shows only its children). The read empties the
// frame's ref table; the whole-page ai snapshot after it restores the refs (and is recorded, as any snapshot is).
async function elementOf(page: Page, locator: Locator, { signal, refs }: { signal: AbortSignal; refs: RefBook }): Promise<{ role: string; name: string }> {
  const nodes = (await locator.ariaSnapshotJSON({ signal })) as { role?: unknown; name?: unknown }[];
  refs.record(await page.ariaSnapshot({ mode: 'ai', signal }));
  const node = Array.isArray(nodes) && nodes.length === 1 ? nodes[0] : undefined;
  if (!node || typeof node.role !== 'string' || node.role === 'text') return { role: 'generic', name: '' };
  return { role: node.role, name: typeof node.name === 'string' ? node.name : '' };
}

// Playwright's answer for a ref whose frame ordinal names no frame it knows (a previous document's).
export const isGoneFrame = (error: unknown): boolean => error instanceof Error && error.message.includes('Invalid frame in aria-ref selector');

export const isTimeout = (error: unknown): boolean => error instanceof Error && error.name === 'TimeoutError';
