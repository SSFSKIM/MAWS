// Every sentence the code tools show (C8c execution document, Interfaces *Copy*; exact strings are decisions). M2 holds
// the Files tool's and the viewer's; Review's join in M3.
import { FILES_LIST_MAX_ENTRIES } from '@shared/ipc/schema/files';

// Sizes in binary units labelled KB and MB (`1.0 MB` is 1,048,576 bytes), as the acceptance reads them.
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export const REFUSAL = "path outside the session's directories";

export const FILES_COPY = {
  title: 'Files',
  refresh: 'Refresh',
  noSession: 'Open a session to see its files',
  roles: { directory: 'directory', additional: 'additional directory', worktree: 'worktree' },
  symlink: (target: string | null) => `Symbolic link → ${target ?? 'unknown target'}`,
  empty: 'Empty directory',
  truncated: `Showing ${FILES_LIST_MAX_ENTRIES.toLocaleString('en-US')} of many entries`,
  couldNotList: (message: string) => `Could not list: ${message}`,
  refused: (message: string) => `Refused: ${message}`,
} as const;

export const VIEWER_COPY = {
  source: 'Source',
  rendered: 'Rendered',
  wrap: 'Wrap',
  openExternally: 'Open externally',
  externalKind: (kind: string) => `${kind} files open outside MAWS`,
  binary: (bytes: number) => `Binary file · ${formatSize(bytes)}`,
  head: (head: number, bytes: number) => `Showing the first ${formatSize(head)} of ${formatSize(bytes)}`,
  loadMore: 'Load more',
  loading: 'Loading',
  continuing: (loaded: number, bytes: number) => `Loading ${formatSize(loaded)} of ${formatSize(bytes)}`,
  noSession: 'No session grants access to this file',
  removed: 'File removed',
  updated: 'Updated',
  refused: (message: string) => `Refused: ${message}`,
  notOpened: (message: string) => `Not opened: ${message}`,
} as const;
