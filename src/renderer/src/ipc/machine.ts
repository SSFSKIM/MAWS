// P5 O6 M2 (OX2): the machine a surface is about when it holds a path rather than an id: its session's, else this
// machine's. A file tab carries it (the same path on two machines is two files), and so does an artifact tab, whose
// library stays this machine's until its child spans machines.
import type { AppSessionId } from '@shared/graph/ids';
import { addressOf, isAddress, machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from './client';

export function machineFor(appSessionId: AppSessionId | null): MachineRef {
  return appSessionId === null ? ipc.localMachine : machineOf(appSessionId);
}

// P5 O6 M4 ("Path-keyed stores"): the key of a directory or file on a machine, since the same path on two machines is two
// checkouts. It is the codec's join, as an address is.
export function checkoutKey(machine: MachineRef, path: string): string {
  return addressOf(machine, path);
}

// A session id an artifact's own content holds (an author, an actor, a thread's session), as main wrote it: the bare id
// of the machine that holds the artifact, this one's while the library is local. An address already is one.
export function storedSessionOnPage(appSessionId: string): AppSessionId {
  return (isAddress(appSessionId) ? appSessionId : addressOf(ipc.localMachine, appSessionId)) as AppSessionId;
}
