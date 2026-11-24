// A session's sheet drawn in place, compact (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md §H; the
// composite's §8.1; frame 5): where the Overview's session card and the project channel's waiting cards would mount a
// request card for a sheet question, the session's sheet questions together mount one `SessionSheet` at `density:
// 'compact'`, each question folded to its line until chosen, one Send, over the same store and host as the side sheet.
// A session with no sheet this window can read (another machine's, until C6) draws `fallback`, today's card.
import type { ReactNode } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { SessionSheet } from '../../sheet';
import { useSessionSheet } from './use-session-sheet';

/** `head`: drawn above the sheet, inside its frame, when the sheet is drawn. */
export function SheetInPlace({ appSessionId, className, head = null, fallback = null }: { appSessionId: AppSessionId; className?: string; head?: ReactNode; fallback?: ReactNode }) {
  const sheet = useSessionSheet(appSessionId);
  if (sheet.shown === 'reading') return null;
  if (sheet.shown !== 'sheet') return fallback;
  return (
    <div className={className} data-sheet-in-place={sheet.session}>
      {head}
      <SessionSheet model={sheet.model} memory={sheet.memory} onMemory={sheet.onMemory} host={sheet.host} density="compact" unavailable={sheet.unavailable} />
    </div>
  );
}
