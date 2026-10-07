// E4d: every sentence comment mode shows in the app window (E4d execution document, Design §14): the chrome's Comment
// toggle, the toasts after a pick, and the transcript's and the Side pane's page openers. The words the in-page hover UI
// and the native context menu use are main's and the preload's (`COMMENT_WORDS`); they are re-exported here so one
// place holds every word comment mode shows.
export { COMMENT_WORDS } from '@shared/browser/comment-protocol';

export const COMMENT_COPY = {
  toggle: 'Comment',
  toggleAgent: 'Comment is unavailable while the agent is browsing',
  toggleNoPage: 'Load a page to comment on it',
  cropFailed: 'Screenshot unavailable; the comment is sent without one',
  cropTooLarge: 'The screenshot was too large; the comment is sent without one',
  cannotName: 'This element can’t be named; try a smaller area',
  openInBrowser: 'Open in the browser',
  cannotOpen: (url: string) => `MAWS can’t open ${url}`,
  openedElsewhere: (title: string) => `Opened in the browser of ${title}`,
} as const;
