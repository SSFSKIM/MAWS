// The overview in the page (frame 2; §P): C3's `SheetOverview` as it stands in one centred column, each row an anchor
// to its session's sheet that a plain click follows without a load. What stands when nothing is listed is the page's
// own: two lines in the column's middle. Before the first snapshot nothing is drawn.
import type { SheetSummary } from '@shared/sheet/model';
import { SheetOverview } from '../../../../src/renderer/src/sheet';
import { VIEWS } from '../copy';
import { pathOf } from '../route';
import { listed } from '../summaries';

export function Overview({ sessions, open }: { sessions: readonly SheetSummary[] | null; open(session: string): void }) {
  if (sessions === null) return null;
  if (!sessions.some(listed))
    return (
      <div data-sheet-empty="" className="flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center text-fg-muted">
        <p className="m-0">{VIEWS.noQuestions}</p>
        <p className="m-0 text-ui-sm text-fg-muted">{VIEWS.noQuestionsNote}</p>
      </div>
    );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="thread-column py-4">
        <SheetOverview sessions={sessions} onOpen={open} hrefOf={(session) => pathOf({ at: 'sheet', session })} />
      </div>
    </div>
  );
}
