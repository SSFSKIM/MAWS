import { describe, expect, it } from 'vitest';
import { fakeClient } from '../../../../test/support/fake-client';
import { OTHER_MACHINE } from '../../../../test/support/machine';
import { hostStatus } from '../test-support/host-status';
import { askUntilAnswered } from './until-answered';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// An ask the test answers: each call is a promise the test settles, oldest first.
function asks() {
  const out: { resolve(answered: boolean): void; reject(error: unknown): void }[] = [];
  const ask = () => new Promise<boolean>((resolve, reject) => out.push({ resolve, reject }));
  const answer = async (answered: boolean | Error) => {
    const next = out.shift()!;
    if (answered instanceof Error) next.reject(answered);
    else next.resolve(answered);
    await settle();
  };
  return { ask, answer, calls: () => out.length };
}

describe('askUntilAnswered', () => {
  it('asks again when the local machine’s host is heard after a failure, not another machine’s, and stops once answered', async () => {
    const fake = fakeClient();
    const { ask, answer, calls } = asks();
    askUntilAnswered(fake.client, ask);
    await answer(false);
    fake.event('host.status', hostStatus(), OTHER_MACHINE);
    expect(calls()).toBe(0);
    fake.event('host.status', hostStatus());
    expect(calls()).toBe(1);
    await answer(true);
    fake.event('host.status', hostStatus());
    expect(calls()).toBe(0);
  });

  it('a host heard while the ask is out asks again at once when it fails; a rejection counts as a failure', async () => {
    const fake = fakeClient();
    const { ask, answer, calls } = asks();
    askUntilAnswered(fake.client, ask);
    fake.event('host.status', hostStatus());
    expect(calls()).toBe(1); // one ask out at a time
    await answer(new Error('the bridge threw'));
    expect(calls()).toBe(1);
    await answer(false);
    expect(calls()).toBe(0);
  });

  it('a stop ends the asking, the ask out included', async () => {
    const fake = fakeClient();
    const { ask, answer, calls } = asks();
    const stop = askUntilAnswered(fake.client, ask);
    fake.event('host.status', hostStatus());
    stop();
    await answer(false);
    fake.event('host.status', hostStatus());
    expect(calls()).toBe(0);
  });
});
