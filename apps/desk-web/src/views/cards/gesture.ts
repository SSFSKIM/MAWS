// What a card's passkey gesture approves, in the card's words (P5 O13 M5; RL §5.10). The browser's prompt names the
// relying party and nothing of the request, so the view says what the gesture answers before it asks for it:
// "Face ID approves: Allow `pnpm test` in maws-45". A permission is named by its decision and what the tool would do (a
// command by itself, another tool by its name and the file, address or pattern it is given); a question by its answer,
// and a declined one by the question it declines.
import { field, filePath, toolClass } from '../../../../../src/renderer/src/request-card/tools';
import type { Answer } from '../../cards/answers';
import type { Card } from '../../cards/cards';
import { asPermission, questionsOf } from '../requests/RequestCard';

export type Gesture = { action: string; subject: string | null; where: string };

const SUBJECT_MAX = 60;

/** A subject on one line and at most `SUBJECT_MAX` characters. */
function short(text: string): string {
  const line = text.split('\n')[0].trim();
  return line.length > SUBJECT_MAX ? `${line.slice(0, SUBJECT_MAX - 1)}…` : line;
}

/** The tool and input a permission card asks about. */
function asked(card: Card): { tool: string; input: unknown } {
  if (card.lane === 'A') return { tool: card.raised.tool, input: card.raised.input };
  const request = card.request as { toolName?: unknown; input?: unknown };
  return { tool: typeof request.toolName === 'string' ? request.toolName : card.request.kind, input: request.input };
}

function permission(tool: string, input: unknown): { name: string | null; subject: string | null } {
  const event = asPermission({ tool, input: (input ?? {}) as never });
  switch (toolClass(event.toolName)) {
    case 'command':
      return { name: null, subject: field(input, 'command') };
    case 'edit':
    case 'read':
      return { name: tool, subject: filePath(input) };
    case 'search':
      return { name: tool, subject: field(input, 'pattern') };
    case 'fetch':
      return { name: tool, subject: field(input, 'url') };
    case 'web_search':
      return { name: tool, subject: field(input, 'query') };
    default:
      return { name: tool, subject: null };
  }
}

/** What answering `card` with `given` approves, in the session named `where`. */
export function gestureOf(card: Card, given: Answer, where: string): Gesture {
  if (given.kind === 'question') {
    const answers = Object.entries(given.answers);
    if (answers.length === 1) return { action: `Answer “${short(answers[0][0])}” with`, subject: short(answers[0][1]), where };
    return { action: `Answer ${answers.length} questions`, subject: null, where };
  }
  if (given.kind === 'decline') {
    const questions = card.lane === 'A' ? questionsOf(card.raised) : ((card.request as { questions?: Array<{ question: string }> }).questions ?? []);
    return { action: questions.length === 1 ? `Decline “${short(questions[0].question)}”` : `Decline ${questions.length} questions`, subject: null, where };
  }
  const { tool, input } = asked(card);
  const { name, subject } = permission(tool, input);
  const decision = given.decision === 'allow' ? 'Allow' : 'Deny';
  return { action: name === null ? decision : `${decision} ${name}`, subject: subject === null ? null : short(subject), where };
}

/** The gesture as one line of text. */
export const gestureLine = ({ action, subject, where }: Gesture): string => `Face ID approves: ${action}${subject === null ? '' : ` \`${subject}\``} in ${where}`;
