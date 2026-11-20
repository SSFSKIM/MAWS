// Yjs's line when a doc's own transaction both applied an update (which marks the transaction remote) and wrote
// under the doc's clientID: an accept plan's `edit` does both (it applies the deletions it carries, then writes the
// copy), as does a write that loads a state and edits it in one transaction. The doc then takes a fresh clientID for
// its next writes and prints this line. A case that provokes it runs the step here, which keeps the line out of the
// log (any other line still prints) and answers how many times it was printed, for the case to assert.
import { vi } from 'vitest';

const CHANGED = 'Changed the client-id because another client seems to be using it.';

function capture(): { count: () => number; restore: () => void } {
  const log = console.log.bind(console);
  let count = 0;
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    if (args.map(String).join('').includes(CHANGED)) count += 1;
    else log(...args);
  });
  return { count: () => count, restore: () => spy.mockRestore() };
}

/** Runs `step`; answers how many times Yjs changed a doc's clientID during it. */
export function clientIdChanges(step: () => void): number {
  const seen = capture();
  try {
    step();
    return seen.count();
  } finally {
    seen.restore();
  }
}

/** As clientIdChanges, for a step that settles later. */
export async function clientIdChangesAsync(step: () => Promise<unknown>): Promise<number> {
  const seen = capture();
  try {
    await step();
    return seen.count();
  } finally {
    seen.restore();
  }
}
