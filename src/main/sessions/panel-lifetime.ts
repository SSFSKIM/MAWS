// A chat exists before its first engine launch: its persisted intent owns panel tabs until a record takes over. P5 O3-C
// (reader R4): whether main knows a session, and its removal, are read through the spine's view alone (`known`, and its
// `record` and `intent` events).
import type { AppSessionId } from '@shared/graph/ids';
import type { MachineRef } from '@shared/machine/ref';
import type { SpineView } from '@shared/spine/view';
import { PANEL_DROP_DELAY_MS, panelKeysOf, registerLayoutHandlers, type LayoutStore } from '../layout/store';

// P5 O6 M2: `local` is this main's machine, whose sessions' panel keys are `panel.<local>/<id>` (../layout/store.ts).
export function registerChatPanels(store: LayoutStore, view: Pick<SpineView, 'known' | 'on'>, local: MachineRef): () => void {
  const known = (id: AppSessionId) => view.known(id);
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
  const offRecord = view.on('record', (id, record) => { if (record === null) removed(id); });
  const offIntent = view.on('intent', (id, intent) => { if (intent === null) removed(id); });
  return () => {
    offRecord();
    offIntent();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  };
}
