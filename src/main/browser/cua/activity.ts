// The agent's activity, synthesized from the primitive stream (the in-app browser spec of 2026-10-08, "Action rows"):
// the agent's work arrives as cua_repl `js` calls, opaque to MAWS, so main reads what a leased tab's commands and events
// did and tells the windows `browser.agent.activity` (src/shared/browser/activity.ts), which attach each to the session's
// `js` call. What reaches the event:
//   - a committed main-frame navigation (`Page.frameNavigated`), not while the person holds the tab;
//   - a mouse press the agent dispatched, labelled with the node's tag and accessible text when that is known within
//     LABEL_LOOKUP_MS (looked up through the same lease, so it is attributed as the agent's; a failure leaves null and is
//     not retried);
//   - typed characters as a count, coalesced per TYPED_COALESCE_MS, and a named key (Enter, Tab, …) on its own;
//   - a screenshot (a capture, or a screencast's first frame: connection.ts), a download's end, a dialog's answer, a tab
//     opened or closed.
// Typed text never leaves main. At most ACTIVITY_MAX_PER_SECOND activities per tab reach the windows (mouse moves are
// never activities, so a storm of them costs nothing; a burst beyond the bound is dropped). What was told is kept per
// session, the last BROWSER_ACTIVITIES_KEPT for the app's life, for `browser.agent.activities.list`: a window lists them
// when a session's transcript mounts, so a reload or a second window shows the rows again.
import type { AppSessionId } from '@shared/graph/ids';
import { BROWSER_ACTIVITIES_KEPT, BROWSER_ACTIVITY_KEY_MAX_CHARS, BROWSER_ACTIVITY_LABEL_MAX_CHARS, type BrowserActivity, type BrowserAgentActivity } from '@shared/browser/activity';
import type { BrowserEmit } from '../tabs';

export const ACTIVITY_MAX_PER_SECOND = 20;
export const TYPED_COALESCE_MS = 1_000;
export const LABEL_LOOKUP_MS = 500;

// What one command the agent sent did, before a label is known: a press to label, characters typed, a key, a screenshot.
export type CommandActivity = { kind: 'press'; x: number; y: number } | { kind: 'typed'; chars: number } | Extract<BrowserActivity, { kind: 'key' | 'screenshot' }>;

const chars = (text: string) => [...text].length;

// The activity of one command sent on the page's own session; null for anything that is not one (a mouse move, a second
// press of a double click, a key release, a read).
export function commandActivity(method: string, params: Record<string, unknown>): CommandActivity | null {
  switch (method) {
    case 'Input.dispatchMouseEvent': {
      const { type, x, y, clickCount } = params;
      if (type !== 'mousePressed' || typeof x !== 'number' || typeof y !== 'number') return null;
      return typeof clickCount === 'number' && clickCount > 1 ? null : { kind: 'press', x, y };
    }
    case 'Input.insertText':
      return typeof params.text === 'string' && params.text !== '' ? { kind: 'typed', chars: chars(params.text) } : null;
    case 'Input.dispatchKeyEvent': {
      const { type, key, text } = params;
      if (type !== 'keyDown' && type !== 'rawKeyDown' && type !== 'char') return null;
      // a named key (Enter, Tab, ArrowDown): its name, never a character; a character key types what it carries
      if (type !== 'char' && typeof key === 'string' && key.length > 1 && key.length <= BROWSER_ACTIVITY_KEY_MAX_CHARS) return { kind: 'key', key };
      return typeof text === 'string' && text !== '' && type !== 'rawKeyDown' ? { kind: 'typed', chars: chars(text) } : null;
    }
    case 'Page.captureScreenshot':
      return { kind: 'screenshot' };
    default:
      return null;
  }
}

// A committed navigation of the page's main frame: the URL it shows (with its fragment); null for a child frame's.
export function navigatedUrl(params: unknown): string | null {
  const frame = (params as { frame?: { parentId?: unknown; url?: unknown; urlFragment?: unknown } } | null)?.frame;
  if (!frame || frame.parentId !== undefined || typeof frame.url !== 'string') return null;
  return frame.url + (typeof frame.urlFragment === 'string' ? frame.urlFragment : '');
}

type Send = (method: string, params: Record<string, unknown>) => Promise<unknown>;

// The clicked node's tag and accessible text ("button Submit"), cut to the label's bound; null when the node cannot be
// named. `node` is the reply of `DOM.getNodeForLocation`, sent before the press so it names what was under the pointer.
export async function clickLabel(send: Send, node: Promise<unknown>): Promise<string | null> {
  const { backendNodeId } = (await node) as { backendNodeId?: unknown };
  if (typeof backendNodeId !== 'number') return null;
  const described = (await send('DOM.describeNode', { backendNodeId, depth: 1 })) as { node?: DescribedNode };
  const tag = described.node?.localName || described.node?.nodeName?.toLowerCase() || '';
  if (tag === '') return null;
  let name = '';
  try {
    const { nodes } = (await send('Accessibility.getPartialAXTree', { backendNodeId, fetchRelatives: false })) as { nodes?: { name?: { value?: unknown } }[] };
    const value = nodes?.[0]?.name?.value;
    if (typeof value === 'string') name = value;
  } catch {
    // no accessible name: the node's own text instead
  }
  if (name.trim() === '') name = (described.node?.children ?? []).filter((child) => child.nodeType === 3).map((child) => child.nodeValue ?? '').join(' ');
  return cut(`${tag} ${name.replace(/\s+/g, ' ').trim()}`.trim(), BROWSER_ACTIVITY_LABEL_MAX_CHARS);
}

