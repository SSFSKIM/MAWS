// The three lines the O-39 sitting reads (the UX wave, U9, M5, "The three lines share one prefix"; A15;
// docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md): how long a remote history read, a remote tab's open
// and New chat's project chooser take, through the adapter's `log` into `<profile>/logs/main.log`, each found by one
// search for `lane B: timing`. Session ids are ids; no title and no path is logged. A history read also says its start
// (`asked`), which A5's scene reads (test/support/remote-wake.ts): a read B answers from its ring or from disk leaves
// no journal line there, and one still in flight has no end line yet.

export const TIMING = 'lane B: timing';

/** Which of remote-history.ts's reads answered: one call, the launch in pages, a budgeted transcript window, a budgeted launch. */
export type HistoryPath = 'whole' | 'paged' | 'budgeted window' | 'budgeted launch';

/** A remote history read's start, said before its first page goes out, so a read in flight is in the log too. */
export const historyAskedLine = (machine: string, app: string): string => `${TIMING} history ${machine}/${app}: asked`;
export const historyLine = (machine: string, app: string, path: HistoryPath, pages: number, bytes: number, ms: number): string =>
  `${TIMING} history ${machine}/${app}: ${path}, ${pages} pages, ${bytes} bytes, ${ms} ms`;

/** A remote tab's open, from the moment the tab's interest opened the session: each mark once, the line once its first rows came. */
export interface OpenTiming {
  up(): void;
  record(): void;
  asked(): void;
  rows(): void;
}

export function openTiming(machine: string, app: string, linkUp: boolean, now: () => number, log: (line: string) => void): OpenTiming {
  const from = now();
  const marks: { up?: number; record?: number; asked?: number } = linkUp ? { up: 0 } : {};
  let said = false;
  const mark = (key: keyof typeof marks) => (marks[key] ??= now() - from);
  const at = (ms: number | undefined) => (ms === undefined ? '?' : `+${ms}`);
  return {
    up: () => void mark('up'),
    record: () => void mark('record'),
    asked: () => void mark('asked'),
    rows() {
      if (said || marks.asked === undefined) return;
      said = true;
      log(`${TIMING} open ${machine}/${app}: link up ${at(marks.up)}, record ${at(marks.record)}, history asked ${at(marks.asked)}, first rows +${now() - from}`);
    },
  };
}

/** The chooser's two reads of one machine (sessions/remote-setup.ts's `useRemotePlaces` makes them together). */
export type ChooserRead = 'session.projects.list' | 'machine.folders.list';
/** Two reads of a machine started this close together are one opening of the chooser. */
export const CHOOSER_PAIR_MS = 250;

/** Pairs the chooser's reads by machine and start, and says the line once both of a pair answered; a read with no partner says nothing. */
export function chooserTimings(log: (line: string) => void): (machine: string, read: ChooserRead, startedAt: number, answeredAt: number) => void {
  const open = new Map<string, { startedAt: number; ms: Partial<Record<ChooserRead, number>> }>();
  return (machine, read, startedAt, answeredAt) => {
    const held = open.get(machine);
    if (held === undefined || held.ms[read] !== undefined || Math.abs(held.startedAt - startedAt) > CHOOSER_PAIR_MS) {
      open.set(machine, { startedAt, ms: { [read]: answeredAt - startedAt } });
      return;
    }
    open.delete(machine);
    const ms = { ...held.ms, [read]: answeredAt - startedAt };
    log(`${TIMING} chooser ${machine}: session.projects.list ${ms['session.projects.list']} ms, machine.folders.list ${ms['machine.folders.list']} ms`);
  };
}
