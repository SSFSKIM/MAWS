// The unit suites' local machine (P5 O6 M2, docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md; OX2): the page
// holds addresses (`<machine>/<id>`), so a renderer test's store fixtures and expectations hold `at(id)` while a fake
// `window.maws`, standing for main, answers and is asked with the bare ids. Every happy-dom suite starts with a
// `window.maws` carrying this machine (./renderer-machine-setup.ts), so the ids the page mints at module load are built
// against it; a fake bridge a test installs carries it too (`localMachine: TEST_MACHINE`).
import { addressOf } from '../../src/shared/machine/address';
import type { MachineRef } from '../../src/shared/machine/ref';

export const TEST_MACHINE = 'TestMachineRef00000000' as MachineRef;
export const OTHER_MACHINE = 'OtherMachineRef0000000' as MachineRef;

// The local machine's address of a bare id, typed as the id.
export const at = <T extends string>(id: T): T => addressOf(TEST_MACHINE, id);
