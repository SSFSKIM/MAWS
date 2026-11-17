// The web plugin's fetch over its recorded session (UX wave U3b, M5; docs/doperpowers/plans/2026-11-15-ux-wave-U3b-
// transcript-rows-find.md, acceptance 12, Engine facts 11; spikes/protocol-probe/findings-uxwave-u3b-webfetch.txt): the
// session that loads the tool with ToolSearch, fetches with a prompt, then fetches again without one, read on the live
// route (the journal through the engine host's normaliser) and on the file route (the chain follower over the file the
// same run wrote). Each fetch is the cell a WebFetch is: in the web group, "Fetched <host>", its URL and its string
// result in the detail.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { SessionId } from '@shared/graph/ids';
import { ChainFollower } from '../../../engine-host/fs/chain-follower';
import { FIXTURE_DIR, loadUxwaveJournal } from '../../../../test/support/fixtures';
import { MemoryFileReader } from '../../../../test/support/memory-reader';
import { recordedWebFetches, WEB_FETCH_JOURNAL } from '../../../../test/support/web-fetch-recorded';
import { journalToEvents } from './dev/journal';
import { rowsOf, withAllExpanded } from './model/derive';
import { applyEvents, createState } from './model/reduce';
import type { Cell } from './model/rows';

const SESSION = '39d21ad6-ad83-46b6-b582-096478ad8a40';

async function fromFile(): Promise<SessionEvent[]> {
  const text = readFileSync(join(FIXTURE_DIR, 'uxwave', `${WEB_FETCH_JOURNAL}.transcript.jsonl`), 'utf8');
  const events: SessionEvent[] = [];
  const follower = new ChainFollower(new MemoryFileReader(text), SESSION as SessionId, null, (e) => e.t === 'events' && events.push(...e.events), { holders: () => 0 });
  await follower.start();
  follower.stop();
  return events;
}

/** Every call the session drew, each turn opened, in order. */
const callsOf = (events: SessionEvent[]): Cell[] =>
  rowsOf(withAllExpanded(applyEvents(createState(null, null), events)))
    .flatMap((row) => (row.kind === 'group' ? row.cells : row.kind === 'cell' ? [row] : []))
    .filter((cell) => cell.toolName !== 'thinking');

describe('the web plugin’s recorded fetches, on the live and the file route', () => {
  it('each draws as a web fetch, and the ToolSearch call that loaded the tool stays a call of its own', async () => {
    const fetches = recordedWebFetches();
    for (const [route, events] of [['live', journalToEvents(loadUxwaveJournal(WEB_FETCH_JOURNAL))], ['file', await fromFile()]] as const) {
      const calls = callsOf(events);
      expect(calls.map((cell) => cell.toolName), route).toEqual(['ToolSearch', 'mcp__web__fetch', 'mcp__web__fetch']);
      expect(calls[0].category, route).toBe('skills');
      for (const [i, call] of fetches.entries()) {
        const cell = calls[i + 1];
        expect(cell.toolUseId, `${route}, ${call.form}`).toBe(call.toolUseId);
        expect(cell.classification, `${route}, ${call.form}`).toMatchObject({ category: 'web', groupable: true });
        expect(cell.category, `${route}, ${call.form}`).toBe('web');
        expect(cell.status, `${route}, ${call.form}`).toBe('done');
        expect(cell.label, `${route}, ${call.form}`).toBe('Fetched example.com');
        expect(cell.detail, `${route}, ${call.form}`).toEqual({ kind: 'web', url: 'https://example.com', query: null, output: call.result, truncated: null });
      }
    }
  });
});
