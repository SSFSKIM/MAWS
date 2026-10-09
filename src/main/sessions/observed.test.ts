// P2-A (X17): main's `session.observedFacts` relays the engine host's read and answers null when the host cannot (its
// banner already says the host is down; the facts read "Not observed yet" meanwhile).
import { describe, expect, it } from 'vitest';
import { emptyObservedFacts } from '@shared/engine/observed-facts';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandName, CommandResult } from '@shared/ipc/schema';
import type { HostDispatch } from '../ipc/router';
import { observedFactsOf } from './observed';

const ID = 'app-main-facts' as AppSessionId;

describe('session.observedFacts in main', () => {
  it('relays engine.observedFacts to the engine host and answers what it answered', async () => {
    const answer = { ...emptyObservedFacts(ID, '2026-10-09T10:00:00.000Z', 'journal'), complete: true };
    const calls: unknown[] = [];
    const dispatch: HostDispatch = async (owner, name, input) => {
      calls.push([owner, name, input]);
      return { ok: true, value: answer } as CommandResult<CommandName>;
    };
    expect(await observedFactsOf(dispatch, ID, () => {})).toEqual(answer);
    expect(calls).toEqual([['engine-host', 'engine.observedFacts', { appSessionId: ID }]]);
  });

  it('answers null and logs when the host refuses or cannot be reached', async () => {
    const lines: string[] = [];
    const refused: HostDispatch = async () => ({ ok: false, error: { code: 'host_unavailable', message: 'the engine host is restarting' } }) as CommandResult<CommandName>;
    expect(await observedFactsOf(refused, ID, (line) => lines.push(line))).toBeNull();
    const thrown: HostDispatch = async () => {
      throw new Error('socket closed');
    };
    expect(await observedFactsOf(thrown, ID, (line) => lines.push(line))).toBeNull();
    expect(lines).toEqual([expect.stringContaining('the engine host is restarting'), expect.stringContaining('socket closed')]);
  });
});
