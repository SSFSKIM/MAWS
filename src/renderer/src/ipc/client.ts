// The renderer's side of X2 validation: every command output and every event payload is checked on receipt, so
// nothing malformed reaches a caller or a listener. Invalid outputs come back as `invalid_output`; invalid events are
// dropped with a `console.error` naming the event and the issues. Components and stores use `ipc`, never
// `window.maws` directly.
import { CommandResultEnvelopeSchema, ipcError } from '@shared/ipc/errors';
import type { MawsBridge } from '@shared/ipc/schema';
import { validateCommandOutput, validateEventPayload } from '@shared/ipc/validate';
import * as z from 'zod';

// `bridge` is read on every call, so a client can be created before the preload's bridge is reachable (tests).
export function createClient(bridge: () => MawsBridge): MawsBridge {
  return {
    async invoke(name, input) {
      const envelope = CommandResultEnvelopeSchema.safeParse(await bridge().invoke(name, input));
      if (!envelope.success) {
        const message = `malformed result for ${name}: ${z.prettifyError(envelope.error)}`;
        return { ok: false, error: ipcError('invalid_output', message, envelope.error.issues) };
      }
      if (!envelope.data.ok) return envelope.data;
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
