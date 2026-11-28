// The outline's lines (F9, and its settlement once drawn): one a listed question, in the cards' order. The first row is
// its id, header and asker, and "Updated" where its card says so; the second is, where the question has a draft that
// answers, the draft as a receipt reads it (its picks alone where it has any, else the typed text's start); else a
// stopped session's queued answer as its receipt after "queued"; else the question's line by the composite's §8.1 rule.
// An image alone is no answer, and no draft here.
import type { SheetModel, SheetQuestion } from '@shared/sheet/model';
import { hasAnswer, questionSentence, receiptOf } from '@shared/sheet/words';
import type { SheetMemory } from '../../../../src/renderer/src/sheet';
import { OUTLINE } from '../copy';

export interface OutlineLine {
  id: string;
  header: string | null;
  from: string | null; // the subagent that asked
  updated: boolean;
  second: { kind: 'draft' | 'queued' | 'question'; text: string };
}

const fromOf = (question: SheetQuestion): string | null => (question.asker === 'main' ? null : question.asker.name);

export function outlineLines(model: SheetModel, memory: SheetMemory): OutlineLine[] {
  return model.open.map((question) => {
    const draft = memory.drafts.get(question.id);
    const second: OutlineLine['second'] = hasAnswer(draft)
      ? { kind: 'draft', text: receiptOf(draft!.picks, draft!.text) }
      : question.queued
        ? { kind: 'queued', text: receiptOf(question.queued.picks, question.queued.text) }
        : { kind: 'question', text: questionSentence(question.question) };
    const updated = memory.marked.has(question.id) || memory.acts.some((act) => act.id === question.id && act.state === 'stale');
    return { id: question.id, header: question.header || null, from: fromOf(question), updated, second };
  });
}

export function countLine(lines: readonly OutlineLine[]): string {
  const drafted = lines.filter((line) => line.second.kind === 'draft').length;
  return drafted > 0 ? `${OUTLINE.count(lines.length)} · ${OUTLINE.drafted(drafted)}` : OUTLINE.count(lines.length);
}
