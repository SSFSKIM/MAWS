// Every sentence of the memory budget's surfaces (C12 execution document, Interfaces "Surfaces of the budget"; charter
// §4.4 as amended by D1): the released mark on a row and a card, Session info's two lines, the banner, the blocked
// sessions sheet and the stop sheet. A release is quiet (D-18, §5.7): these words inform, they never ask.
import type { EngineSessionStatus, HardReason } from '@shared/engine/status';
import { formatClock } from '../app/date-format';

const KIB_PER_GB = 1024 * 1024;

// A size in GB with one decimal, the decimal left out when it is zero (8 GB, 3.1 GB).
export function gb(kib: number): string {
  const tenths = Math.round((kib / KIB_PER_GB) * 10) / 10;
  return `${Number.isInteger(tenths) ? tenths.toFixed(0) : tenths.toFixed(1)} GB`;
}

// A clock time on the host's day, as the system locale writes it (2:02 PM; 오후 2:02): one clock with every other time
// the app shows (L129, Q2's ruling proposed at P2-F: the app's dates and times follow the system locale).
export function clockTime(iso: string): string {
  return formatClock(Date.parse(iso));
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// E10: the mark also says the supervisor's idle release (its idle clock: no app connected, or exit-when-idle armed after an
// update), which has no limit and its own neutral words (Decision Log: "Stopped at HH:MM while idle").
export interface Released {
  at: string;
  reason: 'budget' | 'idle';
  limitKiB: number | null;
}

export const BUDGET = {
  mark: 'released',
  markTitle: (r: Released) =>
    r.reason === 'budget' && r.limitKiB !== null
      ? `Released at ${clockTime(r.at)} to stay under the ${gb(r.limitKiB)} memory budget · Send resumes it`
      : `Stopped at ${clockTime(r.at)} while idle · Send resumes it`,
  // Session info
  budgetLabel: 'Memory budget',
  budgetLine: (totalKiB: number, limitKiB: number, sessions: number) => `${gb(totalKiB)} of ${gb(limitKiB)} · ${plural(sessions, 'session')}`,
  budgetOffLine: (totalKiB: number, sessions: number) => `Off · ${gb(totalKiB)} · ${plural(sessions, 'session')}`, // W7: the totals, no limit
  releasedLabel: 'Process',
  releasedLine: (r: Released) => (r.reason === 'budget' && r.limitKiB !== null ? `Released at ${clockTime(r.at)} to stay under ${gb(r.limitKiB)}` : `Stopped at ${clockTime(r.at)} while idle`),
  // The banner (one per crossing of the host's two-sample flag)
  banner: (held: number) => `Memory budget exceeded · ${plural(held, 'session holds', 'sessions hold')} work MAWS will not stop`,
  review: 'Review…',
  // The blocked sessions sheet
  blockedTitle: 'Sessions holding work',
  blockedBody: (totalKiB: number, limitKiB: number) =>
    `MAWS is using ${gb(totalKiB)} of its ${gb(limitKiB)} memory budget, and every live session holds something stopping it would lose. Nothing is stopped unless you stop it.`,
  noneBlocked: 'No session holds work now.',
  stop: 'Stop…',
  close: 'Close',
  // The stop sheet (C10's archive sheet's pattern)
  stopTitle: (title: string) => `Stop “${title}”?`,
  stopBody: 'Ends its engine process. The session stays in the sidebar with its transcript, queue and session grants; resume it from its row.',
  stopConfirm: 'Stop',
  cancel: 'Cancel',
};

// Why a live session is not released, in words, counted from its status where a count helps (§4.4's keep-alive list).
export function reasonWords(reason: HardReason, status: EngineSessionStatus | null, stateful: ReadonlySet<string>): string {
  switch (reason) {
    case 'turn':
      return 'mid-turn';
    case 'busy':
      return 'working';
    case 'background_tasks': {
      const tasks = status?.backgroundTasks.filter((t) => !t.ambient).length ?? 0;
      return tasks > 0 ? plural(tasks, 'background task') : 'background tasks';
    }
    case 'pending_request':
      return 'waiting for you';
    case 'queued_messages': {
      const queued = status?.queue.length ?? 0;
      return queued > 0 ? plural(queued, 'queued message') : 'queued messages';
    }
    case 'held_peer_message':
      return 'held message';
    case 'stateful_mcp': {
      const names = (status?.mcpServers ?? []).filter((s) => stateful.has(s.name) && (s.status === 'connected' || s.status === 'pending')).map((s) => s.name);
      return names.length > 0 ? `stateful server ${names.join(', ')}` : 'stateful server';
    }
  }
}
