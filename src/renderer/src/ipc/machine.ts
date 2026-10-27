// P5 O6 M2 (OX2): the machine a surface is about when it holds a path rather than an id: its session's, else this
// machine's. A file tab carries it (the same path on two machines is two files), and so does an artifact tab, whose
// library stays this machine's until its child spans machines.
import type { AppSessionId } from '@shared/graph/ids';
import { machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from './client';

export function machineFor(appSessionId: AppSessionId | null): MachineRef {
  return appSessionId === null ? ipc.localMachine : machineOf(appSessionId);
}
