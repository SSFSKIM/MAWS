// Every string E3's renderer shows (E3 execution document, Constraints: copy through `SIDE_COPY`): the comment
// composer's sheet, the Side pane and its question view, the `/btw` widget, the transcript's side-thread row (its view
// and its markdown export), and the sidebar's lineage captions.
import { SEND_TO_MAIN_LABEL } from '@shared/side/copy'; // UX wave U5a (Decision Log 52): main's refusal names the box by it
import { SENDS_AT_NEXT_STEP } from '../composer/submit/submit-state';

const turnsSuffix = (turns: number) => (turns > 1 ? ` (${turns} turns)` : '');

export const SIDE_COPY = {
  composer: {
    title: (label: string | null) => (label === null ? 'Comment' : `Comment on ${label}`),
    field: 'Comment',
    placeholder: 'Comment…', // the word cut (P428)
    // UX wave U5a (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, §E): one checkbox in place of the two
    // destinations; its title says what ticking does now, or why it can't change
    main: SEND_TO_MAIN_LABEL,
    mainBusy: SENDS_AT_NEXT_STEP, // the composer's own wording for a `next` steer
    mainIdle: 'Sent now',
    threadRemote: (machine: string) => `A side thread is not available on ${machine} yet`,
    noConversation: 'This session has no conversation to fork yet',
    leftOut: (count: number, reason: string) => `${count === 1 ? '1 screenshot is' : `${count} screenshots are`} left out: ${reason}`,
    tooLongRemote: 'Too long for a terminal session on another machine: send fewer comments at a time',
    notConfirmed: 'The session did not confirm the message', // an unconfirmed hand-off that names no pending send
    notSent: 'The comment was not sent', // a refusal the port gave no words for
    send: 'Send',
    sendMany: (count: number) => `Send ${count} comments`, // UX wave U5a (§E): a pass with more than one comment that has text
    // the word cut (P432): Send keeps its word while it goes, a quiet spinner in it named by these
    starting: 'Starting…',
    sending: 'Sending…',
    retry: 'Retry',
    mainInstead: 'Send to main instead',
    screenshot: (width: number, height: number) => `Screenshot · ${width} × ${height}`, // the thumbnail's name
    // the word cut (P434): with no thumbnail, the word alone, its size its tooltip
    screenshotWord: 'Screenshot',
    screenshotSize: (width: number, height: number) => `${width} × ${height}`,
    removeScreenshot: 'Remove screenshot',
    openedElsewhere: (parentTitle: string) => `Side thread opened in the panel of ${parentTitle}`,
    refusedAfterClose: (error: string) => `The comment was not sent: ${error}`,
  },
  // UX wave U5a (§E; decision 8): the line a card's host draws in its place after a send to the main conversation. "Sent
  // to" only for a confirmed delivery; a terminal session's hand-off that is not confirmed follows its pending send in
  // the strip's words (`PENDING_SEND`'s, the session named), with one action, Show
  place: {
    // the word cut (P438): a steer's place reads as a send's, a queued one's without how the queue goes on
    sent: (title: string) => `Sent to ${title}`,
    queued: (title: string) => `Queued for ${title}`,
    sending: (title: string) => `Not confirmed yet in ${title}`,
    unconfirmed: (title: string) => `May not have arrived in ${title}`,
    refused: (title: string, reason: string | null) => (reason ? `Not entered in ${title}: ${reason}` : `Not entered in ${title}`),
    show: 'Show',
  },
  // P2-E1: the comment card beside the element (P2-E1 document, D12); its form's words are the composer's above
  card: {
    title: (label: string) => `Comment on ${label}`, // the dialog's accessible name, the sheet's own
    parent: (title: string) => `Session: ${title}`, // P3-F1: the session a card with no chat beside it goes to
    close: 'Close',
    // UX wave U5a (§E): the pass's other comments in the card, and the chip of a pass with no card open
    removeComment: 'Remove comment',
    unsent: (count: number) => (count === 1 ? '1 unsent comment' : `${count} unsent comments`),
    // Decision Log 52 (2): a pick on a pass that holds as many comments as a message carries adds nothing
    limit: (max: number) => `A message carries at most ${max} comments: send these first`,
    // the thread phase
    replyField: 'Reply',
    replyPlaceholder: 'Reply…', // the word cut (P442)
    send: 'Send',
    sendReply: 'Send reply',
    starting: 'Starting…', // the echo's quiet spinner's name while the thread starts (the word cut, P432)
    retry: 'Retry',
    replyRefused: 'The reply was not sent', // a refusal the seam gave no reason for
    replyRefusedAfterClose: (reason: string) => `The reply was not sent: ${reason}`, // P2-F F-C1: the card went meanwhile
    copyReply: 'Copy reply',
    replyNotCopied: (why: string) => `The reply was not copied: ${why}`, // tech debt L117: the clipboard refused it
    sentToClaude: 'Sent to Claude', // P2-F L121: a reply's row once the engine took it (Desktop's mark); the check's name and tooltip
    sentMark: '✓', // the word cut (P443): the mark drawn
    openInSidePane: 'Open in Side pane',
    openAsTab: 'Open as tab',
    // the needs-you strip above Reply: the sentence heard; what waits on the person drawn as the waiting disc and its noun
    // (`nouns`, the word cut, P440), an error, a holder and the trust card (a consent step, never a candidate) by their words
    nouns: { permission: 'Permission', question: 'Question', plan: 'Plan', input: 'Input' },
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
    empty: 'Comment on a line to start a thread.', // the word cut (P419)
    noSession: 'Open a session to see its side threads.',
    openAsTab: 'Open as tab',
    shownInMain: 'Shown in the main area', // the word cut (P424): Go to tab's tooltip and description, not drawn
    goToTab: 'Go to tab',
    showInArtifact: 'Show in artifact', // P2-E1 (E2's 'Show in deliverable'; P3-L M6b): a thread on an artifact element, back in a card beside the element
    showInBrowser: 'Show in browser', // P2-F L146: a thread on a page element, back in the card under the page
    reopenInBrowser: 'Reopen in browser', // P2-F: the same, when the Side pane took Browser's place in the panel
    shownInCard: 'Shown in the card under the page', // the same, for Show here
    showHere: 'Show here',
    openFile: (label: string) => `Open ${label}`,
    // a thread's toggle for its questions under its view, in the normal face (the word cut, P422; a promoted thread is
    // titled "Side question"); its name begins with its visible text (scale-review C scalpel-5#4, WCAG 2.5.3) and keeps
    // the command that asks there
    questions: 'Questions',
    questionsTitle: 'Side questions',
    questionsLabel: 'Questions: /btw side questions',
  },
  // `/btw`: the widget, the session's card (UX wave U4a) and a thread's questions under its thread view (the composer's
  // refusals are its own copy, `editor/controller.ts`)
  btw: {
    field: 'Ask a side question', // the field's name, not drawn over it (the word cut, P415)
    placeholder: 'Ask a quick question…', // the word cut (P416): the dialog's and a thread's question field, as the card's first ask
    ask: 'Ask',
    notRunning: 'Start the session to ask a side question',
    askedElsewhere: (parentTitle: string) => `Side question asked in the side chat of ${parentTitle}`, // UX wave U4a: its card, no longer its panel
    // UX wave U4a (O-20; Interfaces I): the card
    card: 'Side chat', // its header, and the folded chip's word
    askFirst: 'Ask a quick question…',
    followUp: 'Follow up…',
    fold: 'Fold side chat',
    close: 'Close side chat',
    unfold: 'Open', // the folded chip's tip (its name is its word, "Side chat"; the word cut, P405)
    unseen: 'New answer', // the chip's dot
    empty: 'Ask about the conversation without adding to it. The model answers beside the running turn, with no tools.',
    answering: 'Answering…',
    synthetic: 'Not from Claude', // the word cut, N167: an answer the engine put in Claude's place
    noAnswer: 'No answer', // the word cut (P413)
    retry: 'Retry',
    // the word cut (P409, P408): drawn only once they can act; Continue keeps its words while the thread starts, a quiet
    // spinner in it named by `promoting` (N165)
    clear: 'Clear',
    promote: 'Continue as thread',
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

// UX wave U5a (§E, decision 8): the pending line's words for its pending send's state, the session named.
export function pendingWords(send: { state: 'sending' | 'refused' | 'unconfirmed'; reason: string | null }, title: string): string {
  if (send.state === 'sending') return SIDE_COPY.place.sending(title);
  return send.state === 'refused' ? SIDE_COPY.place.refused(title, send.reason) : SIDE_COPY.place.unconfirmed(title);
}
