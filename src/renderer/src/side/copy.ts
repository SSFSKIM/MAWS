// Every string E3's renderer shows (E3 execution document, Constraints: copy through `SIDE_COPY`): the comment
// composer's sheet, the Side pane, and the transcript's side-thread row (its view and its markdown export).
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
  },
  pane: {
    title: 'Side',
    threads: 'Side threads',
    empty: 'No side threads yet. Comment on a line, or type /btw in the composer.',
    noSession: 'Open a session to see its side threads.',
    openAsTab: 'Open as tab',
    shownInMain: 'Shown in the main area',
    goToTab: 'Go to tab',
    openFile: (label: string) => `Open ${label}`,
    gone: 'This side thread is no longer listed.',
  },
  // A thread's name where it has no anchor label: a promoted `/btw` exchange, or one whose `opened` is not seen yet.
  label: (label: string | null, openedBy: 'comment' | 'btw' | 'fork' | null) => label ?? (openedBy === 'btw' ? 'Side question' : 'Side thread'),
  row: {
    opened: 'opened',
    finished: (text: string | null, turns: number) => `finished${turnsSuffix(turns)}${text ? `: ${text}` : ''}`,
    failed: (text: string | null, turns: number) => `ended with an error${turnsSuffix(turns)}${text ? `: ${text}` : ''}`,
    lead: 'Side thread on',
    open: 'Open',
  },
} as const;

// The row's sentence after its label: "opened", "finished (2 turns): …", "ended with an error: …".
export function sideRowStatus(row: { state: 'opened' | 'finished' | 'failed'; text: string | null; turns: number }): string {
  if (row.state === 'opened') return SIDE_COPY.row.opened;
  return row.state === 'failed' ? SIDE_COPY.row.failed(row.text, row.turns) : SIDE_COPY.row.finished(row.text, row.turns);
}
