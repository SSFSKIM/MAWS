// The staging phone run's waits, each bounded (P5 O13 M7): a request to staging that stalls, or whose body trickles,
// ends at its deadline instead of holding the run past its budget; a poll ends at its own deadline even while a probe
// is still out.
import { Person } from '../../../apps/desk-hub/deploy/hub';

/** How long one request to staging may take, its body's reading included. */
export const REQUEST_MS = 30_000;

/** The owner's Access session as `Person` is, every request (and its body) aborted `ms` after it starts. */
export class BoundedPerson extends Person {
  constructor(
    hub: string,
    token: string,
    gate: () => void = () => {},
    private readonly ms = REQUEST_MS,
  ) {
    super(hub, token, gate);
  }

  override fetch(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<Response> {
    const deadline = AbortSignal.timeout(this.ms);
    return super.fetch(path, { ...init, signal: init.signal === undefined ? deadline : AbortSignal.any([init.signal, deadline]) });
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The first value `probe` gives that is not null, false or undefined, probed every `every` ms; rejected `ms` after the
 * wait began, a probe still out included, whose `signal` is aborted then.
 */
export async function within<T>(probe: (signal: AbortSignal) => T | null | false | undefined | Promise<T | null | false | undefined>, what: string, ms: number, every = 10): Promise<T> {
  const deadline = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      deadline.abort();
      reject(new Error(`no ${what} within ${ms} ms`));
    }, ms);
  });
  expired.catch(() => {});
  try {
    for (;;) {
      const value = await Promise.race([Promise.resolve(probe(deadline.signal)), expired]);
      if (value !== null && value !== false && value !== undefined) return value;
      await Promise.race([sleep(every), expired]);
    }
  } finally {
    clearTimeout(timer);
  }
}
