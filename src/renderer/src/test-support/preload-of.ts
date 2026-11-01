// A shared fake client (test/support/fake-client.ts) installed as `window.maws`, main's side of the bridge (P5 O6 M4). The
// fake speaks the `MawsBridge` shape: its listeners hear `(payload, { machine })` and its invoke takes `{ machine }`. The
// preload bridge speaks the raw pipe: a listener hears `(payload, machine)` and invoke takes the machine itself. A test
// that puts the fake under the renderer's real client (`ipc`) installs it through this adapter.
import type { PreloadBridge } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import type { FakeClient } from '../../../../test/support/fake-client';

type Loose = {
  invoke(name: string, input: unknown, opts?: { machine: MachineRef; session?: string }): Promise<unknown>;
  on(name: string, listener: (payload: unknown, from: { machine: MachineRef }) => void): () => void;
};

export function preloadOf(fake: Pick<FakeClient, 'client'>): PreloadBridge {
  const client = fake.client as unknown as Loose & Pick<PreloadBridge, 'localMachine' | 'pathForFile'>;
  return {
    localMachine: client.localMachine,
    // P5 O7 M4: the target is the machine, or the machine with the session the command is made from
    invoke: (name: string, input: unknown, target?: MachineRef | { machine: MachineRef; session?: string }) => client.invoke(name, input, target === undefined ? undefined : typeof target === 'string' ? { machine: target } : target),
    on: (name: string, listener: (payload: unknown, machine: MachineRef | undefined) => void) => client.on(name, (payload, from) => listener(payload, from.machine)),
    pathForFile: (file: File) => client.pathForFile(file),
  } as unknown as PreloadBridge;
}
