// A command the store or main refused (moved out of host.ts by P3-H H4, so the connector family beside it shares it;
// host.ts re-exports it). `error` is the IpcError (its `issues` an ArtifactRefusal when the store named why).
import type { IpcError } from '@shared/ipc/schema';

export class ArtifactCommandError extends Error {
  constructor(readonly error: IpcError) {
    super(error.message);
    this.name = 'ArtifactCommandError';
  }
}
