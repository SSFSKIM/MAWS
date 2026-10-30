// The client's known machines (P5 O6 M3, "Known machines"): `<userData>/known-machines.json`.
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MachineRef } from '@shared/machine/ref';
import { KNOWN_MACHINES_FILE, readKnownMachines, writeKnownMachines, type KnownMachine } from './known-machines';

const B: KnownMachine = { ref: 'StandinBMachineRef0000' as MachineRef, name: 'standin-b', carrier: { kind: 'socket', dir: '/b' } };
let dir: string | null = null;
const fileIn = () => join((dir = mkdtempSync(join(tmpdir(), 'maws-known-'))), KNOWN_MACHINES_FILE);
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('known machines', () => {
  it('writes version 1 with the machines, 0600, and reads them back', () => {
    const file = fileIn();
    writeKnownMachines(file, [B]);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, machines: [B] });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readKnownMachines(file, vi.fn())).toEqual([B]);
  });

  it('reads none from a missing file, silently', () => {
    const log = vi.fn();
    expect(readKnownMachines(fileIn(), log)).toEqual([]);
    expect(log).not.toHaveBeenCalled();
  });

  it('reads none from a file that does not parse or breaks the format, saying so', () => {
    const file = fileIn();
    for (const content of ['{', JSON.stringify({ version: 1, machines: [{ ...B, ref: 'a/b' }] }), JSON.stringify({ version: 2, machines: [] })]) {
      writeFileSync(file, content);
      const log = vi.fn();
      expect(readKnownMachines(file, log), content).toEqual([]);
      expect(log).toHaveBeenCalledWith(expect.stringContaining(file));
    }
  });
});
