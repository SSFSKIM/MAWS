// The deliverable store's side of main (E2 execution document, Design §1 to §3, §7, §8), wired from `src/main/index.ts`
// in two steps: the scheme registered before the app is ready, and the rest once it is. Main owns the reads: one reader
// over the files the engine host writes serves `deliverables.*`, the `maws-deliverable:` scheme (on the window's default
// session and on the capture partition, each with the frame policies), the capture service and the files service's
// admission of delivered paths. The window's own guards (`guardFrames`, `attributeConsole`) are attached in `window.ts`.
import { session } from 'electron';
import type { MawsArtifactCapture } from '@shared/ipc/schema/maws';
import type { HostSupervisor } from '../hosts/supervisor';
import type { registerMainHandler } from '../ipc/router';
import { CAPTURE_PARTITION, captureArtifact, startCaptureService } from './capture';
import { installFramePolicies } from './policies';
import { serveDeliverables } from './protocol';
import { DeliverableReader } from './reader';
import { registerDeliverablesHandlers } from './register';

export { registerDeliverableScheme } from './protocol';

export interface DeliverablesDeps {
  userData: string;
  hosts: Pick<HostSupervisor, 'onEvent' | 'dispatch'>;
  register: typeof registerMainHandler;
  env: NodeJS.ProcessEnv;
}

export interface Deliverables {
  reader: DeliverableReader;
  stop(): void;
}

export function startDeliverables({ userData, hosts, register, env }: DeliverablesDeps): Deliverables {
  const reader = new DeliverableReader(userData);
  for (const target of [session.defaultSession, session.fromPartition(CAPTURE_PARTITION)]) {
    serveDeliverables(target, reader);
    installFramePolicies(target, env);
  }
  registerDeliverablesHandlers(reader, register);
  const stopCaptures = startCaptureService({
    onEvent: (name, listener) => hosts.onEvent(name, listener),
    dispatch: (input) => hosts.dispatch('engine-host', 'maws.artifact.captured', input),
    reader,
    env,
  });
  // The e2e's seam (no IPC command exists for it): a capture run directly in main through `app.evaluate`.
  const seam = globalThis as { __maws_deliverables?: { capture(request: MawsArtifactCapture): ReturnType<typeof captureArtifact> } };
  if (env.MAWS_E2E === '1') seam.__maws_deliverables = { capture: (request) => captureArtifact(request, { reader, env }) };
  return {
    reader,
    stop: () => {
      stopCaptures();
      delete seam.__maws_deliverables;
    },
  };
}
