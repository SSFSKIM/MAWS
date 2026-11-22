// `window.__maws_harness.code` (C8c execution document, Interfaces *Harness API*; the types are `api.ts`): reads what
// Review, Files and the viewer draw, from their DOM (the chips, the stack's sections, the counter, the tree rows, the
// notices) and the stores behind it (the hunk texts, the viewer's text), and drives them as a reader would (clicks, a
// scroll, the View menu).
import type { AppSessionId } from '@shared/graph/ids';
import { workingFolder } from '@shared/sessions/working-folder';
import { checkoutKey, machineFor } from '../../ipc/machine';
import { instanceOf, shownSession } from '../../panel/host';
import { useGit } from '../../stores/git';
import { useLayout } from '../../stores/layout';
import { activeTab } from '../../stores/layout-model';
import { useSessions } from '../../stores/sessions';
import { gitScopeFiles, parseRef, dividerOf, turnScopeFiles, type ReviewFile, type ReviewScope } from '../../tools/code/review/review-model';
import { diffOf, fileDiffOf, turnKeyOf, useReview, type DiffTarget } from '../../tools/code/review/review-store';
import type { ReviewState } from '../../tools/code/review/ReviewTool';
import { useViewer } from '../../tools/code/viewer/viewer-store';
import { useTranscriptStore, type TurnId } from '../../transcript';
import type { CodeHarnessApi, CodeHarnessReview, CodeHarnessSection, CodeHarnessViewer, ReviewSurface } from './api';
import { transcriptKey } from './CodeHarnessBlock';

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function until<T>(read: () => T | null | undefined, what: string, timeoutMs = 5000): Promise<T> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== null && value !== undefined) return value;
    if (performance.now() > deadline) throw new Error(`harness.code: no ${what} within ${timeoutMs} ms`);
    await nextFrame();
  }
}

// ---- Review -------------------------------------------------------------------------------------------------------------

const PANEL_REVIEW = '[data-region="panel"] [data-review]';
const TAB_REVIEW = '[data-diff-tab] [data-review]';

function reviewRoot(surface?: ReviewSurface): HTMLElement | null {
  if (surface === 'panel') return document.querySelector<HTMLElement>(PANEL_REVIEW);
  if (surface === 'tab') return document.querySelector<HTMLElement>(TAB_REVIEW);
  return document.querySelector<HTMLElement>(PANEL_REVIEW) ?? document.querySelector<HTMLElement>(TAB_REVIEW);
}

function mustRoot(surface?: ReviewSurface): HTMLElement {
  const root = reviewRoot(surface);
  if (!root) throw new Error('harness.code: no Review is shown');
  return root;
}

function click(root: ParentNode, selector: string, what: string): void {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`harness.code: no ${what}`);
  el.click();
}

// Which surface a root is, the session and directory it reviews, and its turn (Last turn's hunks come from the store).
interface ReviewTarget {
  appSessionId: AppSessionId;
  directory: string;
  turnId: TurnId | null;
}

function targetOf(root: HTMLElement): ReviewTarget | null {
  const tab = root.closest<HTMLElement>('[data-diff-tab]');
  let appSessionId: AppSessionId | null;
  let turnId: TurnId | null;
  if (tab) {
    const shown = activeTab(useLayout.getState().main);
    appSessionId = shown?.kind === 'diff' ? shown.appSessionId : null;
    turnId = parseRef(tab.dataset.diffTab ?? '')?.turnId ?? null;
  } else {
    appSessionId = shownSession();
    const selected = appSessionId ? useLayout.getState().panelBySession.get(appSessionId)?.activeTabId : null;
    const pinned = useLayout.getState().panelPinned.find((t) => t.toolId === 'review')?.id;
    const tabId = selected && instanceOf(selected)?.tool.id === 'review' ? selected : (pinned ?? null);
    const state = tabId ? (instanceOf(tabId)?.state as ReviewState | undefined) : undefined;
    turnId = state?.ui.getState().turnId ?? null;
  }
  const record = appSessionId ? useSessions.getState().records.get(appSessionId) : undefined;
  if (!appSessionId || !record) return null;
  return { appSessionId, directory: workingFolder(record).path, turnId };
}

