// The orphan ledger (E10 execution document, §Design 1 "The orphan ledger and sweep"): `<supervisorDir>/live.json`
// names the supervisor that wrote it and every engine process it holds live, so a successor that finds the owner dead
// can stop the engines nobody can reach any more. The process table rewrites it at every launch and exit; the exit
// order clears it only when this supervisor still owns it, so a successor's ledger is never touched.
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as z from 'zod';
import { SUPERVISOR_FILES } from './supervisor-files';

export interface Owner {
  pid: number;
  procStart: string;
}

export interface LiveRow {
  appSessionId: string;
  pid: number;
  procStart: string;
  launchId: string;
}

const OwnerSchema = z.object({ pid: z.number().int(), procStart: z.string() });
const LedgerSchema = z.object({
  owner: OwnerSchema,
  rows: z.array(z.object({ appSessionId: z.string(), pid: z.number().int(), procStart: z.string(), launchId: z.string() })),
});

export type Ledger = z.infer<typeof LedgerSchema>;

const ledgerPath = (dir: string) => join(dir, SUPERVISOR_FILES.live);

export function writeLive(dir: string, owner: Owner, rows: readonly LiveRow[]): void {
  const path = ledgerPath(dir);
  const temporary = `${path}.${owner.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify({ owner, rows: [...rows] } satisfies Ledger), { mode: 0o600 });
  renameSync(temporary, path);
}

// The ledger, or null when it is absent or unreadable (the sweep is then skipped with a log line).
export function readLive(dir: string): Ledger | null {
  try {
    const parsed = LedgerSchema.safeParse(JSON.parse(readFileSync(ledgerPath(dir), 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// The exit order's step 3: a no-op unless the ledger's owner is `owner` (pid and start time).
export function clearLive(dir: string, owner: Owner): void {
  const ledger = readLive(dir);
  if (!ledger || ledger.owner.pid !== owner.pid || ledger.owner.procStart !== owner.procStart) return;
  try {
    unlinkSync(ledgerPath(dir));
  } catch {
    // already gone
  }
}
