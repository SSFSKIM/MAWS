// The renderer's side of X2 validation: every command output and every event payload is checked on receipt, so
// nothing malformed reaches a caller or a listener. Invalid outputs come back as `invalid_output`; invalid events are
// dropped with a `console.error` naming the event and the issues. Components and stores use `ipc`, never
// `window.maws` directly.
import { CommandResultEnvelopeSchema, ipcError } from '@shared/ipc/errors';
import type { CommandName, IpcError, MawsBridge } from '@shared/ipc/schema';
import { validateCommandOutput, validateEventPayload } from '@shared/ipc/validate';
import * as z from 'zod';

// E10: main's own refusals, heard app-wide by what must react to one wherever it was asked (a launch refused while an
// incompatible supervisor is waited for shows its banner again, `app/supervisor-notices.ts`).
type RefusalListener = (name: CommandName, error: IpcError) => void;
const refusalListeners = new Set<RefusalListener>();
export function onCommandRefused(listener: RefusalListener): () => void {
  refusalListeners.add(listener);
  return () => void refusalListeners.delete(listener);
}

// `bridge` is read on every call, so a client can be created before the preload's bridge is reachable (tests).
export function createClient(bridge: () => MawsBridge): MawsBridge {
  return {
    async invoke(name, input) {
      const envelope = CommandResultEnvelopeSchema.safeParse(await bridge().invoke(name, input));
      if (!envelope.success) {
        const message = `malformed result for ${name}: ${z.prettifyError(envelope.error)}`;
        return { ok: false, error: ipcError('invalid_output', message, envelope.error.issues) };
      }
      if (!envelope.data.ok) {
        // A listener's fault is its own: the caller still gets the refusal, and the other listeners still hear it.
        for (const listener of refusalListeners) {
          try {
            listener(name, envelope.data.error);
          } catch (error) {
            console.error(`[ipc] a refusal listener failed on ${name}`, error);
          }
        }
        return envelope.data;
      }
      return validateCommandOutput(name, envelope.data.value);
    },
    on(name, listener) {
      return bridge().on(name, (payload) => {
        const checked = validateEventPayload(name, payload);
        if (!checked.ok) {
          console.error(`[ipc] dropped invalid ${name} event`, checked.issues);
          return;
        }
        listener(checked.value);
      });
    },
    pathForFile: (file) => bridge().pathForFile(file), // C7: no IPC; the preload asks Electron
  };
}

export const ipc: MawsBridge = createClient(() => window.maws);
