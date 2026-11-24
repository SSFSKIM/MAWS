// Every word the question sheet's components draw (the composite's §8; the C3 plan's "The look", L6, and §I's lists of
// strings). The strings the composite fixes and the ones the drawn example or the composite's writer settled are marked
// by where they come from; the rest are this child's own until the owner sees the built look (M6).
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const SHEET_WORDS = {
  tab: 'Sheet', // the side column's tool (the writer's settlement)
  empty: 'No open questions', // the empty side sheet (frame 6)
  unreadable: 'This sheet was written by a newer sminos.', // a record this build cannot read (frame 6)
  unavailable: 'Answers cannot be sent from here: sminos was not found on this Mac.', // frame 6
  // Send's label carries the count of questions it sends (the composite's §8): "Send 2 answers", "Send 1 answer", "Send"
  send: (n: number) => (n === 0 ? 'Send' : `Send ${plural(n, 'answer', 'answers')}`),
  rest: (n: number) => `${n} more after this`, // Send's rest: confirmed drafts past one Send's fifty inbox lines
  sendAgain: 'Send again', // a Send that failed, or whose answer never came: the same inbox lines again
  notSent: 'Not sent.', // beside Send again, the door's reason under it
  notSentNote: (reason: string) => `Not sent: ${reason}`, // a Send the door refused: its hold released, its drafts kept
  placeholder: 'Type your own answer',
  answerName: (id: string) => `Your answer to ${id}`, // the text field's accessible name
  recommended: 'Recommended',
  dismiss: 'Dismiss',
  updated: 'Updated', // the composite's §8
  from: (agent: string) => `from ${agent}`, // the composite's §8.1
  changed: 'Changed since asked', // the composite's §2.3 ("changed since asked"), capitalised as drawn
  stale: 'The question changed before your answer arrived. Your draft is kept.', // frame 2
  carried: 'You wrote this before the question changed.', // no frame: the carried draft (M6's built look)
  keep: 'Keep my answer', // no frame: the carried draft's one control
  queued: 'Queued. The session is stopped and gets this when it resumes.', // frame 2
  queuedWord: 'queued', // a queued dismissal's line (frame 2)
  takeBack: 'Take back',
  edit: 'Edit',
  dismissed: 'Dismissed', // the composite's §8.1
  accepted: 'Accepted. Not delivered yet.', // frame 2
  // The notes at the sheet's head (S15; frame 6), each standing until the person closes it
  notes: {
    answered: (id: string) => `${id} was already answered`,
    dismissed: (id: string) => `${id} was already dismissed`,
    withdrawn: (id: string) => `${id} was withdrawn`,
    unknown: (id: string) => `${id} is no longer open`, // a verdict `closed` whose question the record never had
    tooLate: (id: string) => `${id}’s answer was already delivered and cannot be taken back`,
  },
  closeNote: 'Close',
  openFile: 'Open file', // a reference's file as it is now
  loading: 'Loading…',
  gone: 'No longer available', // a body the record no longer holds
  image: (n: number) => `Image ${n}`,
  removeImage: (n: number) => `Remove image ${n}`,
  imagesFull: 'An answer holds at most 8 images',
  pasteFailed: 'The image could not be saved.', // a paste the host could not save
  tooLong: 'An answer holds at most 20,000 characters.', // the inbox line's bound, beside a text past it
  // A draft whose card now shows another answer than the one it was written against, out of Send until the person chooses
  conflictQueued: 'Another answer was queued here while you wrote yours.',
  conflictGone: 'The queued answer you were editing is no longer there.',
  keepMine: 'Keep mine',
  discardMine: 'Discard mine',
  // The overview of a machine's sheets (C4's `/`)
  overview: {
    running: 'Running',
    stopped: 'Stopped',
    untitled: (session: string) => `Session ${session.slice(0, 8)}`,
    open: (n: number) => plural(n, 'question', 'questions'),
    queued: (n: number) => `${n} queued`,
    accepted: (n: number) => `${n} accepted`,
    hidden: (n: number) => `${n} dismissed`,
    unreadable: 'Unreadable',
    age: (ms: number) => {
      const minutes = Math.floor(ms / 60_000);
      if (minutes < 1) return 'now';
      if (minutes < 60) return `${minutes}m`;
      const hours = Math.floor(minutes / 60);
      return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
    },
    empty: 'No session has open questions',
  },
} as const;
