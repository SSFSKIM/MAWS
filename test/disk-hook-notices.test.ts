// Debt wave 7 (C4 · C6): a hook that got in the way survives a reload. The same recorded session read live (C3's
// normaliser over the probe journal) and from disk (C4's chain follower over the engine's transcript, as
// `session.events` answers for a session nobody holds) derives the same rows through C6's transcript model. Disk cannot
// witness the process's exit, nor the text of a prompt whose hook suppressed it (`suppressOriginalPrompt`).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { SessionId } from '@shared/graph/ids';
import { ChainFollower } from '../src/engine-host/fs/chain-follower';
import { journalToEvents } from '../src/renderer/src/transcript/dev/journal';
import { rowsOf } from '../src/renderer/src/transcript/model/derive';
import { applyEvents, createState } from '../src/renderer/src/transcript/model/reduce';
import type { Row } from '../src/renderer/src/transcript/model/rows';
import { loadJournal, TRANSCRIPT_FIXTURE_DIR } from './support/fixtures';
import { MemoryFileReader } from './support/memory-reader';

async function fromDisk(name: string, sessionId: string): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  const follower = new ChainFollower(new MemoryFileReader(readFileSync(join(TRANSCRIPT_FIXTURE_DIR, `${name}.jsonl`))), sessionId as SessionId, null, (e) => e.t === 'events' && events.push(...e.events), { holders: () => 0 });
  await follower.start();
  follower.stop();
  return events;
}

const shape = (events: SessionEvent[]) =>
  rowsOf(applyEvents(createState(null, null), events))
    .filter((row: Row) => row.kind !== 'time')
    .map((row) => (row.kind === 'error' ? `${row.scope}:${row.text}${row.action ? ` [${row.action}]` : ''}` : row.kind === 'assistant_text' ? `${row.phase}:${row.markdown}` : row.kind === 'user' ? `user:${row.text}` : row.kind));

describe('hook notices after a reload', () => {
  it('w1-hooks-blocking reads as pass3/hooks-blocking did live: the re-prompt between the answers, the blocked prompt with Edit prompt', async () => {
    const live = shape(journalToEvents(loadJournal('pass3', 'hooks-blocking')));
    const disk = shape(await fromDisk('w1-hooks-blocking', 'aec38c38-3912-48a6-b713-33c2a9740dd0'));
    expect(disk).toEqual([
      'user:Reply ONE',
      'answer:ONE',
      'hook:Hook re-prompted Claude · Say REPROMPTED and stop',
      'answer:REPROMPTED',
      'user:BLOCKME please reply TWO',
      'hook:A hook blocked your prompt · BLOCKED_BY_TEST_HOOK [edit_prompt]',
    ]);
    expect(live).toEqual([...disk, 'exit:Session process exited (quit)']);
  });

  it('dw7-hooks-flipped reads as pass3/hooks-flipped did live, less the prompt the hook suppressed', async () => {
    const live = shape(journalToEvents(loadJournal('pass3', 'hooks-flipped')));
    const disk = shape(await fromDisk('dw7-hooks-flipped', '91bc7740-2177-4fad-9e13-215678026e10'));
    expect(disk).toEqual([
      'user:Reply ONE',
      'answer:ONE',
      'hook:Hook re-prompted Claude · REPROMPT_BY_EXIT_2',
      'answer:ONE',
      'user:BLOCKME please reply TWO',
      'hook:A hook blocked your prompt · BLOCKED_BY_JSON_HOOK [edit_prompt]',
      'hook:A hook blocked your prompt · QUIET_BLOCK [edit_prompt]', // no bubble, so no Edit prompt button either (rows/Error.tsx)
      'user:Reply FOUR',
      'answer:FOUR',
    ]);
    expect(live.filter((row) => row !== 'user:BLOCKQUIET please reply THREE')).toEqual([...disk, 'exit:Session process exited (quit)']);
  });
});
