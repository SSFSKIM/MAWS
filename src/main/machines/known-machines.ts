// The machines this app has known (P5 O6 M3, docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md, "Known
// machines"): `<userData>/known-machines.json`, the client's own. The connection manager lists every entry from launch, as
// `connecting`, before any link is up, so the layout can tell a known machine that is down from one no longer configured
// (M4); it rewrites the file when a link learns or changes an identity, and drops at launch an entry whose carrier is no
// longer configured. O10 and O11 add carriers and sources (the org state, RL2 endpoints).
//
// A cache of what links told: a file that does not read is logged and read as none, which costs only the tabs of a known
// machine that is down at this launch.
import * as fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import * as z from 'zod';
import { MachineRefSchema, type MachineRef } from '@shared/machine/ref';

export const KNOWN_MACHINES_FILE = 'known-machines.json';

const KnownMachineSchema = z.strictObject({
  ref: MachineRefSchema,
  name: z.string(),
  carrier: z.strictObject({ kind: z.literal('socket'), dir: z.string().min(1) }), // another profile's directory (its serve directory before P5 O3-D M6)
});
const KnownMachinesSchema = z.strictObject({ version: z.literal(1), machines: z.array(KnownMachineSchema) });

export interface KnownMachine {
  ref: MachineRef;
  name: string;
  carrier: { kind: 'socket'; dir: string };
}

export function readKnownMachines(file: string, log: (line: string) => void): KnownMachine[] {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') log(`${file} could not be read (${(error as Error).message}); no machine is known`);
    return [];
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    log(`${file} is not JSON; no machine is known`);
    return [];
  }
  const parsed = KnownMachinesSchema.safeParse(data);
  if (!parsed.success) {
    log(`${file} is not a version 1 list of known machines (${z.prettifyError(parsed.error)}); no machine is known`);
    return [];
  }
  return parsed.data.machines as KnownMachine[];
}

// Written through a temporary file and a rename, so a reader never sees half of it.
export function writeKnownMachines(file: string, machines: readonly KnownMachine[]): void {
  const temporary = `${file}.${process.pid}.${randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, machines }, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}
