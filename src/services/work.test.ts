// A part's work in flight (P5 O3-D M2, Interfaces §A, D27): counted to its end, whichever way it ends, and settled only
// once every part is idle at once.
import { describe, expect, it } from 'vitest';
import { allSettling, Work } from './work';

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => ((resolve = res), (reject = rej)));
  promise.catch(() => {});
  return { promise, resolve, reject };
};
const turn = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('work in flight', () => {
  it('is busy until each tracked promise settles, a rejection included, and settles then', async () => {
    const work = new Work();
    expect(work.busy()).toBe(false);
    const [a, b] = [deferred(), deferred()];
    work.track(a.promise);
    work.track(b.promise);
    let settled = false;
    void work.settled().then(() => void (settled = true));
    a.resolve();
    await turn();
    expect([work.busy(), settled]).toEqual([true, false]);
    b.reject(new Error('failed'));
    await turn();
    expect([work.busy(), settled]).toEqual([false, true]);
  });

  it('settles every part at once: work one part starts as another settles is waited for too', async () => {
    const [first, second] = [new Work(), new Work()];
    const a = deferred();
    const b = deferred();
    first.track(a.promise.then(() => void second.track(b.promise)));
    let settled = false;
    const both = allSettling([first, second]);
    void both.settled().then(() => void (settled = true));
    a.resolve();
    await turn();
    expect([both.busy(), settled]).toEqual([true, false]);
    b.resolve();
    await turn();
    expect([both.busy(), settled]).toEqual([false, true]);
  });
});