// The files Review lists for a scope, from the same stores and the same functions its shell reads.
function filesOf(target: ReviewTarget, scope: ReviewScope): { files: ReviewFile[]; diff: DiffTarget | null } | null {
  if (scope === 'turn') {
    if (target.turnId === null) return null;
    const { entries } = useTranscriptStore.getState();
    const key = turnKeyOf(entries, target.appSessionId, target.turnId);
    if (key === null) return null;
    const activity = useTranscriptStore.getState().activity(key).find((a) => a.turnId === target.turnId) ?? null;
    return { files: turnScopeFiles(dividerOf(entries[key].rows, target.turnId)?.files ?? [], activity), diff: null };
  }
  const machine = machineFor(target.appSessionId);
  const status = useGit.getState().entries.get(checkoutKey(machine, target.directory))?.status ?? null;
  if (!status) return null;
  // UX wave U5b-2: a target's key ends with the read it is made with and what it is against (review-store's `keys`)
  const prefix = `${checkoutKey(machine, target.directory)}\0${scope}\0`;
  const found = [...useReview.getState().diffs.keys()].find((key) => key.startsWith(prefix));
  if (!found) return null;
  const [read, against] = found.slice(prefix.length).split('\0') as [DiffTarget['read'], string];
  const diffTarget: DiffTarget = { machine, directory: target.directory, scope, read, against: against === '' ? null : against };
  const diff = diffOf(useReview.getState(), diffTarget);
  if (diff?.status !== 'ok') return null;
  return { files: gitScopeFiles({ scope, repoRoot: status.repoRoot, files: diff.files, patch: diff.patch, status, untracked: diff.untracked ?? null }), diff: diffTarget };
}

function hunksOf(root: HTMLElement, scope: ReviewScope | null, selected: string | null): string[] | null {
  const target = targetOf(root);
  if (!target || scope === null || selected === null) return null;
  const listed = filesOf(target, scope);
  const file = listed?.files.find((f) => f.path === selected);
  if (!listed || !file) return null;
  if (file.hunks !== null || listed.diff === null) return file.hunks;
  const fetched = fileDiffOf(useReview.getState(), listed.diff, file.path); // a scope past its cap
  return fetched?.status === 'ok' ? (fetched.file?.hunks ?? []) : null;
}

// The stack's sections in order, and the one at the top of its scroller (the first before any has scrolled past).
const sectionsOf = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('[data-review-file]')];
const stackOf = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-review-stack]');
const offsetIn = (scroller: HTMLElement, el: Element) => el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;

function topSection(root: HTMLElement): HTMLElement | null {
  const scroller = stackOf(root);
  const sections = sectionsOf(root);
  if (!scroller) return null;
  let top = sections[0] ?? null;
  for (const section of sections) if (offsetIn(scroller, section) <= scroller.scrollTop + 1) top = section;
  return top;
}

function sectionOf(root: HTMLElement, path: string): HTMLElement | null {
  return sectionsOf(root).find((section) => section.dataset.reviewFile === path) ?? null;
}

const countOf = (text: string, sign: '+' | '−') => Number((sign === '+' ? /\+([\d,]+)/ : /−([\d,]+)/).exec(text)?.[1]?.replaceAll(',', '') ?? 0);

// A section's row in `files`: what its header and attributes say.
function fileOf(section: HTMLElement): CodeHarnessReview['files'][number] {
  const counts = section.querySelector('[data-review-counts]')?.textContent ?? '';
  return {
    path: section.dataset.reviewFile!,
    added: countOf(counts, '+'),
    removed: countOf(counts, '−'),
    viewed: section.hasAttribute('data-viewed'),
    kind: section.dataset.kind ?? '',
    folded: section.hasAttribute('data-folded'),
  };
}

function section(path: string, surface?: ReviewSurface): CodeHarnessSection | null {
  const root = reviewRoot(surface);
  const found = root ? sectionOf(root, path) : null;
  if (!root || !found) return null;
  return { ...fileOf(found), hunks: hunksOf(root, (root.dataset.scope || null) as ReviewScope | null, path) };
}

