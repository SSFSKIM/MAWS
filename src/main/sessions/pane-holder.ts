// W14: OS ancestry, not the asynchronously projected session holder, identifies our terminal panes.
import { execFile } from 'node:child_process';
import type { CommandInput, CommandOutput } from '@shared/ipc/schema';
import type { PtyInfo } from '@shared/ipc/schema/pty';
import type { HostDispatch } from '../ipc/router';
import { HostError } from './context';

export interface PaneProcess {
  pid: number;
  ppid: number;
  pgid: number;
  foreground: number;
  state: string;
  started: string;
}
export type Processes = Map<number, PaneProcess>;
export function parseProcesses(text: string): Processes {
  const result: Processes = new Map();
  for (const line of text.split('\n')) {
    const [pid, ppid, pgid, foreground, state, ...started] = line.trim().split(/\s+/);
    if (!state || started.length !== 5 || ![pid, ppid, pgid, foreground].every((x) => /^-?\d+$/.test(x))) continue;
    result.set(Number(pid), { pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), foreground: Number(foreground), state, started: started.join(' ') });
  }
  return result;
}
export function readProcesses(): Promise<Processes> {
  return new Promise((resolve, reject) => {
    execFile('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,tpgid=,stat=,lstart='], { timeout: 2_000 }, (error, stdout) => error ? reject(error) : resolve(parseProcesses(stdout)));
  });
}
export function paneForPid(pid: number, panes: readonly PtyInfo[], table: Processes): PtyInfo | null {
  const seen = new Set<number>([pid]);
  let parent = table.get(pid)?.ppid;
  while (parent !== undefined && !seen.has(parent)) {
    const pane = panes.find((p) => p.alive && p.pid === parent);
    if (pane) return pane;
    seen.add(parent);
    parent = table.get(parent)?.ppid;
  }
  return null;
}
export function canForeground(pid: number, shell: number, table: Processes): boolean {
  const holder = table.get(pid);
  if (!holder || holder.ppid !== shell || !holder.state.includes('T') || table.get(shell)?.foreground !== shell) return false;
  // Count jobs by process group: a job may itself contain several stopped processes.
  const jobs = new Set([...table.values()].filter((p) => p.ppid === shell && p.state.includes('T')).map((p) => p.pgid));
  return jobs.size === 1 && jobs.has(holder.pgid);
}
export async function paneCall<N extends 'pty.list' | 'pty.write' | 'pty.foreground'>(dispatch: HostDispatch, name: N, input: CommandInput<N>): Promise<CommandOutput<N>> {
  const result = await dispatch('pty-host', name, input);
  if (!result.ok) throw new HostError(result.error.code, result.error.message);
  return result.value as CommandOutput<N>;
}
export async function findPane(dispatch: HostDispatch, pid: number, processes = readProcesses): Promise<{ pane: PtyInfo; holder: PaneProcess } | null> {
  const [{ ptys }, table] = await Promise.all([paneCall(dispatch, 'pty.list', undefined), processes()]);
  const pane = paneForPid(pid, ptys, table);
  const holder = table.get(pid);
  return pane && holder ? { pane, holder } : null;
}
