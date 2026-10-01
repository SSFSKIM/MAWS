// `window.__maws_harness.code` (C8c execution document, Interfaces *Harness API*; the types are `api.ts`): reads what
// Review, Files and the viewer draw, from their DOM (the chips, the list, the counter, the tree rows, the notices) and
// the stores behind it (the hunk texts, the viewer's text), and drives them with the clicks a reader would make.
import type { AppSessionId } from '@shared/graph/ids';
import { instanceOf } from '../../panel/host';
import { useGit } from '../../stores/git';
import { useLayout } from '../../stores/layout';
import { activeTab, sessionOfTab } from '../../stores/layout-model';
import { useSessions } from '../../stores/sessions';
import { gitScopeFiles, parseRef, receiptOf, turnScopeFiles, type ReviewFile, type ReviewScope } from '../../tools/code/review/review-model';
import { diffOf, fileDiffOf, turnKeyOf, useReview, type DiffTarget } from '../../tools/code/review/review-store';
import type { ReviewState } from '../../tools/code/review/ReviewTool';
import { useViewer } from '../../tools/code/viewer/viewer-store';
import { useTranscriptStore, type TurnId } from '../../transcript';
import type { CodeHarnessApi, CodeHarnessReview, CodeHarnessViewer, ReviewSurface } from './api';
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

const buttonNamed = (root: ParentNode, text: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text) ?? null;

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
    appSessionId = sessionOfTab(activeTab(useLayout.getState().main));
    const selected = appSessionId ? useLayout.getState().panelBySession.get(appSessionId)?.activeTabId : null;
    const pinned = useLayout.getState().panelPinned.find((t) => t.toolId === 'review')?.id;
    const tabId = selected && instanceOf(selected)?.tool.id === 'review' ? selected : (pinned ?? null);
    const state = tabId ? (instanceOf(tabId)?.state as ReviewState | undefined) : undefined;
    turnId = state?.ui.getState().turnId ?? null;
  }
  const record = appSessionId ? useSessions.getState().records.get(appSessionId) : undefined;
  if (!appSessionId || !record) return null;
  return { appSessionId, directory: record.worktree?.path ?? record.directory, turnId };
}

// The files Review lists for a scope, from the same stores and the same functions its shell reads.
function filesOf(target: ReviewTarget, scope: ReviewScope): { files: ReviewFile[]; diff: DiffTarget | null } | null {
  if (scope === 'turn') {
    if (target.turnId === null) return null;
    const { entries } = useTranscriptStore.getState();
    const key = turnKeyOf(entries, target.appSessionId, target.turnId);
    if (key === null) return null;
    const activity = useTranscriptStore.getState().activity(key).find((a) => a.turnId === target.turnId) ?? null;
    return { files: turnScopeFiles(receiptOf(entries[key].rows, target.turnId)?.files ?? [], activity), diff: null };
  }
  const status = useGit.getState().entries.get(target.directory)?.status ?? null;
  if (!status) return null;
  const found = [...useReview.getState().diffs.keys()].find((key) => key.startsWith(`${target.directory}\0${scope}\0`));
  if (!found) return null;
  const base = found.slice(`${target.directory}\0${scope}\0`.length);
  const diffTarget: DiffTarget = { directory: target.directory, scope, base: base === '' ? null : base };
  const diff = diffOf(useReview.getState(), diffTarget);
  if (diff?.status !== 'ok') return null;
  return { files: gitScopeFiles({ scope, repoRoot: status.repoRoot, files: diff.files, patch: diff.patch, status }), diff: diffTarget };
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

function review(surface?: ReviewSurface): CodeHarnessReview | null {
  const root = reviewRoot(surface);
  if (!root) return null;
  const scope = (root.dataset.scope || null) as ReviewScope | null;
  const files = [...root.querySelectorAll<HTMLButtonElement>('[role="option"] button[data-path]')].map((button) => {
    const counts = /\+(\d+) −(\d+)/.exec(button.textContent ?? '');
    return { path: button.dataset.path!, added: Number(counts?.[1] ?? 0), removed: Number(counts?.[2] ?? 0), viewed: button.hasAttribute('data-viewed'), kind: button.dataset.kind ?? '' };
  });
  const selected = root.querySelector<HTMLElement>('[role="option"][aria-selected="true"] button[data-path]')?.dataset.path ?? null;
  const counter = /Showing hunk (\d+) of (\d+)/.exec(root.querySelector('[data-review-hunk]')?.textContent ?? '');
  return {
    scope,
    turnId: targetOf(root)?.turnId ?? null,
    files,
    selected,
    hunks: hunksOf(root, scope, selected),
    hunk: counter ? { index: Number(counter[1]), count: Number(counter[2]) } : null,
    mode: buttonNamed(root, 'Split')?.getAttribute('aria-pressed') === 'true' ? 'split' : 'unified',
    wrap: useViewer.getState().wrap,
    footer: root.querySelector('[data-review-footer]')?.textContent ?? '',
    header: root.querySelector('[data-review-header]')?.textContent ?? '',
  };
}

const fileButton = (path: string) => `[role="option"] button[data-path="${CSS.escape(path)}"]`;

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
  selectFile: (path, surface) => click(mustRoot(surface), fileButton(path), `file ${path}`),
  nextHunk: (surface) => click(mustRoot(surface), 'button[aria-label="Next hunk"]', 'Next hunk'),
  prevHunk: (surface) => click(mustRoot(surface), 'button[aria-label="Previous hunk"]', 'Previous hunk'),
  setMode(mode, surface) {
    const button = buttonNamed(mustRoot(surface), mode === 'split' ? 'Split' : 'Unified');
    if (!button) throw new Error('harness.code: no mode toggle (the file has no hunks)');
    button.click();
  },
  toggleWrap(surface) {
    const button = buttonNamed(mustRoot(surface), 'Wrap');
    if (!button) throw new Error('harness.code: no Wrap toggle');
    button.click();
  },
  async markViewed(path, surface) {
    click(mustRoot(surface), fileButton(path), `file ${path}`);
    const section = await until(() => mustRoot(surface).querySelector<HTMLElement>(`[data-review-file="${CSS.escape(path)}"]`), `${path}'s section`);
    const button = await until(() => buttonNamed(section, 'Mark viewed') ?? buttonNamed(section, 'Viewed'), 'Mark viewed');
    if (button.textContent === 'Mark viewed') button.click();
  },
  openSelectedFile: (surface) => click(mustRoot(surface), '[data-open-file]', 'Open file ↗'),
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
  async clickReceiptReview(path) {
    const selector = path ? `.transcript-receipt-file[data-path="${CSS.escape(path)}"]` : '.transcript-receipt-review';
    const button = await until(() => document.querySelector<HTMLElement>(`[data-code-harness-transcript] ${selector}`), path ? `receipt row ${path}` : 'Review changes');
    button.click();
  },
  transcriptKey,
  storeKeys: () => Object.keys(useTranscriptStore.getState().entries),
  receiptTurns: (key) => (useTranscriptStore.getState().entries[key]?.rows ?? []).flatMap((row) => (row.kind === 'receipt' && row.turnId ? [row.turnId] : [])),
  openTab: (target) => useLayout.getState().openTab(target),
};
