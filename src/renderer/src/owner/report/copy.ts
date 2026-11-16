// The owner channel's words outside the to-human view (the P2-C document, Design §8): a request card's Mark read, and
// the toast of a failed Mark all read. UX wave U2b (M2): the report's bar and cards are gone, and the view's own words
// are in `owner/view/copy.ts`; the command's title "Mark all read" is its action's (`src/shared/keymap/actions.ts`).

export const REPORT = {
  notMarkedAll: (error: string) => `Items not marked read: ${error}`, // M6's fix wave: a failed Mark all read, as a toast
  retry: 'Retry',
};

export const ESSENTIAL = { markRead: 'Mark read', notMarked: (error: string) => `Not marked read: ${error}` };
