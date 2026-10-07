// The partitioned (CHIPS) cookie route (E4b Design §8; A-33 item 8; Decision Log 3): `session.cookies.set` stores a
// `partitionKey` cookie unpartitioned, so a partitioned row is set through CDP only, on a debugger of the partition. No
// tab of any session carries it: main creates the import view, an unattached `WebContentsView` in the partition on
// `about:blank` (never in a window, E4a's tab map, `tabs.json` or the cap), wraps its webContents in E4a's `TabDebugger`
// (`send` stays the one CDP path) with no command observer (so no parameter or reply reaches a log), sets every row,
// verifies them through one `Network.getAllCookies`, and destroys the view on every exit, an abort included.
import { WebContentsView, type WebContents } from 'electron';
import { TabDebugger } from '../debugger';
import type { NetworkSetCookieParams } from './chrome/cookies';

// What the import needs of the view's webContents (a `WebContentsView`'s satisfies it).
export interface ImportViewContents {
  readonly debugger: WebContents['debugger'];
  isDestroyed(): boolean;
  loadURL(url: string): Promise<void>;
  close(): void;
}
export interface ImportView {
  readonly webContents: ImportViewContents;
}
export type CreateImportView = (partition: string) => ImportView;

// The real view: sandboxed, no preload, the partition's session.
export const createImportView: CreateImportView = (partition) =>
  new WebContentsView({ webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });

export interface PartitionedCookie {
  cdp: NetworkSetCookieParams; // holds the value: never logged
  host: string;
}

// Hosts, one entry per row, for the report's per-reason lists; `notVerified` are set rows the partition did not list
// (`imported - verified` of them, Decision Log 36). `error`: the view could not load, attach or answer.
export interface PartitionedResult {
  imported: number;
  verified: number;
  rejected: string[];
  notVerified: string[];
  cancelled: number;
  error: 'importViewFailed' | null;
}

const LOAD_DEADLINE_MS = 10_000;

interface ListedCookie {
  name?: unknown;
  domain?: unknown;
  path?: unknown;
  partitionKey?: unknown;
}

export async function importPartitionedCookies({
  partition,
  cookies,
  createView,
  signal,
  progress,
  loadDeadlineMs = LOAD_DEADLINE_MS,
}: {
  partition: string;
  cookies: readonly PartitionedCookie[];
  createView: CreateImportView;
  signal: AbortSignal;
  progress: (phase: 'cookies' | 'verifying', done: number, total: number) => void;
  loadDeadlineMs?: number;
}): Promise<PartitionedResult> {
  const result: PartitionedResult = { imported: 0, verified: 0, rejected: [], notVerified: [], cancelled: 0, error: null };
  const set: PartitionedCookie[] = [];
  const confirmed = new Set<PartitionedCookie>();
  let attempted = 0;
  let contents: ImportViewContents | null = null;
  let debuggerOfView: TabDebugger | null = null;
  const destroy = () => {
    debuggerOfView?.detach();
    if (contents && !contents.isDestroyed()) contents.close();
  };
  signal.addEventListener('abort', destroy, { once: true });
  try {
    if (signal.aborted) throw signal.reason;
    contents = createView(partition).webContents;
    await withDeadline(contents.loadURL('about:blank'), loadDeadlineMs);
    debuggerOfView = new TabDebugger(contents);
    for (const cookie of cookies) {
      if (signal.aborted) break;
      attempted++;
      try {
        await debuggerOfView.send('Network.setCookie', { ...cookie.cdp });
        set.push(cookie);
      } catch {
        // Chromium's sanitiser refused it; the reason is not kept (it could quote the row)
        if (signal.aborted) set.push(cookie); // the view was closed under it: counted as set, rolled back with the run
        else result.rejected.push(cookie.host);
      }
      progress('cookies', attempted, cookies.length);
    }
    if (!signal.aborted && set.length > 0) {
      progress('verifying', 0, set.length);
      const { cookies: listed } = await debuggerOfView.send<{ cookies: ListedCookie[] }>('Network.getAllCookies');
      for (const cookie of set) if (listed.some((candidate) => isListed(cookie.cdp, candidate))) confirmed.add(cookie);
      progress('verifying', set.length, set.length);
    }
  } catch {
    if (!signal.aborted) {
      result.error = 'importViewFailed';
      for (const cookie of cookies.slice(attempted)) result.rejected.push(cookie.host);
      attempted = cookies.length;
    }
  } finally {
    signal.removeEventListener('abort', destroy);
    destroy();
  }
  result.imported = set.length;
  result.verified = confirmed.size;
  result.notVerified = set.filter((cookie) => !confirmed.has(cookie)).map((cookie) => cookie.host);
  result.cancelled = cookies.length - attempted;
  return result;
}

// A set row is confirmed when the partition lists a cookie of its name, domain (dot-insensitive), path and top-level
// site. `partitionKey` is an object in current CDP and a bare site string in older ones.
function isListed(row: NetworkSetCookieParams, cookie: ListedCookie): boolean {
  const key = cookie.partitionKey;
  const site = typeof key === 'string' ? key : typeof key === 'object' && key !== null ? (key as { topLevelSite?: unknown }).topLevelSite : undefined;
  const bare = (domain: string) => domain.replace(/^\./, '').toLowerCase();
  const domain = row.domain ?? new URL(row.url).hostname;
  return cookie.name === row.name && typeof cookie.domain === 'string' && bare(cookie.domain) === bare(domain) && cookie.path === row.path && site === row.partitionKey.topLevelSite;
}

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('the import view did not load in time')), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}