interface DescribedNode {
  localName?: string;
  nodeName?: string;
  nodeType?: number;
  nodeValue?: string;
  children?: DescribedNode[];
}

// Settles to the value, or to null when it fails or takes longer than `ms`.
export function within<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const lapse = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), ms)));
  return Promise.race([work.catch(() => null), lapse]).finally(() => clearTimeout(timer));
}

function cut(text: string, max: number): string {
  const points = [...text];
  return points.length <= max ? text : points.slice(0, max).join('');
}

interface Typing {
  appSessionId: AppSessionId;
  chars: number;
  at: number; // the first character's time
  timer: ReturnType<typeof setTimeout>;
}

export interface ActivityFeedDeps {
  emit: BrowserEmit;
  now?(): number;
}

// The windows' feed, per tab: activities told in the order they happened (a click waits for its label, and what follows
// waits for the click), typed characters coalesced, each stamped when main saw it, at most ACTIVITY_MAX_PER_SECOND per
// second; each session's last BROWSER_ACTIVITIES_KEPT kept as told.
export class ActivityFeed {
  private readonly typing = new Map<string, Typing>(); // by MAWS tab id
  private readonly chains = new Map<string, Promise<void>>(); // by MAWS tab id: the last activity still to be told
  private readonly recent = new Map<string, number[]>(); // by MAWS tab id: when its last activities were told
  private readonly kept = new Map<AppSessionId, BrowserAgentActivity[]>(); // by session: what was told, oldest first
  private readonly now: () => number;

  constructor(private readonly deps: ActivityFeedDeps) {
    this.now = deps.now ?? Date.now;
  }

  // One activity (or one still being named: a click's label); what was typed before it on the tab is told first.
  tell(appSessionId: AppSessionId, tabId: string, activity: BrowserActivity | Promise<BrowserActivity>): void {
    this.flush(tabId);
    this.queue(appSessionId, tabId, this.now(), activity);
  }

  // Characters typed: told once per window, as one count.
  typed(appSessionId: AppSessionId, tabId: string, count: number): void {
    const pending = this.typing.get(tabId);
    if (pending && pending.appSessionId === appSessionId) {
      pending.chars += count;
      return;
    }
    this.flush(tabId);
    this.typing.set(tabId, { appSessionId, chars: count, at: this.now(), timer: setTimeout(() => this.flush(tabId), TYPED_COALESCE_MS) });
  }

  // What is still being coalesced on the tab (on every tab without one) is told now.
  flush(tabId?: string): void {
    for (const id of tabId === undefined ? [...this.typing.keys()] : [tabId]) {
      const pending = this.typing.get(id);
      if (!pending) continue;
      this.typing.delete(id);
      clearTimeout(pending.timer);
      this.queue(pending.appSessionId, id, pending.at, { kind: 'typed', chars: pending.chars });
    }
  }

  // The session's activities as told, oldest first (a copy).
  list(appSessionId: AppSessionId): BrowserAgentActivity[] {
    return [...(this.kept.get(appSessionId) ?? [])];
  }

  // The session was removed: nothing of it is kept.
  forgetSession(appSessionId: AppSessionId): void {
    this.kept.delete(appSessionId);
  }

  // The tab is gone: nothing more is coalesced or counted for it.
  forget(tabId: string): void {
    this.flush(tabId);
    this.recent.delete(tabId);
  }

  dispose(): void {
    for (const { timer } of this.typing.values()) clearTimeout(timer);
    this.typing.clear();
  }

  private queue(appSessionId: AppSessionId, tabId: string, at: number, activity: BrowserActivity | Promise<BrowserActivity>): void {
    const told = (this.chains.get(tabId) ?? Promise.resolve())
      .then(() => activity)
      .then(
        (settled) => this.emit(appSessionId, tabId, at, settled),
        () => {}, // an activity that could not be made is not told
      );
    this.chains.set(tabId, told);
    void told.then(() => {
      if (this.chains.get(tabId) === told) this.chains.delete(tabId);
    });
  }

  private emit(appSessionId: AppSessionId, tabId: string, at: number, activity: BrowserActivity): void {
    const now = this.now();
    const recent = (this.recent.get(tabId) ?? []).filter((told) => now - told < 1_000);
    if (recent.length >= ACTIVITY_MAX_PER_SECOND) return;
    recent.push(now);
    this.recent.set(tabId, recent);
    const told: BrowserAgentActivity = { appSessionId, tabId, at: new Date(at).toISOString(), activity };
    const kept = this.kept.get(appSessionId) ?? [];
    kept.push(told);
    if (kept.length > BROWSER_ACTIVITIES_KEPT) kept.splice(0, kept.length - BROWSER_ACTIVITIES_KEPT);
    this.kept.set(appSessionId, kept);
    this.deps.emit('browser.agent.activity', told);
  }
}
