// "Compacting session…" over the recorded sessions (UX wave U3b, M4; docs/doperpowers/plans/2026-11-15-ux-wave-U3b-
// transcript-rows-find.md, acceptance 10, Engine facts 1 to 5 and 9). Each recording is played row by row as the engine
// host plays it: the frames the engine sent go through the host's status tracker into the session's status in the
// sessions store, and every row through the host's normaliser into the transcript, which a mounted transcript draws with
// the time the compacting store gives it. The window's clock is stepped by hand.
import { act, cleanup, render, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { EngineSessionStatus } from '@shared/engine/status';
import { LaunchSpecSchema } from '@shared/engine/launch-spec';
import type { JournalRow } from '@shared/wire/journal';
import { Normalizer } from '../../../engine-host/normalizer';
import { SessionStatusTracker } from '../../../engine-host/session-status';
import { status } from '../../../../test/support/builders';
import { loadUxwaveJournal } from '../../../../test/support/fixtures';
import { at, TEST_MACHINE } from '../../../../test/support/machine';
import { connectCompacting, useCompacting, useCompactingSince } from '../stores/compacting';
import { useSessions } from '../stores/sessions';
import { useTranscriptStore } from '../stores/transcript';
import type { TranscriptSource } from './source/types';
import { Transcript } from './view/Transcript';

// happy-dom has no layout: give the scroller a viewport and every row a height so the virtualiser mounts rows.
const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
let disconnect: () => void = () => {};
let plays = 0;
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-transcript-scroller') ? 4000 : this.hasAttribute('data-index') ? 40 : 0;
    },
  });
  useCompacting.setState({ held: new Map() });
  useSessions.setState({ engine: new Map() });
  disconnect = connectCompacting();
});
afterEach(() => {
  cleanup();
  disconnect();
  vi.useRealTimers();
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight);
});

const T0 = Date.parse('2026-11-15T10:00:00.000Z');
const spec = (appSessionId: AppSessionId) => LaunchSpecSchema.parse({
  appSessionId, cwd: '/tmp/r', additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'gateway', subagentModel: null,
  resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, inheritGrantsFrom: null, replay: null,
});

function Pane({ source, id }: { source: TranscriptSource; id: AppSessionId }) {
  return <Transcript source={source} variant="session" compacting={useCompactingSince(id)} />;
}

/** Mounts the session with the recording's rows before `from` already played, then hands back a step that plays the
 *  rows up to a seq, the clock, and what is drawn. `drawnFrom`: the first row the transcript is given of those played
 *  before (the automatic compaction's recording opens with a million tokens of filler the window need not draw). */
async function play(name: string, from: number, drawnFrom = 0) {
  const id = at(`app-compacting-recorded-${++plays}`) as AppSessionId;
  const journal = loadUxwaveJournal(name);
  const normalizer = new Normalizer({ appSessionId: id, launchId: 'journal', sessionId: null });
  const tracker = new SessionStatusTracker(spec(id), () => {});
  let process: EngineSessionStatus['process'] = 'ready';
  const setStatus = () => useSessions.getState().applyStatus({ appSessionId: id, status: { ...status(id), process, activity: tracker.snapshot().activity } }, TEST_MACHINE);
  const host = (rows: JournalRow[]): SessionEvent[] => {
    const events = rows.flatMap((row) => {
      if (row.direction === 'in') tracker.observe(row.frame as Record<string, unknown>, row.at);
      return normalizer.push(row);
    });
    setStatus();
    return events;
  };
  const before = journal.filter((row) => row.seq < from);
  host(before.filter((row) => row.seq < drawnFrom));
  const history = host(before.filter((row) => row.seq >= drawnFrom));
  let push: (batch: SessionEvent[]) => void = () => {};
  const source: TranscriptSource = { key: id, subscribe: (listener) => ((push = listener), () => {}), snapshot: () => Promise.resolve(history) };
  render(<Pane source={source} id={id} />);
  await waitFor(() => expect(useTranscriptStore.getState().entries[id]?.phase).toBe('live'));
  // the row's clock and the store's are the window's, stepped by hand from here
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(T0);
  let played = from - 1;
  const rows = () => [...document.querySelectorAll<HTMLElement>('[data-row-id]')];
  return {
    id,
    /** Plays every row up to and including `seq`, one row at a time. */
    to(seq: number) {
      for (const row of journal.filter((candidate) => candidate.seq > played && candidate.seq <= seq)) {
        act(() => {
          const events = host([row]);
          if (events.length > 0) push(events);
        });
      }
      played = seq;
    },
    /** The window's clock moves on. */
    wait: (ms: number) => act(() => void vi.advanceTimersByTime(ms)),
    exits() {
      process = 'exited';
      act(setStatus);
    },
    last: () => rows().at(-1)!,
    compaction: () => document.querySelector<HTMLElement>('[data-row-id="activity:compacting"]'),
    line: () => within(document.querySelector<HTMLElement>('[data-row-id="activity:compacting"]')!).getByRole('status').textContent,
    /** The drawn text of each mounted row of a kind (its frame carries the kind), in the list's order. */
    texts: (kind: string) => [...document.querySelectorAll<HTMLElement>(`[data-row-id] > [data-kind="${kind}"]`)].map((row) => row.textContent),
  };
}

