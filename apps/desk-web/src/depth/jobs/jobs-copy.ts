// The jobs view's words (DC9; the mockup's 4A and 4C): the tab's label, the MCP list's, and what a shell's Output says
// for each of DX4's `output` answers. Stop's words are MAWS's row's and §5's reasons (`conversation/capabilities.ts`).
import type { Job } from 'desk-hub/protocol';

/** A byte count as a reader takes it in: bytes, then KB and MB to one decimal. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A task's output path by what tells it apart, its last two parts (the whole in the tooltip). */
export function shortPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts.length <= 2 ? path : `…/${parts.slice(-2).join('/')}`;
}

/** The tab's label: `Jobs`, then how many run, else how many there are. */
export function jobsTabLabel(jobs: readonly Job[] | null): string {
  if (!jobs || jobs.length === 0) return 'Jobs';
  const running = jobs.filter((job) => job.status === 'running').length;
  return `Jobs · ${running > 0 ? `${running} running` : jobs.length}`;
}

/**
 * What a `missing` answer with no path says: while the job runs in a live session a file may still be named, and Output
 * asks again when one is; once the job or the session has ended, none will be.
 */
export function noFileNote(final: boolean): { main: string; why?: string } {
  return final ? { main: JOBS_COPY.noFileFinal } : { main: JOBS_COPY.noFile, why: JOBS_COPY.noFileWhy };
}

export const JOBS_COPY = {
  mcp: (n: number) => `MCP servers · ${n}`,
  mcpNote: "Names from the session's rows. Whether each is connected is not known to the web.",
  monitorNoFile: 'No output file yet: a monitor names none at its start.',
  none: 'No background jobs in this session',
  olderDaemon: (machine: string) => `${machine}'s daemon does not report background jobs: it predates them.`,
  asking: (machine: string) => `Asking ${machine}…`,
  before: (bytes: number) => `${formatBytes(bytes)} before this, not shown`,
  empty: 'The file is empty.',
  gone: (machine: string) => `The output file is gone from ${machine}.`,
  goneWhy: "The engine keeps it under the machine's temporary directory.",
  noFile: 'No output file yet.',
  noFileWhy: 'Output asks again when the session names one.',
  noFileFinal: 'No output file was named for this job.',
  refused: (machine: string, reason: string) => `${machine} would not read it: ${reason}`,
  checking: (machine: string) => `Checking with ${machine}…`,
  unknown: (machine: string) => `${machine} does not know this task.`,
  refresh: 'Refresh',
  close: 'Close',
};
