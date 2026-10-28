// A chat exists before its first engine launch: its persisted intent owns panel tabs until a record takes over.
import type { AppSessionId } from '@shared/graph/ids';
import { onEmitted } from '../ipc/events';
import type { MachineRef } from '@shared/machine/ref';
import { PANEL_DROP_DELAY_MS, panelKeysOf, registerLayoutHandlers, type LayoutStore } from '../layout/store';
import type { IntentStore } from './intents';
import type { SessionReadModel } from './read-model';

// P5 O6 M2: `local` is this main's machine, whose sessions' panel keys are `panel.<local>/<id>` (../layout/store.ts).
export function registerChatPanels(store: LayoutStore, model: Pick<SessionReadModel, 'record' | 'on'>, intents: Pick<IntentStore, 'get'>, local: MachineRef): () => void {
  const known = (id: AppSessionId) => model.record(id) !== null || intents.get(id) !== null;
  registerLayoutHandlers(store, known, local);
  const timers = new Map<AppSessionId, ReturnType<typeof setTimeout>>();
  const removed = (id: AppSessionId) => {
    if (timers.has(id)) return;
    timers.set(id, setTimeout(() => {
      timers.delete(id);
      if (known(id)) return;
      for (const key of panelKeysOf(local, id)) {
        try {
          store.delete(key);
        } catch (error) {
          console.error(`[layout] cannot drop ${key}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }, PANEL_DROP_DELAY_MS));
  };
  // The delay lets record/intent handoffs and the renderer's coalesced removals settle before deleting anything.
  const offRecord = model.on('record', (id, record) => { if (record === null) removed(id); });
  const offIntent = onEmitted('session.intent.changed', ({ appSessionId, intent }) => { if (intent === null) removed(appSessionId); });
  return () => {
    offRecord();
    offIntent();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  };
}
