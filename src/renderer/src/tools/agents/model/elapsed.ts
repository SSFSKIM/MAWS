// Elapsed time and token counts for the agent tools (C8b execution document, Interfaces *Elapsed*): a running node ticks
// from its start event; one with no start reads the engine's own count at its last report; an ended one reads its
// usage or its end minus its start; with neither, the view says `elapsed unavailable` rather than guessing.
import type { TaskNode } from './task-graph';

export function elapsedOf(node: TaskNode, now: number): { ms: number; live: boolean } | null {
  const span = node.startedAt !== null && node.endedAt !== null ? Date.parse(node.endedAt) - Date.parse(node.startedAt) : null;
  if (node.status === 'running') {
    if (node.startedAt !== null) return { ms: Math.max(0, now - Date.parse(node.startedAt)), live: true };
    return node.usage ? { ms: node.usage.durationMs, live: false } : null;
  }
  if (node.usage) return { ms: node.usage.durationMs, live: false };
  return span === null ? null : { ms: Math.max(0, span), live: false };
}

const pad = (n: number) => String(n).padStart(2, '0');

// `12s` under a minute, `4m 02s` under an hour, `1h 04m` above.
export function formatElapsed(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${pad(seconds % 60)}s`;
  return `${Math.floor(minutes / 60)}h ${pad(minutes % 60)}m`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// How long ago an agent ended, in the app's relative form (the status line's): `just now`, `3m ago`, `2h ago`, `1d ago`.
export function formatAgo(ms: number): string {
  if (ms < MINUTE) return 'just now';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m ago`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h ago`;
  return `${Math.floor(ms / DAY)}d ago`;
}

// `512`, `38.1k`, `1.2M`: a token count where its column names the unit (a workflow's agent table).
export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n);
  const k = Math.round(n / 100) / 10;
  if (k < 1000) return `${k.toFixed(1)}k`;
  return `${(Math.round(n / 100_000) / 10).toFixed(1)}M`;
}

// `512 tokens`, `38.1k tokens`, `1.2M tokens`.
export function formatTokens(n: number): string {
  return n === 1 ? '1 token' : `${formatTokenCount(n)} tokens`;
}
