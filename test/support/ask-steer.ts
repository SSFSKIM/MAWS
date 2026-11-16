// The async ask's steer as the builds before board ticket 711 wrote it: each question's header, else its words, on its
// line, and the answers in the block as the sheet gave them, the question's words and the picked labels included. A
// session read now may hold one (its journal, the engine's transcript), so every reader keeps reading this form; this
// build's writer is `askSteerText` (src/shared/maws/ask.ts), which writes the new form. The earlier writer, copied.
import { askQuestionId, type AskAnswer, type AskQuestion, type AskResult } from '../../src/shared/maws/tools';

function earlierAnswerText(question: AskQuestion, answer: AskAnswer | undefined): string {
  if (answer === undefined || answer.status === 'skipped') return 'skipped';
  if (answer.status === 'decide_for_me') return 'decide for me';
  const values = answer.value === undefined ? [] : Array.isArray(answer.value) ? answer.value : [answer.value];
  switch (question.modality) {
    case 'choice':
      return [values.join(', '), answer.otherText !== undefined ? `Other: ${JSON.stringify(answer.otherText)}` : ''].filter((part) => part !== '').join('; ');
    case 'text':
      return JSON.stringify(values.join('\n'));
    case 'file':
    case 'folder':
      return values.map((path) => `\n   ${path}`).join('');
    case 'repository':
      return answer.name !== undefined ? `${answer.name} (${values.join(', ')})` : values.join(', ');
    case 'design_system':
      if (answer.create === true) return 'build a new one with me';
      return answer.name !== undefined ? `${answer.name} (${answer.designSystemId ?? ''})` : (answer.designSystemId ?? '');
  }
}

export function earlierAskSteerText(askId: string, questions: readonly AskQuestion[], answers: readonly AskAnswer[]): string {
  const byId = new Map(answers.map((answer) => [answer.id, answer]));
  const lines = questions.map((question, index) => {
    const answer = byId.get(askQuestionId(question, index));
    const text = earlierAnswerText(question, answer);
    const note = answer?.note !== undefined ? `\n   note: ${JSON.stringify(answer.note)}` : '';
    return `${index + 1}. ${question.header ?? question.question} —${text.startsWith('\n') ? '' : ' '}${text}${note}`;
  });
  const result: AskResult = { status: 'answered', askId, answers: [...answers] };
  return [`[MAWS ask ${askId}] The user answered the questions you asked:`, ...lines, '```json', JSON.stringify(result, null, 2), '```'].join('\n');
}
