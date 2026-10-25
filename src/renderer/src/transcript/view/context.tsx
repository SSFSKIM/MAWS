// What every row component of one mounted transcript shares (C6 execution document, Public surface): the store key,
// the callbacks C5, C7 and C8 supply (TranscriptActions; any the caller omits is a no-op), the rewind interface, the
// request-card renderer, and view-only disclosure state (bubbles, pasted blocks, thinking) that must survive a row
// scrolling out of the virtualised list and back.
import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { ArtifactLocation } from '@shared/artifacts/link'; // P4-B4
import type { ArtifactOpenAt } from '../../artifacts/open-at';
import type { AskRowData, Cell, Row, Spill, SubagentRef, TurnId } from '../model/rows';
import { WorkMotion } from './motion';

export interface TranscriptActions {
  openSubagent(ref: SubagentRef): void; // C8: Subagents tool with that agent selected
  openFullLog(cell: Cell): void; // C8: destination of "Open full log"
  reviewChanges(turnId: TurnId, path?: string): void; // C8: Review tool
  openFile(path: string, line?: number): void; // C5: the layout store action openTab({ kind: 'file', path, line })
  openExternal(url: string): void; // C5: layout.openExternal
  editAndResubmit(row: Extract<Row, { kind: 'user' }>): void; // C7: prefill the composer; forks history (§4.2)
  editPrompt(row: Extract<Row, { kind: 'user' }>): void; // C7 (W1): a prompt that never reached the model (a hook blocked it) back into the composer, as a new message
  loadSpill(spill: Spill): Promise<string>; // C4: fs.readSpill; default adapter provided (DEFAULT_ACTIONS, ./default-actions.ts)
  // E1 start: the `maws` server's rows (tools/maws/actions.ts, registered from App.tsx's E1 block)
  openAsk(appSessionId: AppSessionId, ask: AskRowData): void; // the Question sheet with this ask, from the capsule's own data (residue 14)
  openDelivered(appSessionId: AppSessionId, path: string): Promise<string | null>; // files.openExternal; what to show inline when it was refused, null when opened
  revealDelivered(appSessionId: AppSessionId, path: string): Promise<string | null>; // files.reveal; the same
  // E1 end
  openSideThread(parentAppSessionId: AppSessionId, childAppSessionId: AppSessionId): void; // E3: the Side pane on that thread (side/actions.ts, registered from App.tsx's E3 block)
  // E7 start: the Reply under a message from another session and the Message on a listing row (tools/agents/actions.ts,
  // registered with C8b's callbacks): one steer asking the session to SendMessage the text, and the walk of that ask
  replyToPeer(appSessionId: AppSessionId, target: PeerAddress, text: string): Promise<void>;
  peerReplies: PeerReplies;
  // E7 end
  // E2 start: the artifact row's Open and a delivered file's name (tools/maws/actions.ts, registered from App.tsx's E2 block).
  // P3-L M6b: the panel's Artifacts tool on the artifact (a delivery's id is the artifact's), at the version `at` asks for
  // P4-B4: at the place `location` names (an artifact link's fragment), its version, when it names one, the version shown
  openArtifact(appSessionId: AppSessionId, artifactId: string, at?: ArtifactOpenAt, location?: ArtifactLocation): void; // P3-L M6b fix wave 2: none, the latest
  // E2 end
  // P3-F wave S (F14): an artifact link's ⌘-click, the artifact in a main tab of its own (library/actions.ts's
  // openArtifactTab, registered from App.tsx's E2 block and installed in its host actions); when omitted, as in the
  // desk, an artifact link is its text
  openArtifactTab?(artifactId: string, location?: ArtifactLocation): void; // P4-B4: location, as openArtifact's
  // E4d start: a page element comment's chip (tools/browser/comment/actions.ts, registered from App.tsx's E4d block)
  openBrowserUrl(appSessionId: AppSessionId, url: string): void; // the in-app browser on the page: the session's, a side thread's parent's
  // E4d end
  // E4c start: a browser action row's Open tab (tools/browser/agent/actions.ts, registered from App.tsx's E4c block)
  openBrowserTab(appSessionId: AppSessionId, tabId: string): void; // the Browser tool on that tab
  // E4c end
  // P2-F L121: a mark under a user row that its mount knows of (the comment card's "Sent to Claude" on a reply the engine
  // took); none when omitted
  userRowMark?(row: Extract<Row, { kind: 'user' }>): string | null;
  // Why a dropped prompt never ran, when its mount knows (the desk: its turn was undone before the session read it), said
  // in place of Not sent; Not sent when omitted or null
  droppedRowMark?(row: Extract<Row, { kind: 'user' }>): string | null;
}

// E7 start: who a Reply or a Message goes to, and what became of the last one to that address (E7 execution document,
// Design §4): asked (the steer answered), forwarded (the session's SendMessage carries the text), sent, or failed with
// the reason. A source the row subscribes to, so the transcript reads the agent tools' relay store without importing it.
export interface PeerAddress {
  address: string; // SendMessage's `to`
  name: string | null; // the sender's name, when the envelope gave one
  mode: 'reply' | 'message';
}
export interface PeerReply {
  text: string;
  state: { kind: 'asked'; sentAt: string; parentTurnOpenAtSend: boolean } | { kind: 'forwarded' } | { kind: 'sent'; reworded?: true } | { kind: 'failed'; message: string };
}
export interface PeerReplies {
  subscribe(listener: () => void): () => void;
  get(appSessionId: AppSessionId, address: string): PeerReply | undefined; // the same object until it changes
  dismiss(appSessionId: AppSessionId, address: string): void;
}
const NO_PEER_REPLIES: PeerReplies = { subscribe: () => () => {}, get: () => undefined, dismiss: () => {} };
// E7 end

