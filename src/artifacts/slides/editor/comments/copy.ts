// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D9; M7): the words of the deck's comments: the
// toolbar's Comment and Comments, the threads rail, the pins.
// The word cut (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M5 task 3): a word kept only as a control's name
// is named `…Name`.
export const COMMENTS_COPY = {
  comment: 'Add comment',
  commentUnavailable: 'Select one element to comment on', // G403: the greyed glyph's reason
  comments: 'Comments',
  commentsOpen: (open: number) => (open > 0 ? `Comments (${open} open)` : 'Comments'),
  rail: 'Comments',
  close: 'Close comments',
  empty: 'No open comments. Select an element and choose Add comment.',
  resolved: (n: number) => `Resolved (${n})`,
  slide: (n: number | null) => (n === null ? 'A removed slide' : `Slide ${n}`),
  show: (quote: string) => `Show element: ${quote}`,
  thread: (quote: string) => `Comment on “${quote}”`,
  orphan: 'Element deleted', // G481
  reply: 'Reply', // G482: the reply field's name, and the send glyph's name and tooltip
  replyUnavailable: 'Write a reply first',
  // G479: the toggle's words, its name the longer ones
  showDeleted: 'Show deleted',
  hideDeleted: 'Hide deleted',
  showDeletedName: 'Show deleted-target comments',
  hideDeletedName: 'Hide deleted-target comments',
  replyPlaceholder: 'Reply…',
  resolve: 'Resolve',
  reopen: 'Reopen',
  pin: (quote: string, n: number) => (n > 1 ? `${n} comments on “${quote}”` : `Comment on “${quote}”`),
  /** P4-B2: the pin popover's name. */
  popover: (quote: string) => `Comments on “${quote}”`,
  /** P4-B2 (V10): a thumbnail's badge, said in its name. */
  openOnSlide: (n: number) => (n === 1 ? '1 open comment' : `${n} open comments`),
  /** The tab title a comment's anchor label names after the deck's: the slide's number and title (D9). */
  where: (n: number, title: string) => (title ? `slide ${n}: ${title}` : `slide ${n}`),
} as const;
