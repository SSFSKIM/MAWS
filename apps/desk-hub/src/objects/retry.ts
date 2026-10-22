// A call from one of the hub's objects to another that failed is sent again, where nothing else would heal what it
// carried: the Registry's push of the org's directory to a machine's object, and a project's summary report to the
// Registry. The deployed runtime fails such calls and Miniflare does not; a code update's reset of the object called is
// the commonest, since every deploy is one, and the rollout reaches objects one by one, so the caller is often on the
// new code while the callee is reset under the call. A lost connection or an overloaded object fails them too.
//
// Each retry waits twice the one before, from a second, up to a minute, a random half of it taken off so callers that
// failed together (every project, when the Registry was reset) do not try again together. An object that answered
// overloaded is given the minute at once: Cloudflare asks that it not be retried promptly, which would worsen the
// overload (developers.cloudflare.com/durable-objects/best-practices/error-handling/). Any other failure is retried,
// whatever its `retryable` reads: what the runtime sets on a code update's reset is not documented, and the retries are
// bounded. A call goes RETRY_ATTEMPTS times at most, the first included: one to two minutes in all, well inside the 15
// minutes a pending timer keeps an object in memory. The retry waits in memory, so an object reset itself before its
// retry's time forgets it.

/** How many times a call goes at most, the first included. */
export const RETRY_ATTEMPTS = 8;
/** The longest wait before the first retry. */
export const RETRY_BASE_MS = 1000;
/** The longest wait before any retry. */
export const RETRY_CAP_MS = 60_000;

/** The wait before the call goes again, after its attempt `attempt` (1 for the first send) failed with `error`. */
export function retryDelay(attempt: number, baseMs: number, error: unknown): number {
  const overloaded = typeof error === 'object' && error !== null && (error as { overloaded?: unknown }).overloaded === true;
  const step = overloaded ? RETRY_CAP_MS : Math.min(RETRY_CAP_MS, baseMs * 2 ** (attempt - 1));
  return step / 2 + (Math.random() * step) / 2;
}
