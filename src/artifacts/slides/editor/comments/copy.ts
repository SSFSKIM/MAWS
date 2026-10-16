// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D9; M7): the words of the deck's comments: the
// toolbar's Comment and Comments, the threads rail, the pins.
export const COMMENTS_COPY = {
  comment: 'Comment',
  commentTitle: 'Comment on the selected element (⌥⌘M)',
  comments: 'Comments',
  commentsOpen: (open: number) => (open > 0 ? `Comments (${open} open)` : 'Comments'),
  rail: 'Comments',
  close: 'Close comments',
  empty: 'No open comments. Select an element and choose Comment.',
  resolved: (n: number) => `Resolved (${n})`,
  slide: (n: number | null) => (n === null ? 'A removed slide' : `Slide ${n}`),
  show: (quote: string) => `Show element: ${quote}`,
  thread: (quote: string) => `Comment on “${quote}”`,
  orphan: 'The commented element was deleted.',
  reply: 'Reply',
  replyPlaceholder: 'Reply…',
  resolve: 'Resolve',
  reopen: 'Reopen',
  pin: (quote: string, n: number) => (n > 1 ? `${n} comments on “${quote}”` : `Comment on “${quote}”`),
  /** The tab title a comment's anchor label names after the deck's: the slide's number and title (D9). */
  where: (n: number, title: string) => (title ? `slide ${n}: ${title}` : `slide ${n}`),
} as const;
