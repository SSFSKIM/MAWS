// The machine a terminal runs on (P5 O7 M3): its session's, as the session's address names it. A bare id (a fixture
// outside the page's addresses) is this machine's.
import type { AppSessionId } from '@shared/graph/ids';
import { isAddress, machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';

export const terminalMachine = (appSessionId: AppSessionId, local: MachineRef): MachineRef => (isAddress(appSessionId) ? machineOf(appSessionId) : local);
