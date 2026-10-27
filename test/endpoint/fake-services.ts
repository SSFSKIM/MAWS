// `EndpointServices` as `mawsd` will give them (O2's seam), for the endpoint's suites before O2 lands: a scratch profile
// with its state directory (0700), the machine's ref, and a log the suite reads. Nothing here touches the owner's
// profile: every directory is a fresh temporary one.
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MachineRef } from '@shared/machine/ref';
import type { EndpointServices } from '../../src/endpoint/services';

export type FakeServices = EndpointServices & { lines: string[]; holds: Set<string>; cleanup(): void };

/** A fresh ref as `mawsd` mints one: 22 base64url characters, or `<prefix>_` and 22 under a delegation. */
export const mintRef = (prefix?: string) => `${prefix === undefined ? '' : `${prefix}_`}${randomBytes(16).toString('base64url')}` as MachineRef;

export function fakeServices(options: { ref?: MachineRef; kind?: 'unit' | 'private'; profileDir?: string } = {}): FakeServices {
  const profileDir = options.profileDir ?? fs.mkdtempSync(join(tmpdir(), 'endpoint-profile-'));
  const stateDir = join(profileDir, 'mawsd', 'endpoint');
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(join(profileDir, 'mawsd'), 0o700);
  fs.chmodSync(stateDir, 0o700);
  const lines: string[] = [];
  const holds = new Set<string>();
  const none = () => () => {};
  return {
    machine: { ref: options.ref ?? mintRef(), profileDir, stateDir, kind: options.kind ?? 'private' },
    dispatch: async (_owner, name) => ({ t: 'res', id: '0', ok: false, error: { code: 'unknown_command', message: `the fake services dispatch nothing (${name})` } }),
    onEvent: none,
    onAttachment: none,
    onFrame: none,
    documents: { open: () => false, close: () => {}, frame: () => false, onClosed: none },
    onUpstream: none,
    hold(reason) {
      const id = `${reason}#${holds.size}`;
      holds.add(id);
      return () => void holds.delete(id);
    },
    interest: { report: () => {}, drop: () => {} },
    log: (line) => void lines.push(line),
    lines,
    holds,
    cleanup: () => fs.rmSync(profileDir, { recursive: true, force: true }),
  };
}
