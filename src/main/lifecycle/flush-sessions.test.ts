// The browser sessions' flush at quit (flush-sessions.ts).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSessions, type FlushableSession } from './flush-sessions';

const fake = (over: Partial<{ storage: () => void; cookies: () => Promise<void> }> = {}) => {
  const ses = { flushStorageData: vi.fn(over.storage ?? (() => {})), cookies: { flushStore: vi.fn(over.cookies ?? (() => Promise.resolve())) } };
  return ses as typeof ses & FlushableSession;
};

afterEach(() => vi.restoreAllMocks());

describe('flushing the browser sessions at quit', () => {
  it('flushes each session’s storage and cookies once, a session named twice once, and settles when every cookie flush has', async () => {
    let done!: () => void;
    const slow = fake({ cookies: () => new Promise<void>((resolve) => (done = resolve)) });
    const quick = fake();
    let settled = false;
    const flushing = flushSessions([slow, quick, slow]).then(() => (settled = true));
    expect(slow.flushStorageData).toHaveBeenCalledOnce();
    expect(quick.flushStorageData).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(slow.cookies.flushStore).toHaveBeenCalledOnce();
    expect(quick.cookies.flushStore).toHaveBeenCalledOnce();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    done();
    await flushing;
    expect(settled).toBe(true);
  });

  it('a session whose storage throws or whose cookies reject is logged, and the others still flush', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = fake({
      storage: () => {
        throw new Error('the session is gone');
      },
      cookies: () => Promise.reject(new Error('the cookie store is closed')),
    });
    const fine = fake();
    await expect(flushSessions([broken, fine])).resolves.toBeUndefined();
    expect(fine.flushStorageData).toHaveBeenCalledOnce();
    expect(fine.cookies.flushStore).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledTimes(2);
  });
});
