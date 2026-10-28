// The People toggle's set (P5 O8 M5, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, "The People toggle"; Q3):
// the sidebar rows (org projects' and machines' row keys) that draw other people's sessions, off by default and
// remembered per row. Read once through `layout.get` at first use (an absent or invalid value is every toggle off) and
// written through `layout.set` 250 ms after the last toggle and at once when the page unloads, as `stores/summary.ts`
// keeps `summary.sections`. A toggle before the read answered is applied over what it reads, and nothing is written
// until it has, so an early toggle never replaces the stored set with itself alone.
import { create } from 'zustand';
import type { MawsBridge } from '@shared/ipc/schema';
import { SidebarPeopleSchema } from '@shared/ipc/schema/layout';
import { ipc } from '../ipc/client';
import type { RowKey } from './org-projects';

export const PEOPLE_KEY = 'sidebar.people';
export const PEOPLE_WRITE_DELAY_MS = 250;

export interface PeopleStore {
  on: ReadonlySet<RowKey>;
  load(): Promise<void>; // the first call reads; later calls share it
  toggle(key: RowKey): void;
}

const flipped = (set: ReadonlySet<RowKey>, key: RowKey): Set<RowKey> => {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
};

export function createPeopleStore(client: MawsBridge, options: { writeDelayMs?: number } = {}) {
  const delay = options.writeDelayMs ?? PEOPLE_WRITE_DELAY_MS;
  let reading: Promise<void> | null = null;
  let loaded = false;
  const early: RowKey[] = []; // toggles before the read answered, replayed over what it reads
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unloadHooked = false;

  return create<PeopleStore>()((set, get) => {
    const write = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      const value = { version: 1 as const, on: [...get().on] };
      void client.invoke('layout.set', { key: PEOPLE_KEY, value }).then((result) => {
        if (!result.ok) console.error(`[people] layout.set ${PEOPLE_KEY} failed`, result.error);
      });
    };
    const schedule = () => {
      if (!unloadHooked && typeof window !== 'undefined') {
        unloadHooked = true;
        window.addEventListener('beforeunload', () => timer !== null && write());
      }
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(write, delay);
    };

    return {
      on: new Set(),

      load() {
        reading ??= client.invoke('layout.get', { key: PEOPLE_KEY }).then((result) => {
          if (!result.ok) console.error(`[people] layout.get ${PEOPLE_KEY} failed`, result.error);
          const stored = result.ok ? result.value.value : null;
          const parsed = stored === null ? null : SidebarPeopleSchema.safeParse(stored);
          if (parsed && !parsed.success) console.warn(`[people] ${PEOPLE_KEY} is not a valid value; every toggle off`);
          let on: ReadonlySet<RowKey> = new Set(parsed?.success ? (parsed.data.on as RowKey[]) : []);
          for (const key of early) on = flipped(on, key);
          loaded = true;
          set({ on });
          if (early.length > 0) schedule();
        });
        return reading;
      },

      toggle(key) {
        set({ on: flipped(get().on, key) });
        if (loaded) return schedule();
        early.push(key);
        void get().load();
      },
    };
  });
}

export const usePeople = createPeopleStore(ipc);
