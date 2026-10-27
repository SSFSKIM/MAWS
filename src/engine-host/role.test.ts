// P5 O2 M2: the machine role the idle release keys its idle time on (role.ts).
import { describe, expect, it } from 'vitest';
import { machineRole, type RoleProbes } from './role';

const LAPTOP_PMSET = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=24117347)\t100%; charged; 0:00 remaining present: true\n";
const MINI_PMSET = "Now drawing from 'AC Power'\n";

const probes = (over: Partial<RoleProbes> = {}): RoleProbes => ({ pmset: () => MINI_PMSET, powerSupplyTypes: () => [], ...over });

describe('the machine role', () => {
  it('is MAWS_MACHINE_ROLE when it names one, on any machine', () => {
    expect(machineRole({ MAWS_MACHINE_ROLE: 'server' }, 'darwin', probes({ pmset: () => LAPTOP_PMSET }))).toBe('server');
    expect(machineRole({ MAWS_MACHINE_ROLE: 'laptop' }, 'linux', probes())).toBe('laptop');
  });

  it('ignores a value that names no role, and reads the machine instead', () => {
    expect(machineRole({ MAWS_MACHINE_ROLE: 'desktop' }, 'darwin', probes({ pmset: () => LAPTOP_PMSET }))).toBe('laptop');
  });

  it('on macOS: a laptop when pmset lists an InternalBattery, else a server (the mini)', () => {
    expect(machineRole({}, 'darwin', probes({ pmset: () => LAPTOP_PMSET }))).toBe('laptop');
    expect(machineRole({}, 'darwin', probes({ pmset: () => MINI_PMSET }))).toBe('server');
    expect(machineRole({}, 'darwin', probes({ pmset: () => null }))).toBe('server'); // pmset did not answer: no battery seen
  });

  it('on Linux: a laptop when a power supply reads Battery, else a server (a VM)', () => {
    expect(machineRole({}, 'linux', probes({ powerSupplyTypes: () => ['Mains', 'Battery'] }))).toBe('laptop');
    expect(machineRole({}, 'linux', probes({ powerSupplyTypes: () => ['Mains'] }))).toBe('server');
    expect(machineRole({}, 'linux', probes({ powerSupplyTypes: () => [] }))).toBe('server');
  });
});
