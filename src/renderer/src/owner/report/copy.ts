// The report view's words (the P2-C document, Design §7 and §8; the labels the parent's Decision Log 19 chose).
import type { Kind } from '@shared/owner/to-human-parser';
import { STARTING_SESSION } from '../../sessions/acquire';

export const LABEL: Record<Kind, string> = { 'to-human': 'Message', essential: 'Must read', 'need-input': 'Question', insight: 'Insight' };

export const REPORT = {
  view: 'Session view',
  report: 'Report',
  transcript: 'Transcript',
  record: 'Working record',
  fold: 'Fold to report',
  running: 'Working',
  toolCalls: (n: number) => `${n} tool ${n === 1 ? 'call' : 'calls'}`,
  messages: (n: number) => `${n} ${n === 1 ? 'message' : 'messages'}`,
  mustRead: (n: number) => `${n} must-read`,
  markAllRead: 'Mark all read',
  mismatch: (observed: string, resolved: string) => `The engine uses the output style “${observed}”, not “${resolved}” as MAWS read it. The next start follows the engine.`,
};

export const QUESTION = {
  recommended: 'Recommended',
  choices: 'Choices',
  reply: 'Reply',
  queued: 'Queued — sends when the agent reaches a pause',
  cancel: 'Cancel',
  unconfirmed: 'Sent — not confirmed',
  answerAgain: 'Answer again',
  answered: 'Answered:',
  terminal: 'This session is open in a terminal',
  backgroundJob: 'This session is running as a background job',
  // M6: the card's actions
  sending: 'Sending…',
  starting: STARTING_SESSION, // the send starts the session first (P2-A)
  replyLabel: 'Your answer',
  send: 'Send',
  close: 'Close',
  retry: 'Retry',
  takeOver: 'Take over here', // the holder notice's words (HolderActions)
  alreadyOnItsWay: 'Already on its way',
};

export const ESSENTIAL = { markRead: 'Mark read', read: 'Read' };
