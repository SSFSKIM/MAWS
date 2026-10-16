// DX7's Web Push endpoints as the DX3 double serves them, and as the unit suites meet them through a stubbed fetch: one
// implementation of the hub's rules for both (desk-hub's `Registry`: `GET /api/push/key`, and the member's own
// subscriptions under `/api/push/subscriptions`, kept by endpoint, at most 20 a member). Sends nothing: what the hub
// would push is the browser suites' to stand in for, through the service worker directly.
import { base64urlDecode, base64urlEncode, PUSH_KEY_PATH, PUSH_SUBSCRIPTIONS_PATH, type MemberRecord, type PushSubscriptionRecord } from 'desk-hub/protocol';
import type { Answer } from './org-keys';

const MAX_SUBSCRIPTIONS = 20; // the hub's MAX_PUSH_SUBSCRIPTIONS
const MAX_ENDPOINT = 2048;

function bytesOf(value: unknown, length: number): boolean {
  if (typeof value !== 'string') return false;
  try {
    const bytes = base64urlDecode(value);
    return bytes.length === length && base64urlEncode(bytes) === value;
  } catch {
    return false;
  }
}

function isHttpsUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > MAX_ENDPOINT) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** A P-256 public point's shape (65 bytes, uncompressed): the double signs nothing with it. */
export const DOUBLE_VAPID_KEY = base64urlEncode(Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : (i * 37) % 256)));

export class PushDouble {
  /** Whether the hub holds a VAPID key; without one the deployed Worker refuses everything `503 not-configured`. */
  configured = true;
  key = DOUBLE_VAPID_KEY;
  subscriptions: PushSubscriptionRecord[] = [];

  async handle(member: MemberRecord, method: string, path: string, body: unknown): Promise<Answer | null> {
    if (path !== PUSH_KEY_PATH && path !== PUSH_SUBSCRIPTIONS_PATH) return null;
    if (!this.configured) return { status: 503, body: { error: 'not-configured' } };
    if (path === PUSH_KEY_PATH) return method === 'GET' ? { status: 200, body: { key: this.key } } : null;
    if (method === 'GET') return { status: 200, body: { subscriptions: this.subscriptions.filter((s) => s.member === member.id) } };
    if (method === 'PUT') return this.keep(member, body);
    if (method === 'DELETE') return this.forget(member, body);
    return null;
  }

  private keep(member: MemberRecord, body: unknown): Answer {
    const b = (typeof body === 'object' && body !== null ? body : {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
    if (!isHttpsUrl(b.endpoint) || !bytesOf(b.keys?.p256dh, 65) || !bytesOf(b.keys?.auth, 16)) {
      return { status: 400, body: { error: 'bad-shape', message: 'the body is {endpoint: an https URL, keys: {p256dh: 65 bytes, auth: 16 bytes}}' } };
    }
    const endpoint = b.endpoint as string;
    const others = this.subscriptions.filter((s) => s.member === member.id && s.endpoint !== endpoint);
    if (others.length >= MAX_SUBSCRIPTIONS) return { status: 409, body: { error: 'too-many', message: `a member keeps at most ${MAX_SUBSCRIPTIONS} devices` } };
    const record: PushSubscriptionRecord = { member: member.id, endpoint, keys: { p256dh: b.keys!.p256dh as string, auth: b.keys!.auth as string }, created: new Date().toISOString() };
    this.subscriptions = [...this.subscriptions.filter((s) => s.endpoint !== endpoint), record];
    return { status: 200, body: { subscription: record } };
  }

  private forget(member: MemberRecord, body: unknown): Answer {
    const endpoint = typeof body === 'object' && body !== null ? (body as { endpoint?: unknown }).endpoint : undefined;
    if (typeof endpoint !== 'string') return { status: 400, body: { error: 'bad-shape', message: 'the body is {endpoint}' } };
    const before = this.subscriptions.length;
    this.subscriptions = this.subscriptions.filter((s) => !(s.endpoint === endpoint && s.member === member.id));
    return { status: 200, body: { deleted: this.subscriptions.length < before } };
  }

  /** A `fetch` serving the endpoints alone, as `member`, for the unit suites. */
  fetch(member: MemberRecord): typeof fetch {
    return async (input, init) => {
      const path = new URL(String(input), 'http://double').pathname;
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      const answer = (await this.handle(member, init?.method ?? 'GET', path, body)) ?? { status: 404, body: { error: 'not-found' } };
      return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } });
    };
  }
}
