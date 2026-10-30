// `machine.identity`'s enrollment (P5 O3-D M2's follow-up, D38; O10 M9's last piece): the endpoint's in-process enrollment,
// `{ name, org }`, injected as a source, is sminos's `{ org, machine }`; with no source, or none held, there is none.
import { describe, expect, it } from 'vitest';
import { machineEnrollment, machineProject } from './identity';
import { machineProjectId } from './project-ids';
import type { MachineRef } from './ref';

const REF = 'r'.repeat(22) as MachineRef;

describe('machineEnrollment', () => {
  it('is none with no source (main) and while the source holds none', () => {
    expect(machineEnrollment()).toBeNull();
    expect(machineEnrollment(() => null)).toBeNull();
  });

  it('names the machine as the endpoint’s enrollment does, and its project is sminos’s machine project', () => {
    const enrollment = machineEnrollment(() => ({ name: 'mini', org: 'org-local' }));
    expect(enrollment).toEqual({ org: 'org-local', machine: 'mini' });
    expect(machineProject(REF, 'studio', enrollment).smnsId).toBe(machineProjectId('org-local', 'mini'));
    expect(machineProject(REF, 'studio', machineEnrollment()).smnsId).toBeNull();
  });
});
