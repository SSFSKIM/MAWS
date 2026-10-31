// The roster as an engine host reads it (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, Interfaces §B and §D; D10,
// D46): `<profile>/supervisor/hosts/<holderId>.json`, one entry per session host, written by the host itself at each
// state change (native/session-host/roster), so it outlives the engine host that launched it. At its start an engine
// host reads it to find the hosts it adopts (adopt.ts), the dead hosts whose child the sweep may still have to stop,
// and the launches journal pruning must keep. An entry is read tolerantly (a later minor may add fields); one that does
// not parse is skipped with a log line, as is the host's own temp file (`.<holderId>.json.<pid>.tmp`, D43).
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as z from 'zod';
import { isSameProcess } from '../supervisor-files';

const ChildSchema = z.looseObject({ pid: z.number().int(), procStart: z.string() });
export const RosterEntrySchema = z.looseObject({
  protocol: z.number().int(),
  holderId: z.string().regex(/^[A-Za-z0-9_-]+$/),
  pid: z.number().int(),
  procStart: z.string(),
  startedAt: z.string(),
  socket: z.string(),
  binary: z.string(),
  appSessionId: z.string().nullable(),
  engineSessionId: z.string().nullable(),
  state: z.enum(['ready', 'committed', 'running', 'exited']),
  child: ChildSchema.nullable(),
  fence: z.number().int(),
  exit: z.looseObject({ code: z.number().int().nullable(), signal: z.string().nullable(), at: z.string() }).nullable(),
});
export type RosterEntry = z.infer<typeof RosterEntrySchema>;

const ENTRY_FILE = /^([A-Za-z0-9_-]+)\.json$/; // a dot-file or `*.tmp` never matches

// Every entry in `hostsDir`, in no particular order; a missing directory has none.
export function readRoster(hostsDir: string, log: (line: string) => void): RosterEntry[] {
  if (!existsSync(hostsDir)) return [];
  const entries: RosterEntry[] = [];
  for (const name of readdirSync(hostsDir)) {
    const match = ENTRY_FILE.exec(name);
    if (!match) continue;
    try {
      const parsed = RosterEntrySchema.safeParse(JSON.parse(readFileSync(join(hostsDir, name), 'utf8')));
      if (parsed.success && parsed.data.holderId === match[1]) entries.push(parsed.data);
      else log(`roster entry ${name} skipped: ${parsed.success ? 'its holder id is not its name' : parsed.error.issues[0]?.message ?? 'malformed'}`);
    } catch (error) {
      log(`roster entry ${name} skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return entries;
}

// Live: the host's pid is alive and is still the process the entry recorded (its start time); anything else is dead.
export function liveHosts(entries: readonly RosterEntry[], deps: { isAlive(pid: number): boolean; procStartOf(pid: number): string | null }): { live: RosterEntry[]; dead: RosterEntry[] } {
  const live: RosterEntry[] = [];
  const dead: RosterEntry[] = [];
  for (const entry of entries) (entry.procStart !== '' && isSameProcess({ pid: entry.pid, procStart: entry.procStart }, deps) ? live : dead).push(entry);
  return { live, dead };
}

// A dead host's entry, token and socket (the fallback directory's too, which the entry names); its log stays for the
// diagnosis and goes with the age rule (pruneHostLogs).
export function removeHostFiles(hostsDir: string, entry: RosterEntry): void {
  for (const path of [join(hostsDir, `${entry.holderId}.json`), join(hostsDir, `${entry.holderId}.token`), join(hostsDir, `${entry.holderId}.sock`), entry.socket]) rmSync(path, { force: true });
}

// D46: a session host keeps its log at every exit, so one is pruned at the engine host's start once no roster entry
// names it and it is older than `maxAgeDays` (the journals' limit). Answers how many went.
export function pruneHostLogs(hostsDir: string, named: ReadonlySet<string>, opts: { maxAgeDays: number; now?: Date }): number {
  if (!existsSync(hostsDir)) return 0;
  const cutoff = (opts.now ?? new Date()).getTime() - opts.maxAgeDays * 86_400_000;
  let removed = 0;
  for (const name of readdirSync(hostsDir)) {
    const match = /^([A-Za-z0-9_-]+)\.log$/.exec(name);
    if (!match || named.has(match[1]!)) continue;
    const path = join(hostsDir, name);
    try {
      if (statSync(path).mtimeMs >= cutoff) continue;
      rmSync(path, { force: true });
      removed += 1;
    } catch {
      // gone meanwhile
    }
  }
  return removed;
}
