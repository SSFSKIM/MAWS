// Journal rows → X1 events through C3's normaliser, the engine host's own mapping, for the harness and the tests (it
// replaced the replay stub once the equivalence gate passed; C6 execution document, residue *Replay stub and
// harness*). The normaliser is pure (zod and `@shared` only), so the development bundle and the renderer test project
// import it directly; product renderer code never does. Event ids are `replay:journal:<seq>:<n>`.
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { JournalRow } from '@shared/wire/journal';
import { Normalizer } from '../../../../engine-host/normalizer';

export function journalToEvents(rows: JournalRow[]): SessionEvent[] {
  const normalizer = new Normalizer({ appSessionId: 'replay' as AppSessionId, launchId: 'journal', sessionId: null });
  return rows.flatMap((row) => normalizer.push(row));
}
