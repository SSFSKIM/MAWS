// P2-C (2026-10-09; the P2-C document, Design §6 "Restarts and reconnects", Interfaces `session.promptHistory`): what
// happened to the human's prompts while main was not listening, read back from the journals the host retains (X8). Each
// retained launch is read through a fresh Normalizer, as its live process read it, so the events and their ids are the
// ones the live stream carried; only `queue.transition` and `command.lifecycle` at or after `since` are answered. The
// journal walker (`JournalReader.launches`) is P2-A's, shared with its X17 recovery.
import { statSync } from 'node:fs';
import type { PromptHistoryEvent, SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import { JournalReader } from './journal';
import { Normalizer } from './normalizer';

export interface PromptHistory {
  events: PromptHistoryEvent[];
  complete: boolean; // false when a launch from before `since` may have been pruned, or a launch could not be read to its end
}

const isPromptHistory = (event: SessionEvent): event is PromptHistoryEvent => event.kind === 'queue.transition' || event.kind === 'command.lifecycle';

// `since` is an ISO-8601 instant; the rows' `at` is the host's clock, and a lifecycle frame carries no timestamp of its
// own, so both kinds compare on that clock. A launch whose last file was last written before `since` holds nothing at or
// after it and is not read. Complete only when the oldest retained launch began at or before `since` (pruning removes
// whole launches, oldest first) and every launch read parsed to its end.
export async function promptHistory(dir: string, appSessionId: AppSessionId, since: string): Promise<PromptHistory> {
  const from = Date.parse(since);
  const launches = JournalReader.launches(dir);
  let complete = launches.length > 0 && launches[0]!.startedAt <= from;
  const events: PromptHistoryEvent[] = [];
  for (const launch of launches) {
    if (statSync(launch.files.at(-1)!).mtimeMs < from) continue;
    const normalizer = new Normalizer({ appSessionId, launchId: launch.launchId, sessionId: null });
    try {
      for (const file of launch.files) {
        for await (const row of JournalReader.rows(file)) {
          for (const event of normalizer.push(row)) if (isPromptHistory(event) && Date.parse(event.at) >= from) events.push(event);
        }
      }
    } catch {
      complete = false; // a row that is not X8 (a torn or foreign line): what follows it in this launch is unknown
    }
  }
  return { events, complete };
}
