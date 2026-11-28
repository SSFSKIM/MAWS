// UX wave U1b (docs/doperpowers/plans/2026-11-15-ux-wave-U1b-requests-in-transcript.md, Interfaces §E `WaitingCard`;
// acceptance 6 and 7): the card column's first card, registered in U8b's slot `sessionCardWaiting`, which the column
// mounts only while a request of the session waits. "Waiting for you", with the count when more than one waits (the word
// cut, N111: a bare count, "Waiting for you 2", named by what it counts); one line
// per request of the session's list, oldest first: its kind's glyph in its tone, its summary, who asked when an agent
// did, how long it has waited, the summary in full as the line's tooltip. A line goes to its request (`showWaiting`); it
// answers nothing itself. In the column's own card chrome, with no fold. A settling receipt is no request and no line.
// The question sheet's C3 M4 (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md §H; the composite's §8.1;
// frame 4): a sheet question's line is its calm mark, the question's sentence, "from <agent>" when a subagent asked
// (named by the transcript's rows, else by the sheet), and its age; where the card is too narrow for all four, "from
// <agent>" gives way before the question does, whole or not at all (SheetLine). Choosing it opens the session's sheet at the question.
import { useEffect } from 'react';
import type { AttentionItem } from '@shared/graph/attention';
import type { AgentId, AppSessionId } from '@shared/graph/ids';
import { ATTENTION_HEADINGS } from '@shared/attention/headings';
import { questionOfItem } from '@shared/attention/sheet-item';
import type { SheetModel } from '@shared/sheet/model';
import { useNow } from '../app/use-now';
import { itemAge } from '../sidebar/derive';
import { selectWaitingRequests, useAttention } from '../stores/attention';
import { selectSheetModel, selectSheetSession, useSheets, watchSheet } from '../stores/sheet';
import { useTranscriptStore } from '../transcript';
import { registeredActions } from '../transcript/view/registry';
import { BareCount } from '../ui/count';
import { TONE_CLASS } from './controls';
import { WAITING } from './copy';
import { agentNameIn, requesterName } from './requester';
import { showWaiting } from './show-waiting';

const LINE = 'flex h-7 w-full min-w-0 items-center gap-1.5 px-3 text-left text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2';

// The asker's name of a subagent's sheet question, from the session's sheet.
function sheetAsker(model: SheetModel | null, questionId: string): string | null {
  const asker = model?.open.find((question) => question.id === questionId)?.asker;
  return asker === undefined || asker === 'main' ? null : asker.name;
}

export function WaitingCard({ appSessionId }: { appSessionId: AppSessionId }) {
  const items = useAttention((s) => selectWaitingRequests(s, appSessionId));
  const rows = useTranscriptStore((s) => s.entries[appSessionId]?.rows);
  const now = useNow();
  // A subagent's sheet question is named by its sheet where the rows do not know the subagent: the sheet is read while a line needs it
  const sheet = useSheets((s) => selectSheetSession(s, appSessionId));
  const model = useSheets((s) => selectSheetModel(s, sheet));
  const asksByAgent = items.some((item) => item.request.agentId !== null && questionOfItem(item.id) !== null && agentNameIn(rows ?? [], item.request.agentId as AgentId) === null);
  useEffect(() => (sheet !== null && asksByAgent ? watchSheet(sheet) : undefined), [sheet, asksByAgent]);
  if (items.length === 0) return null;
  return (
    <section aria-label={WAITING.title} className="shrink-0 overflow-hidden rounded-md border border-border bg-bg-raised text-ui text-fg shadow-strip">
      <h3 className="flex h-10 min-w-0 items-center gap-1.5 px-3 font-medium">
        {WAITING.title}
        {items.length > 1 && ' '}
        {items.length > 1 && <BareCount count={items.length} meaning={WAITING.countName(items.length)} />}
      </h3>
      <div className="flex min-w-0 flex-col pb-1">
        {items.map((item) => {
          const question = questionOfItem(item.id);
          if (question !== null) return <SheetLine key={item.id} item={item} from={sheetFrom(item, question.questionId)} age={itemAge(item, now)} onChoose={() => registeredActions().openSheet(appSessionId, question.questionId)} />;
          const heading = ATTENTION_HEADINGS[item.kind];
          const from = item.request.agentId === null ? null : requesterName(rows ?? [], item.request.agentId as AgentId);
          return (
            <button key={item.id} type="button" className={LINE} title={item.summary} data-waiting-card-line={item.id} onClick={() => showWaiting(appSessionId, item.id)}>
              <span aria-hidden className={`shrink-0 ${TONE_CLASS[heading.tone]}`}>
                {heading.char}
              </span>
              <span className="min-w-0 flex-1 truncate">{item.summary}</span>
              {from !== null && <span className="max-w-[40%] shrink-0 truncate text-fg-muted">from {from}</span>}
              <span className="shrink-0 text-fg-muted tabular-nums">{itemAge(item, now)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );

  function sheetFrom(item: AttentionItem, questionId: string): string | null {
    if (item.request.agentId === null) return null;
    return agentNameIn(rows ?? [], item.request.agentId as AgentId) ?? sheetAsker(model, questionId) ?? requesterName([], item.request.agentId as AgentId);
  }
}

// A sheet question's line: "from <agent>" is shown whole or not at all (the composite's writer, 2026-11-27). The
// question and the asker share a row that wraps and shows its first line only: the question counts there as its first
// twenty characters at least (its basis, never past its own width), so where the asker cannot stand whole beside those
// and the age it wraps out of sight, and the question takes the line. The line's title and accessible name keep it.
function SheetLine({ item, from, age, onChoose }: { item: AttentionItem; from: string | null; age: string; onChoose(): void }) {
  const heading = ATTENTION_HEADINGS[item.kind];
  const asker = from === null ? null : WAITING.from(from);
  return (
    <button type="button" className={LINE} title={asker === null ? item.summary : `${item.summary} ${asker}`} data-waiting-card-line={item.id} onClick={onChoose}>
      <span aria-hidden className={`shrink-0 ${TONE_CLASS[heading.tone]}`}>
        {heading.char}
      </span>
      <span className="flex h-7 min-w-0 flex-1 flex-wrap content-start gap-x-1.5 overflow-hidden">
        <span className="min-w-0 max-w-max grow basis-[20ch] truncate leading-7">{item.summary}</span>
        {asker !== null && <span data-waiting-from="" className="shrink-0 leading-7 whitespace-nowrap text-fg-muted">{asker}</span>}
      </span>
      <span className="shrink-0 text-fg-muted tabular-nums">{age}</span>
    </button>
  );
}
