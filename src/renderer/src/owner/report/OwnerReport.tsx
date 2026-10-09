// One assistant text's marks as the report draws them (X18 `OwnerReport`; the P2-C document, Design §7 and §8): each
// to-human span a message card, an essential a must-read card, a question a question card, an insight a note beside
// what it follows, in the text's order; a nested mark splits its outer one, so a message holding a question reads as
// a message, the question, and the rest of the message. The words outside any mark are the working record's: shown
// in the full transcript and once the record is opened (`showRecord`), hidden in the report's closed record. The
// states (answered, queued, read) are main's (`ownerChannel.state`), matched by the mark's identity: the message's
// uuid, its block index, and the ordinal among the block's marks of the same kind (`markIdOf`). A question's choices and
// Reply answer it and an essential's Mark read reads it (M6, `answering.ts`), on a mark main knows.
import { useMemo, type ReactNode } from 'react';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import { markIdOf, questionHead, type MarkId } from '@shared/owner/marks';
import type { OwnerMark } from '@shared/owner/state';
import type { Choice, Part } from '@shared/owner/to-human-parser';
import { useOwnerChannelStore } from '../../stores/owner-channel';
import { useSessions } from '../../stores/sessions';
import { marksOfText } from '../../transcript/model/owner-marks';
import { Markdown } from '../../transcript/view/markdown/Markdown';
import { LABEL } from './copy';
import { EssentialCard } from './EssentialCard';
import { InsightGroup, InsightNote } from './InsightNote';
import { markRead, useQuestionAnswering } from './answering';
import { QuestionCard, type QuestionCardProps } from './QuestionCard';
import './report.css';

export interface OwnerReportProps {
  appSessionId: AppSessionId;
  text: string;
  live: boolean; // a streaming block: read leniently (`parseLive`), display only
  showRecord: boolean; // the words outside the marks are shown
  recordKey: string; // the drawing's identity in its transcript
  anchor: { messageUuid: MessageUuid; blockIndex: number } | null; // null: no message uuid yet, so no state to match
}

type Item = { main: ReactNode; insights: Part[] };

export function OwnerReport({ appSessionId, text, live, showRecord, recordKey, anchor }: OwnerReportProps) {
  const { parts } = marksOfText(text, live);
  const marks = useOwnerChannelStore((s) => s.bySession.get(appSessionId)?.marks);
  const byId = useMemo(() => new Map<string, OwnerMark>(marks?.map((mark) => [mark.id, mark])), [marks]);
  const held = useSessions((s) => {
    const kind = s.records.get(appSessionId)?.holder.kind;
    return kind === 'terminal' || kind === 'background_job' ? kind : null;
  });
  const markOf = (kind: 'need-input' | 'essential', span: number): OwnerMark | null =>
    anchor === null ? null : (byId.get(markIdOf(appSessionId, kind, { ...anchor, span }) as MarkId) ?? null);

  const items: Item[] = [];
  const spans = { 'need-input': 0, essential: 0 };
  parts.forEach((part, index) => {
    if (part.kind === 'insight') {
      const last = items.at(-1);
      if (last) last.insights.push(part);
      else items.push({ main: null, insights: [part] });
      return;
    }
    if (part.kind === 'plain') {
      if (showRecord && part.text.trim()) items.push({ main: <div key={index} className="transcript-commentary"><Markdown markdown={part.text} live={live} /></div>, insights: [] });
      return;
    }
    if (part.kind === 'to-human') {
      items.push({ main: <MessageCard key={index} text={part.text} live={live} />, insights: [] });
      return;
    }
    // M6: never `spans[kind]++` here: the React Compiler (this build) emits a member postfix increment as a prefix one,
    // which numbered every mark one past its ordinal in the app (unit tests, uncompiled, never saw it)
    const span = spans[part.kind];
    spans[part.kind] = span + 1;
    const mark = markOf(part.kind, span);
    items.push({
      main: part.kind === 'need-input'
        ? <AnsweredQuestion key={index} appSessionId={appSessionId} text={part.text} choices={part.choices ?? []} mark={mark} live={live} held={held} />
        : <EssentialCard key={index} text={part.text} live={live} mark={mark} markRead={mark?.item && mark.essential?.state === 'unread' ? () => markRead(appSessionId, [mark.id as MarkId]) : undefined} />,
      insights: [],
    });
  });

  return (
    <div className="owner-report" data-owner-report={recordKey}>
      {items.map((item, n) => (
        <div key={n} className="owner-report-item">
          {item.main}
          {item.insights.length > 0 && (
            <InsightGroup>
              {item.insights.map((insight, i) => <InsightNote key={i} text={insight.text} live={live} />)}
            </InsightGroup>
          )}
        </div>
      ))}
    </div>
  );
}

// M6: a question card with its actions, once main knows the mark (a block still streaming answers nothing yet).
function AnsweredQuestion({ appSessionId, text, choices, mark, live, held }: { appSessionId: AppSessionId; text: string; choices: Choice[]; mark: OwnerMark | null; live: boolean; held: QuestionCardProps['held'] }) {
  const { actions, busy, note, unreported } = useQuestionAnswering(appSessionId, mark === null ? null : (mark.id as MarkId), mark?.head ?? questionHead(text));
  return <QuestionCard text={text} choices={choices} state={mark?.question ?? null} live={live} held={held} actions={actions} busy={busy} note={note} unreported={unreported} />;
}

function MessageCard({ text, live }: { text: string; live: boolean }) {
  return (
    <section className="owner-card" data-owner-card="to-human" aria-label={LABEL['to-human']}>
      <div className="owner-card-label">{LABEL['to-human']}</div>
      <div className="owner-card-body">
        <Markdown markdown={text} live={live} />
      </div>
    </section>
  );
}
