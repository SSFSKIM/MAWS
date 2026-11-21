// What an in-place edit's line says in each state of its resubmit (InlineEdit's lineCopy): the editor's line and the
// composer dock's. The word cut (C122): the waits in a word.
export const INLINE_EDIT_LINE = {
  starting: 'Starting…', // P2-A: the session the edit resubmits to is started first
  sending: 'Sending…',
  rewinding: 'Rewinding…',
  rewindUncertain: 'Rewind unconfirmed · checking the transcript…',
  rewindUnresolved: 'The rewind could not be confirmed',
  notSent: 'Rewound · the message was not sent',
  awaitingSend: 'Rewound · send your edited message',
  exited: 'The engine exited before the rewind was confirmed · your edited text is kept',
} as const;
