// Send right after a pick (board ticket 854; the tool-choice branch review's first finding): a chip's pick is written to
// the intent with `session.intent.patch`, and the first Send's `session.start` reads the intent the spine holds then. The
// spine refuses an intent write once a start of the id is under way, and a write that reached it just before the start
// can still be waiting behind an earlier one. So a start sent while writes are unanswered launches without them, and a
// session's tool set cannot be repaired after its start. Send waits for every write made before it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PreloadBridge } from '@shared/ipc/schema';
import { FULL_MAWS_TOOL_SET, withArtifacts, type MawsToolSet } from '@shared/maws/tool-set';
import type { SetupIntent, SetupIntentPatch } from '@shared/sessions/intent';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { at, TEST_MACHINE } from '../../../../test/support/machine';
import { preloadOf } from '../test-support/preload-of';
import { ID, intent, MESSAGE, putIntent, resetSetupStore } from '../test-support/setup-intents';
import { patchIntent, startIntent } from './setup-actions';
import { resetSpawnedHere } from './spawned-here';
import { isStarting, useSetup } from './store';

const A = at(ID);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settled = async () => {
  for (let i = 0; i < 10; i++) await tick();
};

// The spine's side as `SessionService` behaves (src/services/sessions/service.ts): intent writes of one id run one
// after another, each taking a moment to store, and each refused `starting` when a start of the id is marked by the time
// its turn comes; a start marks the id at once and launches with the intent as it stands, so the set it reads is the
// one the launch's spawn row records.
function fakeSpine(initial: SetupIntent) {
  let stored = initial;
  let starting = false;
  let chain: Promise<unknown> = Promise.resolve();
  const launched: (MawsToolSet | undefined)[] = [];
  const refusal = { ok: false, error: { code: 'internal', message: `starting: a start is in flight for ${ID}` } };
  const client = {
    localMachine: TEST_MACHINE,
    on: () => () => {},
    invoke(name: string, input: { patch?: SetupIntentPatch }) {
      if (name === 'session.intent.patch') {
        if (starting) return Promise.resolve(refusal);
        const turn = chain.then(async () => {
          await tick(); // the intent's file is written
          if (starting) return refusal;
          stored = { ...stored, ...input.patch };
          return { ok: true, value: stored };
        });
        chain = turn;
        return turn;
      }
      if (name === 'session.start') {
        starting = true;
        launched.push(stored.mawsTools);
        return Promise.resolve({ ok: true, value: { status: 'starting', appSessionId: ID } });
      }
      return Promise.resolve({ ok: true, value: null });
    },
  };
  return { bridge: preloadOf({ client } as unknown as Pick<FakeClient, 'client'>), launched };
}

beforeEach(() => resetSetupStore());
afterEach(() => {
  resetSpawnedHere();
  delete (window as { maws?: PreloadBridge }).maws;
});

describe('Send right after a pick', () => {
  it('launches with the newest of two quick Tools picks, both writes still unanswered at the press', async () => {
    putIntent(intent({ appSessionId: A }));
    const spine = fakeSpine(intent()); // main's intent names the bare id
    window.maws = spine.bridge;
    const first = withArtifacts(FULL_MAWS_TOOL_SET, false);
    const second: MawsToolSet = { ...first, question: 'engine' };
    // the submenu's two choices, each carrying all before it, then Send before either is answered
    const writes = [patchIntent(A, { mawsTools: first }), patchIntent(A, { mawsTools: second })];
    const sent = startIntent(A, MESSAGE);
    await expect(Promise.all(writes)).resolves.toEqual([{ ok: true }, { ok: true }]);
    await expect(sent).resolves.toEqual({ ok: true });
    expect(spine.launched).toEqual([second]);
  });

  it('starts only once a write in flight is answered, even refused, and shows the start meanwhile', async () => {
    const fake = fakeClient();
    window.maws = preloadOf(fake);
    putIntent(intent({ appSessionId: A }));
    const writing = patchIntent(A, { model: 'haiku' });
    const sent = startIntent(A, MESSAGE);
    await settled();
    expect(fake.invoked('session.start'), 'Send waits for the write').toEqual([]);
    expect(isStarting(useSetup.getState(), A), 'the frame is held while it waits, so no pick is made after the press').toBe(true);
    await fake.fail('session.intent.patch', 'the intent is busy');
    await expect(writing).resolves.toEqual({ ok: false, error: 'the intent is busy' });
    await settled();
    expect(fake.invoked('session.start')).toEqual([{ appSessionId: ID, message: MESSAGE, options: {} }]);
    await fake.reply('session.start', { status: 'starting', appSessionId: ID });
    await expect(sent).resolves.toEqual({ ok: true });
  });
});
