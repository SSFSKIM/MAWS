// The report view's words (the P2-C document, Design §7 and §8; the labels the parent's Decision Log 19 chose).
import type { Kind } from '@shared/owner/to-human-parser';

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
};

export const ESSENTIAL = { markRead: 'Mark read', read: 'Read' };
