// Every sentence of the Question sheet (E1 execution document, M4; the request card's copy conventions).
import type { AskCancelReason } from '@shared/maws/ask';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const SHEET = {
  title: 'Questions',
  rest: 'No open questions',
  restDetail: 'When the agent asks you something, it shows here.',
  noSession: 'Open a session to see its questions',
  // the switcher between the asks a session holds
  asks: (n: number) => plural(n, 'open ask'),
  untitled: 'Questions',
  waitingNote: 'The agent is waiting for these answers.',
  asyncNote: 'The agent keeps working; your answers reach it as its next message.',
  // per section
  decideForMe: 'Decide for me',
  skip: 'Skip',
  other: 'Other…',
  otherPlaceholder: 'Type your own answer',
  otherLabel: (question: string) => `Other answer to ${question}`,
  textPlaceholder: 'Type your answer',
  chooseFile: 'Choose file…',
  chooseFiles: 'Choose files…',
  chooseFolder: 'Choose folder…',
  chooseFolders: 'Choose folders…',
  remove: (path: string) => `Remove ${path}`,
  noProjects: 'MAWS has no projects yet.',
  incomplete: 'Type your Other answer, or clear Other',
  // Submit
  submit: 'Submit',
  submitSkipping: (n: number) => `Submit · ${n} skipped`,
  submitting: 'Sending…',
  failed: "Couldn't deliver the answers",
  retry: 'Retry',
  answeredElsewhere: 'Already answered elsewhere',
  readFailed: "Couldn't read this session's questions",
  dismiss: 'Dismiss',
  // read-only
  // a cancelled ask, by why (null: no event said, as on the disk path)
  cancelled: (reason: AskCancelReason | null) => (reason === 'withdrawn' ? 'The turn was interrupted before you answered' : 'This session ended before you answered'),
  answered: 'Answered',
  notHeld: 'MAWS no longer holds this ask, so it cannot be answered here.',
  answerSkipped: 'Skipped',
  answerDecided: 'Decided for me',
  answerNone: 'Not answered',
  otherAnswer: (text: string) => `Other: ${text}`,
} as const;
