// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D11; M8): B's version history rail beside the deck's
// stage, as B's document shows it (src/artifacts/document/editor/history/HistoryRail.tsx, reused unchanged: the list by
// day with runs folded, author chips, Named only, Save version), driving the deck's own controller, which also names
// the deck's comments in the rows' lines (P4 W1-B). Inside the deck's rail slot (`data-deck-rail`), so under 720 px it
// floats over the stage at every width (WR #45), retaining the working slide’s dimensions.
import { useState } from 'react';
import { HistoryRail, type VersionExports } from '../../../document/editor/history/HistoryRail';
import type { DeckHistoryController, DeckHistorySnapshot } from './controller';
import '../../../document/editor/chrome.css'; // the rail's own look is B's
import './history.css';

export function DeckHistoryRail({ controller, snapshot, sessionTitle, onClose, versionExports }: { controller: DeckHistoryController; snapshot: DeckHistorySnapshot; sessionTitle?: (appSessionId: string) => string | undefined; onClose(): void; versionExports?: VersionExports }) {
  const [saving, setSaving] = useState(false);
  return (
    <div className="deck-history-rail" data-deck-rail="history">
      <HistoryRail controller={controller} snapshot={snapshot} versionExports={versionExports} sessionTitle={sessionTitle} saving={saving} onSaving={setSaving} onClose={onClose} />
    </div>
  );
}
