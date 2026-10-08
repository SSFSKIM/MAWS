// What an agent did in a tab through cua (the in-app browser spec of 2026-10-08, "Action rows"; cua repository): the
// agent's work arrives as cua_repl `js` calls, opaque to MAWS, so main synthesizes these from the primitive stream of a
// leased tab and tells the windows (`browser.agent.activity`), which show them as rows under the session's `js` call.
// Never an X1 event: main keeps each session's last BROWSER_ACTIVITIES_KEPT for the app's life, which a window lists when
// its transcript mounts (`browser.agent.activities.list`); an app restart loses them. Typed text never leaves main: a
// `typed` activity carries only how many characters were typed (a cell can type a substituted secret); a dialog's
// excerpt and a click's label are page text, capped, shown as plain text.
import * as z from 'zod';
import { AppSessionIdSchema } from '../graph/ids';
import { BROWSER_DIALOG_EXCERPT_MAX_CHARS } from './dialog';
import { BrowserTabIdSchema } from './tab';

export const BROWSER_ACTIVITY_LABEL_MAX_CHARS = 40; // a click's label: the node's tag and accessible text
export const BROWSER_ACTIVITIES_KEPT = 500; // per session, for the app's life (`browser.agent.activities.list`)
export const BROWSER_ACTIVITY_KEY_MAX_CHARS = 32; // a named key (Enter, Tab, ArrowDown): never a typed character

export const BrowserActivitySchema = z.discriminatedUnion('kind', [
  // the main frame committed a navigation; `title` is what the tab had then ('' when the new page has not set one yet)
  z.strictObject({ kind: z.literal('navigated'), url: z.string(), title: z.string() }),
  // a mouse press the agent dispatched, at page coordinates; `label` null when the node could not be named in time
  z.strictObject({ kind: z.literal('clicked'), x: z.number(), y: z.number(), label: z.string().max(BROWSER_ACTIVITY_LABEL_MAX_CHARS).nullable() }),
  // characters inserted or typed, coalesced per second: the count only
  z.strictObject({ kind: z.literal('typed'), chars: z.number().int().min(1) }),
  z.strictObject({ kind: z.literal('key'), key: z.string().min(1).max(BROWSER_ACTIVITY_KEY_MAX_CHARS) }),
  z.strictObject({ kind: z.literal('screenshot') }),
  // a download the agent started, when it ended: the file's name in ~/Downloads (the deliverable records its path)
  z.strictObject({ kind: z.literal('download'), filename: z.string(), state: z.enum(['complete', 'interrupted', 'cancelled']) }),
  // a JavaScript dialog, when it closed: answered by the agent (`accepted`, `dismissed`) or by MAWS's 30 s default
  z.strictObject({
    kind: z.literal('dialog'),
    type: z.enum(['alert', 'confirm']),
    excerpt: z.string().max(BROWSER_DIALOG_EXCERPT_MAX_CHARS),
    answered: z.enum(['accepted', 'dismissed', 'default']),
  }),
  // a tab the agent created (or a page it drives opened) and one it closed
  z.strictObject({ kind: z.literal('tabOpened'), url: z.string() }),
  z.strictObject({ kind: z.literal('tabClosed'), url: z.string() }),
]);
export type BrowserActivity = z.infer<typeof BrowserActivitySchema>;

// `appSessionId`: the session whose agent acted (a side thread acting in its parent's tab names itself), whose transcript
// shows the row; `tabId`: the tab it acted in; `at`: when main saw it (ISO).
export const BrowserAgentActivitySchema = z.strictObject({ appSessionId: AppSessionIdSchema, tabId: BrowserTabIdSchema, at: z.string(), activity: BrowserActivitySchema });
export type BrowserAgentActivity = z.infer<typeof BrowserAgentActivitySchema>;
