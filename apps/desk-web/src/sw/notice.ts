// A Web Push as the desk's service worker reads it (§4, DX7's `PushNotice`): only what points to a card — the project,
// the session and its alias, the kind, and the request's id or the message's `{writer, seq}`. The worker holds no org
// key, so it can check nothing it draws: the notification says who wants what and opens the app at the card, which
// verifies the code and the digest as everywhere else. It carries no Allow or Deny (§6).
//
// The service worker's own module, and the one place the push's shape and the landing URL's grammar live: the app
// reads the landing back with `landingOf`. It imports nothing at run time (the protocol's type only), so the worker's
// bundle holds nothing that could reach the key; `sw-imports.test.ts` keeps it so.
import type { PushNotice } from 'desk-hub/protocol';

/**
 * The notice as the worker reads it: the module's `PushNotice` and the org's waiting count for the app icon's badge
 * (`waiting`, the grid's sum with this push's own request counted) and the project's name as the grid shows it (`name`);
 * DC3 is adding both, so they are optional until then, and a value of the wrong shape is dropped.
 */
export type Notice = PushNotice & { waiting?: number; name?: string };

/** Where a tapped notification lands, read back from the URL's query by the app. */
export type Landing = { kind: 'request'; request: string } | { kind: 'event'; writer: string; seq: number };

/** What `showNotification` is called with. */
export type NoticeDisplay = { title: string; options: NotificationOptions & { body: string; tag?: string; data: { url: string } } };

const KINDS = new Set(['question', 'permission', 'message']);
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isSeq = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 1;

const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

/** The notice, or null for a payload that does not point to a card. A `waiting` that is not a count is dropped. */
export function parseNotice(value: unknown): Notice | null {
  if (typeof value !== 'object' || value === null) return null;
  const n = value as Record<string, unknown>;
  if (n.v !== 1 || !isText(n.project) || !isText(n.session) || !KINDS.has(n.kind as string)) return null;
  if (n.alias !== null && typeof n.alias !== 'string') return null;
  const base = { v: 1 as const, project: n.project, session: n.session, alias: n.alias, ...(isCount(n.waiting) && { waiting: n.waiting }), ...(isText(n.name) && { name: n.name }) };
  if (n.kind === 'message') {
    const event = n.event as Record<string, unknown> | undefined;
    if (typeof event !== 'object' || event === null || !isText(event.writer) || !isSeq(event.seq)) return null;
    return { ...base, kind: 'message', event: { writer: event.writer, seq: event.seq } };
  }
  if (!isText(n.request)) return null;
  return { ...base, kind: n.kind as 'question' | 'permission', request: n.request };
}

/** The app's URL for the notice's card: the session's direct channel, with the request or message to open. */
export function noticeUrl(notice: PushNotice): string {
  const path = `/p/${encodeURIComponent(notice.project)}/s/${encodeURIComponent(notice.session)}`;
  const query = notice.event ? new URLSearchParams({ writer: notice.event.writer, seq: String(notice.event.seq) }) : new URLSearchParams({ request: notice.request ?? '' });
  return `${path}?${query}`;
}

/** The card a landing URL's query names, or null. */
export function landingOf(search: string): Landing | null {
  const query = new URLSearchParams(search);
  const request = query.get('request');
  if (isText(request)) return { kind: 'request', request };
  const writer = query.get('writer');
  const seq = Number(query.get('seq') ?? NaN);
  if (isText(writer) && isSeq(seq)) return { kind: 'event', writer, seq };
  return null;
}

const ALIAS_MAX = 48;
const bounded = (text: string) => (text.length > ALIAS_MAX ? `${text.slice(0, ALIAS_MAX)}…` : text);
const named = (alias: string | null) => (alias === null || alias === '' ? 'A session' : bounded(alias));

const WORDS: Record<PushNotice['kind'], { title: string; body: (alias: string | null) => string }> = {
  question: { title: 'has a question for you', body: () => 'Opens at the question' },
  permission: { title: 'is waiting for your approval', body: () => 'Opens at the request' },
  message: { title: 'sent you a message', body: (alias) => (alias ? `Opens in ${named(alias)}’s channel` : 'Opens in its channel') },
};

/** The notification for a notice; for null (a payload the worker cannot read), a plain prompt to open the desk. */
export function describeNotice(notice: PushNotice | null): NoticeDisplay {
  if (notice === null) return { title: 'The desk', options: { body: 'Something needs you. Open the desk to see it.', data: { url: '/' } } };
  const words = WORDS[notice.kind];
  const card = notice.event ? `event/${notice.event.writer}/${notice.event.seq}` : `request/${notice.request}`;
  return { title: `${named(notice.alias)} ${words.title}`, options: { body: `${notice.name ? `${bounded(notice.name)} · ` : ''}${words.body(notice.alias || null)}`, tag: `${notice.project}/${card}`, data: { url: noticeUrl(notice) } } };
}
