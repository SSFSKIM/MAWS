// Every sentence the panel host shows (C8a execution document, Interfaces *Copy*; the exact strings are decisions).
// M2 adds the summary's section copy here.
import { ARRIVES_WITH } from './arrives-with';

export const COPY = {
  home: 'Session overview',
  add: 'Add a tool',
  addNoSession: 'Open a session to add a tool',
  noTools: 'No tools registered yet',
  allOpen: 'Every tool is already open here', // every registered tool is single-instance and has a tab in the shown scope
  footer: 'Tools stay with this session. Pin a tab to keep it with you as you switch.',
  pin: (title: string) => `Pin ${title}`,
  unpin: (title: string) => `Unpin ${title}`,
  close: (title: string) => `Close ${title}`,
} as const;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The summary card (Interfaces *Copy*).
export const SUMMARY_COPY = {
  title: 'Session overview',
  sections: { environment: 'Environment', push: 'Push state', subagents: 'Subagents', background: 'Background work', sources: 'Sources' },
  // Environment
  branch: (branch: string) => `⎇ ${branch}`,
  detached: (head: string) => `detached at ${head.slice(0, 7)}`,
  notRepository: 'Not a git repository',
  gitUnavailable: 'Git unavailable',
  pending: '…', // git has not answered yet; the change line while its diff has not
  clean: 'Clean',
  across: (files: number) => `across ${plural(files, 'file')}`,
  untracked: (n: number) => ` · ${n} untracked`,
  binary: (n: number) => ` · ${n} binary`,
  changeUnavailable: 'Change unavailable',
  model: (model: string | null, effort: string | null) => `${model ?? 'model unknown'} · ${effort ?? 'effort unknown'}`,
  review: 'Review',
  sessionInfo: 'Session info',
  // Push state
  notPushed: 'Not pushed',
  ahead: (n: number, upstream: string) => `${n} ahead of ${upstream}`,
  upToDate: (upstream: string) => `Up to date with ${upstream}`,
  behind: (n: number) => ` · ${n} behind`,
  openOnGitHub: 'Open on GitHub',
  // Subagents and Background work
  open: 'Open',
  agents: (working: number, done: number) => `${working} working · ${done} done`,
  noAgents: 'No subagents yet',
  background: (counts: { shells: number; workflows: number; monitors: number; other: number }) =>
    [
      counts.shells && plural(counts.shells, 'shell'),
      counts.workflows && plural(counts.workflows, 'workflow'),
      counts.monitors && plural(counts.monitors, 'monitor'),
      counts.other && `${counts.other} other`,
    ]
      .filter(Boolean)
      .join(' · ') || 'Nothing running',
  runsOnDisk: (n: number) => `${plural(n, 'workflow run')} on disk`,
  shellsUnavailable: 'Shells and monitors are known only while the session runs here',
  // Sources
  noSources: 'No sources yet',
  openSession: 'Open the session to list its sources',
  loading: 'Loading…',
  sourceOnly: 'Source only',
} as const;

// "Arrives with <child>" for a tool id the host has no registration for; an id outside the P0 table names no child.
export function arrivesWith(toolId: string): string {
  const child = ARRIVES_WITH[toolId];
  return child ? `Arrives with ${child}` : `${toolId} is not available`;
}
