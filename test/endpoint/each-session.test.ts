// P5 O7 M6 (milestone re-check): an `each-session` read's cut holds the caller to every placement the call saw of a
// session, the narrowing read's (`session.list`) among them. A session that was viewable when `session.list` placed it,
// and whose rights at that placement went before the answer was sent, stays out even if `session.get` places it where
// the caller still holds the grade.
import { describe, expect, it } from 'vitest';
import { Calls } from '../../src/endpoint/calls';
import type { Placement } from '../../src/endpoint/targets';

type Answer = { t: 'result'; id: string; ok: boolean; output?: { hits: unknown[]; incomplete: boolean } };

/** A `session.search` for one session `app`, listed under engine session `old` and got under `new`. */
async function search(oldHeldAfterSearch: boolean): Promise<{ answer: Answer; narrowed: unknown }> {
  let oldHeld = true;
  const ranks = {
    current: () => true,
    holds: (placement: Placement) => placement !== null && (placement.target.session === 'new' || (placement.target.session === 'old' && oldHeld)),
    ownsMachine: () => false,
  };
  let narrowed: unknown;
  const dispatch = async (_owner: string, name: string, input: unknown) => {
    if (name === 'session.list') return { ok: true, value: { sessions: [{ appId: 'app', engineSessionId: 'old' }] } };
    if (name === 'session.search') {
      narrowed = (input as { sessions?: unknown }).sessions;
      oldHeld = oldHeldAfterSearch;
      return { ok: true, value: { hits: [{ appSessionId: 'app', snippet: 'needle' }], indexing: false, incomplete: false } };
    }
    if (name === 'session.get') return { ok: true, value: { appId: 'app', engineSessionId: 'new' } };
    throw new Error(`unexpected ${name}`);
  };
  let finish!: (answer: Answer) => void;
  const answered = new Promise<Answer>((resolve) => (finish = resolve));
  const calls = new Calls({ ranks: async () => ranks, log: () => {}, dispatch } as unknown as ConstructorParameters<typeof Calls>[0]);
  calls.execute({ closed: false, member: 'm', client: {}, capabilities: [], send: finish } as unknown as Parameters<Calls['execute']>[0], { t: 'call', id: 'q', name: 'session.search', input: { query: 'needle' } });
  return { answer: await answered, narrowed };
}

describe('session.search across a placement the narrowing read saw', () => {
  it('leaves out a session whose listed placement the caller lost rights on before the answer', async () => {
    const { answer, narrowed } = await search(false);
    expect(narrowed).toEqual(['app']);
    expect(answer.ok).toBe(true);
    expect(answer.output?.hits).toEqual([]);
  });

  it('answers it when the caller still holds the grade on every placement', async () => {
    const { answer, narrowed } = await search(true);
    expect(narrowed).toEqual(['app']);
    expect(answer.output?.hits).toEqual([{ appSessionId: 'app', snippet: 'needle' }]);
  });
});
