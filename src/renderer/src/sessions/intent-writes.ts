// The intent writes this page has sent and main has not answered, per session (U13a, the branch review; board ticket
// 854): until a write's answer reaches the setup store a chat may hold a draft or a chip's pick its intent does not show
// yet. An empty chat is not one with a write on the way, and a first start, here or on another machine, waits for the
// writes made before it. Its own module so the remote spawn reads it without importing C10's actions.
import type { AppSessionId } from '@shared/graph/ids';

const writing = new Map<AppSessionId, Set<Promise<unknown>>>();

export const resetIntentWrites = (): void => writing.clear(); // for suites: a write a failed test left unanswered

/** Holds `write` as on its way to `appSessionId`'s intent until it settles, answered, refused or rejected. */
export function holdIntentWrite<T>(appSessionId: AppSessionId, write: Promise<T>): Promise<T> {
  const held = writing.get(appSessionId) ?? new Set();
  writing.set(appSessionId, held.add(write));
  const settle = () => {
    held.delete(write);
    if (held.size === 0 && writing.get(appSessionId) === held) writing.delete(appSessionId);
  };
  write.then(settle, settle);
  return write;
}

export const writingIntent = (appSessionId: AppSessionId): boolean => writing.has(appSessionId);

/** Resolves once every write of `appSessionId`'s intent on its way now has settled; a write made later is not waited for. */
export async function intentWritesSettled(appSessionId: AppSessionId): Promise<void> {
  await Promise.allSettled(writing.get(appSessionId) ?? []);
}