function mustSection(path: string, surface?: ReviewSurface): HTMLElement {
  const found = sectionOf(mustRoot(surface), path);
  if (!found) throw new Error(`harness.code: no section for ${path}`);
  return found;
}

function review(surface?: ReviewSurface): CodeHarnessReview | null {
  const root = reviewRoot(surface);
  if (!root) return null;
  const scope = (root.dataset.scope || null) as ReviewScope | null;
  const files = sectionsOf(root).map(fileOf);
  const selected = topSection(root)?.dataset.reviewFile ?? null;
  const counter = /(\d+) \/ (\d+)/.exec(root.querySelector('[data-review-hunk]')?.textContent ?? '');
  return {
    scope,
    turnId: targetOf(root)?.turnId ?? null,
    files,
    selected,
    hunks: hunksOf(root, scope, selected),
    hunk: counter ? { index: Number(counter[1]), count: Number(counter[2]) } : null,
    mode: root.dataset.mode === 'split' ? 'split' : 'unified',
    wrap: useViewer.getState().wrap,
    scopeWords: scopeWordsIn(root),
    header: root.querySelector('[data-review-header]')?.textContent ?? '',
  };
}

// What the scope reads (the word cut, T357): the description of the chip that is pressed, or of the line that owns the
// words in a diff tab; '' while none is said.
function scopeWordsIn(root: HTMLElement): string {
  const owner = root.querySelector('[data-review-scope-words]') ?? root.querySelector('[data-chip][aria-pressed="true"]');
  const ids = owner?.getAttribute('aria-describedby')?.split(' ') ?? [];
  return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
}

// A reader brings a file into view by scrolling its section to the top of the stack: a wheel, then the scroll, so the
// stack reads it as the person's (a scroll with no input before it is a layout change to the stack).
function bringIntoView(root: HTMLElement, path: string): HTMLElement {
  const scroller = stackOf(root);
  const section = sectionOf(root, path);
  if (!scroller || !section) throw new Error(`harness.code: no section for ${path}`);
  scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
  scroller.scrollTop = offsetIn(scroller, section);
  return section;
}

// The View menu's item: the trigger opens on Enter as on a key press (Radix opens it on a pointer down or a key, not on a
// click), then the item, drawn in a portal, is clicked. Answered by what `review()` reads next.
async function viewItem(root: HTMLElement, item: 'unified' | 'split' | 'wrap'): Promise<void> {
  const trigger = root.querySelector<HTMLElement>('[data-review-view]');
  if (!trigger) throw new Error('harness.code: no View menu');
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const found = await until(() => document.querySelector<HTMLElement>(`[data-review-view-item="${item}"]`), `the View menu's ${item}`);
  found.click();
}

// ---- Files --------------------------------------------------------------------------------------------------------------

const treeRows = () => [...document.querySelectorAll<HTMLElement>('[data-tool="files"] [role="treeitem"]')];
const treeRow = (path: string) => treeRows().find((row) => row.dataset.path === path) ?? null;

function files(): ReturnType<CodeHarnessApi['files']> {
  if (!document.querySelector('[data-tool="files"]')) return null;
  const rows = treeRows().map((row) => ({ path: row.dataset.path!, kind: row.dataset.kind ?? '', depth: Number(row.getAttribute('aria-level') ?? 1) - 1 }));
  return {
    roots: rows.filter((row) => row.kind === 'root').map((row) => row.path),
    expanded: treeRows().filter((row) => row.getAttribute('aria-expanded') === 'true').map((row) => row.dataset.path!),
    selected: treeRows().find((row) => row.getAttribute('aria-selected') === 'true')?.dataset.path ?? null,
    rows,
  };
}

