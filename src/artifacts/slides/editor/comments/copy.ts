// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D9; M7): the words of the deck's comments: the
// toolbar's Comment and Comments, the threads rail, the pins.
export const COMMENTS_COPY = {
  comment: 'Add comment',
  commentTitle: 'Comment on the selected element (⌥⌘M)',
  comments: 'Comments',
  commentsOpen: (open: number) => (open > 0 ? `Comments (${open} open)` : 'Comments'),
  rail: 'Comments',
  close: 'Close comments',
  empty: 'No open comments. Select an element and choose Add comment.',
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
  /** P4-B2: the pin popover's name. */
  popover: (quote: string) => `Comments on “${quote}”`,
  /** P4-B2 (V10): a thumbnail's badge, said in its name. */
  openOnSlide: (n: number) => (n === 1 ? '1 open comment' : `${n} open comments`),
  /** The tab title a comment's anchor label names after the deck's: the slide's number and title (D9). */
  where: (n: number, title: string) => (title ? `slide ${n}: ${title}` : `slide ${n}`),
} as const;
