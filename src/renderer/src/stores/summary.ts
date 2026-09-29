// Which sections of the panel's summary are collapsed (C8a execution document, Interfaces *Layout key
// `summary.sections`*): read once through `layout.get` at first use (an absent or invalid value is everything expanded)
// and written through `layout.set` 250 ms after the last toggle, C5's cadence, and at once when the page unloads.
import { create } from 'zustand';
import type { MawsBridge } from '@shared/ipc/schema';
import { SummarySectionsSchema, type SummarySection } from '@shared/ipc/schema/layout';
import { ipc } from '../ipc/client';

export const SUMMARY_SECTIONS_KEY = 'summary.sections';
export const SUMMARY_WRITE_DELAY_MS = 250;

export interface SummaryStore {
  collapsed: ReadonlySet<SummarySection>;
  loaded: boolean; // the persisted value has been read (or found absent or invalid)
  load(): Promise<void>; // the first call reads; later calls share it
  toggle(section: SummarySection): void;
}

export function createSummaryStore(client: MawsBridge, options: { writeDelayMs?: number } = {}) {
  const delay = options.writeDelayMs ?? SUMMARY_WRITE_DELAY_MS;
  let reading: Promise<void> | null = null;
  let toggled = false; // a toggle before the read answered wins over what it reads
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unloadHooked = false;

  return create<SummaryStore>()((set, get) => {
    const write = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      const value = { version: 1 as const, collapsed: [...get().collapsed] };
      void client.invoke('layout.set', { key: SUMMARY_SECTIONS_KEY, value }).then((result) => {
        if (!result.ok) console.error(`[summary] layout.set ${SUMMARY_SECTIONS_KEY} failed`, result.error);
      });
    };
    const flush = () => {
      if (timer !== null) write();
    };

    return {
      collapsed: new Set(),
      loaded: false,

      load() {
        reading ??= client.invoke('layout.get', { key: SUMMARY_SECTIONS_KEY }).then((result) => {
          if (!result.ok) console.error(`[summary] layout.get ${SUMMARY_SECTIONS_KEY} failed`, result.error);
          const stored = result.ok ? result.value.value : null;
          const parsed = stored === null ? null : SummarySectionsSchema.safeParse(stored);
          if (parsed && !parsed.success) console.warn(`[summary] ${SUMMARY_SECTIONS_KEY} is not a valid value; everything expanded`);
          set({ loaded: true, ...(toggled || !parsed?.success ? {} : { collapsed: new Set(parsed.data.collapsed) }) });
        });
        return reading;
      },

      toggle(section) {
        toggled = true;
        const collapsed = new Set(get().collapsed);
        if (!collapsed.delete(section)) collapsed.add(section);
        set({ collapsed });
        if (!unloadHooked && typeof window !== 'undefined') {
          unloadHooked = true;
          window.addEventListener('beforeunload', flush);
        }
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(write, delay);
      },
    };
  });
}

export const useSummary = createSummaryStore(ipc);