// A directory's listing is drawn when a row below it is one level deeper (an entry or its notice).
function listed(path: string): boolean {
  const all = [...document.querySelectorAll<HTMLElement>('[data-tool="files"] [role="tree"] > div > *')];
  const at = all.findIndex((el) => el.dataset.path === path);
  if (at < 0) return false;
  const next = all[at + 1];
  if (!next) return false;
  if (next.hasAttribute('data-notice')) return true;
  return Number(next.getAttribute('aria-level') ?? 0) > Number(all[at].getAttribute('aria-level') ?? 0);
}

// ---- the viewer ---------------------------------------------------------------------------------------------------------

function viewer(): CodeHarnessViewer | null {
  const tab = activeTab(useLayout.getState().main);
  if (tab?.kind !== 'file') return null;
  const entry = useViewer.getState().entries.get(tab.id);
  if (!entry?.kind) return null;
  const root = document.querySelector<HTMLElement>(`[data-file-viewer][data-path="${CSS.escape(tab.path)}"]`);
  const lines = entry.status === 'ready' && entry.complete && entry.text !== '' ? entry.text.split(/\r\n|\r|\n/).length - (/[\r\n]$/.test(entry.text) ? 1 : 0) : null;
  return {
    path: tab.path,
    kind: entry.kind,
    line: tab.line,
    notice: root?.querySelector('[role="status"][data-notice]')?.textContent ?? null,
    lines,
    sourceView: entry.sourceView,
    language: root?.querySelector<HTMLElement>('[data-code-view]')?.dataset.language || null,
    imageSrc: root?.querySelector<HTMLImageElement>('[data-image-view] img')?.getAttribute('src') ?? null,
  };
}

// ---- the API ------------------------------------------------------------------------------------------------------------

export const codeProbes: CodeHarnessApi = {
  review,
  selectScope: (scope) => click(mustRoot('panel'), `[data-chip="${scope}"]`, `${scope} chip`),
  selectFile: (path, surface) => void bringIntoView(mustRoot(surface), path),
  nextHunk: (surface) => click(mustRoot(surface), 'button[aria-label="Next hunk"]', 'Next hunk'),
  prevHunk: (surface) => click(mustRoot(surface), 'button[aria-label="Previous hunk"]', 'Previous hunk'),
  setMode(mode, surface) {
    const root = mustRoot(surface);
    if ((root.dataset.mode === 'split' ? 'split' : 'unified') === mode) return;
    void viewItem(root, mode).catch((error: unknown) => console.error(error));
  },
  toggleWrap(surface) {
    void viewItem(mustRoot(surface), 'wrap').catch((error: unknown) => console.error(error));
  },
  async markViewed(path, surface) {
    const section = bringIntoView(mustRoot(surface), path);
    const control = await until(() => section.querySelector<HTMLElement>('[data-review-viewed]'), `${path}'s Viewed`);
    const marked = control instanceof HTMLInputElement ? control.checked : control.getAttribute('aria-pressed') === 'true';
    if (!marked) control.click();
  },
  section,
  setFolded(path, folded, surface) {
    const found = mustSection(path, surface);
    if (found.hasAttribute('data-folded') !== folded) click(found, '[data-review-fold]', `${path}'s fold`);
  },
  openFileOf: (path, surface) => click(mustSection(path, surface), '[data-open-file]', `${path}'s Open file ↗`),
  files,
  async expand(path) {
    const row = await until(() => treeRow(path), `tree row ${path}`);
    if (row.getAttribute('aria-expanded') !== 'true') row.click();
    await until(() => (listed(path) ? true : null), `${path}'s listing`);
  },
  selectEntry(path) {
    const row = treeRow(path);
    if (!row) throw new Error(`harness.code: no tree row ${path}`);
    row.click();
  },
  viewer,
  toggleSource() {
    const tab = activeTab(useLayout.getState().main);
    if (tab?.kind === 'file') useViewer.getState().toggleSource(tab.id);
  },
  transcriptKey,
  storeKeys: () => Object.keys(useTranscriptStore.getState().entries),
  changedTurns: (key) => (useTranscriptStore.getState().entries[key]?.rows ?? []).flatMap((row) => (row.kind === 'divider' && row.files?.length && row.turnId ? [row.turnId] : [])),
  openTab: (target) => useLayout.getState().openTab(target),
};