describe('a compaction in a session MAWS runs, from the recordings', () => {
  it('a typed /compact: the last row from its `compacting` status, its time a second on, gone at the next status (u3-commands-r1, 150 and 151)', async () => {
    const s = await play('u3-commands-r1', 145);
    s.to(149);
    expect(s.compaction()).toBeNull();
    s.to(150);
    expect(s.last()).toBe(s.compaction());
    expect(s.line()).toBe('Compacting session…');
    s.wait(1_000);
    expect(s.line()).toBe('Compacting session… 1s');
    s.to(151);
    expect(s.compaction()).toBeNull();
    s.to(159);
    expect(s.compaction()).toBeNull();
    expect(s.texts('local_command').at(-1)).toContain('Compacted');
  });

  it('the engine’s repeat every thirty seconds leaves the clock running from the first (u3-commands-r2, 333 to 337)', async () => {
    const s = await play('u3-commands-r2', 330);
    s.to(333);
    for (const seq of [334, 335, 336]) {
      s.wait(30_000);
      s.to(seq);
    }
    expect(s.line()).toBe('Compacting session… 1m 30s');
    s.to(337);
    expect(s.compaction()).toBeNull();
  });

  it('an interrupted one leaves no row, and “Compaction canceled.” is its command’s output (u3-commands-r1, 400 to 411)', async () => {
    const s = await play('u3-commands-r1', 396);
    s.to(400);
    expect(s.compaction()).not.toBeNull();
    s.to(404);
    expect(s.compaction()).toBeNull();
    s.to(411);
    expect(s.compaction()).toBeNull();
    expect(s.texts('local_command').filter((text) => text?.includes('Compaction canceled.'))).toHaveLength(1);
  });

  it('a /compact with nothing to compact never shows it (u3-commands-r1, 19 to 31)', async () => {
    const s = await play('u3-commands-r1', 18);
    for (let seq = 19; seq <= 31; seq++) {
      s.to(seq);
      expect(s.compaction(), `seq ${seq}`).toBeNull();
    }
  });

  it('an automatic one shows it inside the running turn, whose own line still reads “Working”, from 97 to 98 (u3b-autocompact-r2)', async () => {
    const s = await play('u3b-autocompact-r2', 91, 91);
    s.to(96); // the prompt's `requesting`
    expect(s.compaction()).toBeNull();
    s.to(97);
    expect(s.last()).toBe(s.compaction());
    expect(s.line()).toBe('Compacting session…');
    expect(s.texts('divider')).toContainEqual(expect.stringMatching(/^Working/)); // the running turn's line, unchanged
    s.to(98);
    expect(s.compaction()).toBeNull();
    s.to(110);
    expect(s.compaction()).toBeNull();
  });

  it('a process that exits while compacting removes it', async () => {
    const s = await play('u3-commands-r1', 145);
    s.to(150);
    expect(s.compaction()).not.toBeNull();
    s.exits();
    expect(s.compaction()).toBeNull();
  });
});