export interface RewindInterface {
  canUndo(turnId: TurnId): Promise<{ ok: boolean; reason: string | null; files?: string[] | null }>; // dry run; disables the button with the reason as tooltip
  undo(turnId: TurnId): Promise<void>;
}

const noop = () => {};
export const NO_ACTIONS: TranscriptActions = {
  openSubagent: noop, openFullLog: noop, reviewChanges: noop, openFile: noop, openExternal: noop, editAndResubmit: noop, editPrompt: noop,
  loadSpill: () => Promise.reject(new Error('loadSpill: no adapter supplied')),
  openAsk: noop, openDelivered: () => Promise.resolve(null), revealDelivered: () => Promise.resolve(null), // E1
  openSideThread: noop, // E3
  replyToPeer: () => Promise.resolve(), peerReplies: NO_PEER_REPLIES, // E7
  openArtifact: noop, // E2; P3-L M6b
  // E4d start
  openBrowserUrl: noop,
  // E4d end
  // E4c start
  openBrowserTab: noop,
  // E4c end
};
// The actions a row reads outside any Transcript (a standalone Markdown surface, the row tests): the host's defaults.
// MAWS's (`DEFAULT_ACTIONS`: fs.readSpill and layout.openExternal over IPC) live in ./default-actions.ts, which installs
// them here when it loads, so this module and everything that reads it — the rows, Markdown, the to-human presenter —
// import without MAWS's IPC client (the desk's web app imports them; docs/doperpowers/specs/2026-10-15-desk-design.md).
let hostActions: TranscriptActions = NO_ACTIONS;
export function setHostActions(actions: TranscriptActions): void {
  hostActions = actions;
}

// Open/closed flags by id, kept per mounted transcript rather than in a row's own state.
export class Disclosures {
  private open = new Set<string>();
  private listeners = new Set<() => void>();
  isOpen = (id: string) => this.open.has(id);
  toggle = (id: string) => {
    if (!this.open.delete(id)) this.open.add(id);
    for (const listener of this.listeners) listener();
  };
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

export interface TranscriptContextValue {
  storeKey: string;
  variant: 'session' | 'child';
  actions: TranscriptActions;
  rewind: RewindInterface | null;
  renderRequest: ((slot: Extract<Row, { kind: 'request_slot' }>) => ReactNode) | null;
  disclosures: Disclosures;
  idPrefix: string; // unique per mounted transcript: row element ids are `<idPrefix>-<rowId>`
  sessionDirectory?: string | null; // additive: where the session runs (its record's), for a shell call that names no cwd
  effort?: string | null; // additive (W8): the effort the session runs at, which the live thinking label names; null when unknown
  motion?: WorkMotion; // additive (W8): the work area's fold as motion, one per mounted transcript
  // additive (P2-E1): 'local' draws the owner channel through MAWS's own presenter whatever the engine surface's
  // attachment (the comment card's thread, until P2-C's module takes the option over); absent, as before
  presentation?: 'local';
}

const TranscriptContext = createContext<TranscriptContextValue>({
  storeKey: '', variant: 'session', get actions() { return hostActions; }, rewind: null, renderRequest: null, disclosures: new Disclosures(), idPrefix: 'transcript',
});

export const TranscriptProvider = TranscriptContext.Provider;
export const useTranscriptContext = () => useContext(TranscriptContext);
export const useActions = () => useContext(TranscriptContext).actions;
export const rowElementId = (idPrefix: string, rowId: string) => `${idPrefix}-${rowId}`;
// E1: the app session a row belongs to: the store key is the session's id, or `<appSessionId>:<agentId>` for a child's
// transcript (ipcSource), whose rows act on the parent session; null outside a mounted transcript.
export const useRowSession = (): AppSessionId | null => {
  const { storeKey } = useContext(TranscriptContext);
  return storeKey === '' ? null : ((storeKey.includes(':') ? storeKey.slice(0, storeKey.indexOf(':')) : storeKey) as AppSessionId);
};
// The list's scroll container: the one mounted element a divider's aria-controls can name (its rows are virtual).
export const listElementId = (idPrefix: string) => `${idPrefix}-list`;

const NO_MOTION = new WorkMotion(); // a row rendered outside a Transcript (the row tests)
export const useWorkMotion = () => useContext(TranscriptContext).motion ?? NO_MOTION;

// One disclosure of this transcript: [open, toggle].
export function useDisclosure(id: string): [boolean, () => void] {
  const { disclosures } = useContext(TranscriptContext);
  const open = useSyncExternalStore(disclosures.subscribe, () => disclosures.isOpen(id));
  return [open, () => disclosures.toggle(id)];
}

// A fresh Disclosures per mounted transcript.
export const useDisclosures = () => useState(() => new Disclosures())[0];

// A standalone Markdown surface supplies its own session-bound file action without inventing a transcript store.
export function TranscriptActionsProvider({ actions, children }: { actions: Partial<TranscriptActions>; children: ReactNode }) {
  const context = useTranscriptContext();
  return <TranscriptProvider value={{ ...context, actions: { ...context.actions, ...actions } }}>{children}</TranscriptProvider>;
}
