// Every string E3's renderer shows (E3 execution document, Constraints: copy through `SIDE_COPY`): the comment
// composer's sheet, the Side pane and its question view, the `/btw` widget, the transcript's side-thread row (its view
// and its markdown export), and the sidebar's lineage captions.
import { SENDS_AT_NEXT_STEP } from '../composer/submit/submit-state';

const turnsSuffix = (turns: number) => (turns > 1 ? ` (${turns} turns)` : '');

export const SIDE_COPY = {
  composer: {
    title: (label: string | null) => (label === null ? 'Comment' : `Comment on ${label}`),
    field: 'Comment',
    placeholder: 'What should the agent look at or change here?',
    destination: 'Send to',
    thread: 'Side thread',
    threadCaption: 'A forked session answers here; the main conversation goes on',
    main: 'Send to main',
    mainBusy: SENDS_AT_NEXT_STEP, // the composer's own wording for a `next` steer
    mainIdle: 'Sent now',
    mainNotRunning: 'The main session isn’t running',
    send: 'Send',
    starting: 'Starting…',
    sending: 'Sending…',
    retry: 'Retry',
    mainInstead: 'Send to main instead',
    screenshot: (width: number, height: number) => `Screenshot · ${width} × ${height}`,
    removeScreenshot: 'Remove screenshot',
    openedElsewhere: (parentTitle: string) => `Side thread opened in the panel of ${parentTitle}`,
    queued: 'Queued; it sends when the queue resumes',
    refusedAfterClose: (error: string) => `The comment was not sent: ${error}`,
  },
  // P2-E1: the comment card beside the element (P2-E1 document, D12); its form's words are the composer's above
  card: {
    title: (label: string) => `Comment on ${label}`, // the dialog's accessible name, the sheet's own
    close: 'Close',
    // the thread phase
    replyField: 'Reply',
    replyPlaceholder: 'Reply to this thread',
    send: 'Send',
    sendReply: 'Send reply',
    starting: 'Starting…',
    retry: 'Retry',
    replyRefused: 'The reply was not sent', // a refusal the seam gave no reason for
    replyRefusedAfterClose: (reason: string) => `The reply was not sent: ${reason}`, // P2-F F-C1: the card went meanwhile
    copyReply: 'Copy reply',
    sentToClaude: 'Sent to Claude', // P2-F L121: a reply's row once the engine took it (Desktop's mark)
    openInSidePane: 'Open in Side pane',
    openAsTab: 'Open as tab',
    // the needs-you strip above Reply
    needs: {
      trust: 'Waiting for you to trust this folder',
      relay: 'The relay is not answering',
      failed: 'Could not start',
      held: (holder: string) => `Held by ${holder}`,
      permission: 'Waiting for your permission',
      question: 'Asked you a question',
      plan: 'Waiting for you to review a plan',
      input: 'Waiting for your input', // a dialog, an elicitation
      error: 'Hit an error',
      interrupted: 'Was interrupted',
      autoModeUnavailable: 'Auto mode is unavailable',
      other: 'Waiting for you', // a tier-1 kind with no words of its own
    },
  },
  pane: {
    title: 'Side',
    threads: 'Side threads',
    empty: 'No side threads yet. Comment on a line, or type /btw in the composer.',
    noSession: 'Open a session to see its side threads.',
    openAsTab: 'Open as tab',
    shownInMain: 'Shown in the main area',
    goToTab: 'Go to tab',
    showInDeliverable: 'Show in deliverable', // P2-E1: a thread on an artifact element, back in a card beside the element
    showInBrowser: 'Show in browser', // P2-F L146: a thread on a page element, back in the card under the page
    reopenInBrowser: 'Reopen in browser', // P2-F: the same, when the Side pane took Browser's place in the panel
    shownInCard: 'Shown in the card under the page',
    showHere: 'Show here',
    openFile: (label: string) => `Open ${label}`,
    questions: '/btw', // the question view's chip: the command that asks there (a promoted thread is titled "Side question")
    questionsTitle: 'Side questions',
    questionsLabel: '/btw side questions', // the thread header's toggle: its name begins with its visible text (scale-review C scalpel-5#4, WCAG 2.5.3)
  },
  // `/btw`: the widget and the pane's question view (the composer's refusals are its own copy, `editor/controller.ts`)
  btw: {
    field: 'Ask a side question',
    placeholder: 'Asked beside the running turn; nothing is added to the conversation',
    ask: 'Ask',
    notRunning: 'Start the session to ask a side question',
    askedElsewhere: (parentTitle: string) => `Side question asked in the panel of ${parentTitle}`,
    empty: 'Ask about the conversation without adding to it. The model answers beside the running turn, with no tools.',
    answering: 'Answering…',
    synthetic: 'The engine substituted this answer',
    noAnswer: 'The engine answered with no text',
    retry: 'Retry',
    clear: 'Clear',
    promote: 'Continue as a side thread',
    promoting: 'Starting…',
    log: 'Side questions',
  },
  // A thread's name where it has no anchor label: a promoted `/btw` exchange, or one whose `opened` is not seen yet.
  label: (label: string | null, openedBy: 'comment' | 'btw' | 'fork' | null) => label ?? (openedBy === 'btw' ? 'Side question' : 'Side thread'),
  row: {
    opened: 'opened',
    finished: (text: string | null, turns: number) => `finished${turnsSuffix(turns)}${text ? `: ${text}` : ''}`,
    failed: (text: string | null, turns: number) => `ended with an error${turnsSuffix(turns)}${text ? `: ${text}` : ''}`,
    lead: 'Side thread on',
    open: 'Open',
    openElsewhere: (parentTitle: string) => `Side thread is in the panel of ${parentTitle}`,
  },
  // A sidebar row's lineage: nested under its parent the row says nothing more than the anchor's label (when the title is
  // not that already); a thread or fork whose parent is not listed above it says whose it is; the hover card always does.
  lineage: {
    of: (kind: 'side-thread' | 'fork', parentTitle: string | null) =>
      `${kind === 'side-thread' ? 'Side thread' : 'Fork'}${parentTitle === null ? '' : ` of ${parentTitle}`}`,
    orphan: (kind: 'side-thread' | 'fork', parentTitle: string | null) =>
      `↳ ${kind === 'side-thread' ? 'side thread' : 'fork'}${parentTitle === null ? '' : ` of ${parentTitle}`}`,
  },
} as const;

// The row's sentence after its label: "opened", "finished (2 turns): …", "ended with an error: …".
export function sideRowStatus(row: { state: 'opened' | 'finished' | 'failed'; text: string | null; turns: number }): string {
  if (row.state === 'opened') return SIDE_COPY.row.opened;
  return row.state === 'failed' ? SIDE_COPY.row.failed(row.text, row.turns) : SIDE_COPY.row.finished(row.text, row.turns);
}
