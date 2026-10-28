// A Web Push as the desk's service worker reads it, in one of two shapes. DX7's `PushNotice` (§4, `v: 1`): only what
// points to a card — the project, the session and its alias, the kind, and the request's id or the log event's
// `{writer, seq}`. The hub's v2 notice for a cut-over machine's session (RL §7.4, `Registry.notify`'s `OwnerNotice`):
// only that a session is waiting or wrote, and where — the project, the machine's ref, the session — with no title,
// alias or count. The worker holds no org key, so it can check nothing it draws: the notification says who wants what
// and opens the app at the card, which verifies everything as everywhere else. It carries no Allow or Deny (§6).
//
// The service worker's own module, and the one place the push's shape and the landing URL's grammar live: the app
// reads a v1 landing back with `landingOf`, and a v2 one is a route of its own (`/cards/<machine>/<session>`). It imports
// nothing at run time (the protocol's types only), so the worker's bundle holds nothing that could reach the key;
// `sw-imports.test.ts` keeps it so.
import type { OwnerNotice, PushNotice } from 'desk-hub/protocol';

/**
 * The notice as the worker reads it: the module's `PushNotice`, whose `name` (the project's, as the grid shows it) and
 * `waiting` (the org's waiting count, this push's own request counted, for the app icon's badge) a hub before DC3's
 * dabd37e8 does not send; either absent, or of the wrong shape, is dropped and the rest still drawn.
 */
export type PushNoticeV1 = Omit<PushNotice, 'name' | 'waiting'> & { name?: string; waiting?: number };

/** The hub's v2 notice as the worker reads it, marked apart from DX7's (whose `v` it lacks). */
export type NoticeV2 = OwnerNotice & { v2: true };

export type Notice = PushNoticeV1 | NoticeV2;

/** Where a tapped notification lands, read back from the URL's query by the app. */
export type Landing = { kind: 'request'; request: string } | { kind: 'event'; writer: string; seq: number };

/** What `showNotification` is called with. */
export type NoticeDisplay = { title: string; options: NotificationOptions & { body: string; tag?: string; data: { url: string } } };

const KINDS = new Set(['question', 'permission', 'message']);
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isSeq = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 1;

const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

const V2_FIELDS = ['kind', 'machine', 'project', 'session'];
const V2_KINDS = new Set(['waiting', 'wrote']);

/**
 * The v2 notice, or null. It is exactly `OwnerNotice`'s four fields: one carrying anything more (DX7's `v`, `alias`,
 * `request`, `waiting`, …) is a mixed payload, which no hub sends, and is read as unreadable rather than half-drawn.
 */
function parseV2(n: Record<string, unknown>): NoticeV2 | null {
  const keys = Object.keys(n).sort();
  if (keys.length !== V2_FIELDS.length || keys.some((key, i) => key !== V2_FIELDS[i])) return null;
  if (!isText(n.project) || !isText(n.machine) || !isText(n.session) || !V2_KINDS.has(n.kind as string)) return null;
  return { v2: true, project: n.project, machine: n.machine, session: n.session, kind: n.kind as NoticeV2['kind'] };
}

/** The notice, or null for a payload that does not point to a card. A `waiting` that is not a count is dropped. */
export function parseNotice(value: unknown): Notice | null {
  if (typeof value !== 'object' || value === null) return null;
  const n = value as Record<string, unknown>;
  if (!('v' in n)) return parseV2(n);
  if (n.v !== 1 || !isText(n.project) || !isText(n.session) || !KINDS.has(n.kind as string)) return null;
  if (n.alias !== null && typeof n.alias !== 'string') return null;
  const base = { v: 1 as const, project: n.project, session: n.session, alias: n.alias, ...(isCount(n.waiting) && { waiting: n.waiting }), ...(isText(n.name) && { name: n.name }) };
  const e = n.event as Record<string, unknown> | undefined;
  const event = typeof e === 'object' && e !== null && isText(e.writer) && isSeq(e.seq) ? { writer: e.writer, seq: e.seq } : null;
  if (n.kind === 'message') return event && { ...base, kind: 'message', event };
  if (isText(n.request)) return { ...base, kind: n.kind as 'question' | 'permission', request: n.request };
  // A question the log reported before any bridge raised it, or one nothing raises (MAWS's async ask): its event.
  if (n.kind === 'question' && event) return { ...base, kind: 'question', event };
  return null;
}

/**
 * The app's URL for the notice's card: for v1, the session's direct channel, with the request or the log event to open;
 * for v2, a waiting session's cards, or the cards list for one that wrote (its message is MAWS's to show).
 */
export function noticeUrl(notice: Notice): string {
  if ('v2' in notice) return notice.kind === 'waiting' ? `/cards/${encodeURIComponent(notice.machine)}/${encodeURIComponent(notice.session)}` : '/cards';
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

const WORDS_V2: Record<NoticeV2['kind'], { title: string; body: string; tag: string }> = {
  waiting: { title: 'A session is waiting for your answer', body: 'Opens at its cards', tag: 'cards' },
  wrote: { title: 'A session sent you a message', body: 'Open MAWS to read it', tag: 'wrote' },
};

/**
 * The notification for a notice; for null (a payload the worker cannot read), a plain prompt to open the desk. A v2
 * notice is tagged by its kind and session, so a repeat replaces its own kind and a session's message never hides the
 * notice that it is waiting.
 */
export function describeNotice(notice: Notice | null): NoticeDisplay {
  if (notice === null) return { title: 'The desk', options: { body: 'Something needs you. Open the desk to see it.', data: { url: '/' } } };
  if ('v2' in notice) {
    const words = WORDS_V2[notice.kind];
    return { title: words.title, options: { body: words.body, tag: `${words.tag}/${notice.machine}/${notice.session}`, data: { url: noticeUrl(notice) } } };
  }
  const words = WORDS[notice.kind];
  const card = notice.event ? `event/${notice.event.writer}/${notice.event.seq}` : `request/${notice.request}`;
  return { title: `${named(notice.alias)} ${words.title}`, options: { body: `${notice.name ? `${bounded(notice.name)} · ` : ''}${words.body(notice.alias || null)}`, tag: `${notice.project}/${card}`, data: { url: noticeUrl(notice) } } };
}
