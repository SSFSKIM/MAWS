// The hub's HTTP routes as the app uses them (P5 O8 M1, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md,
// Orientation's "The hub, for an app"): `GET /api/me`, `GET /api/org/state` (from a version, every page), and
// `POST /api/devices/pending`, M3's `POST /api/org/state` (a signed successor), and M4a's `GET /api/devices/pending`
// (`?member=`, H1: an admin's read of another member's entries). None of its answers is trusted (RL §5.9): the session
// verifies every state against what it holds, the pairing judges every entry, and this module only reads and classifies.
//
// Who answered matters. Every answer of the Worker carries `X-Desk-Build` (but a `101` or an event stream); a 401, 403 or
// redirect without it came from Access, so the hub credential has ended (`credentials`). A Worker's
// `403 {error: 'not-a-member'}` says the hub no longer admits the person (`denied`), which is no verified removal.
//
// No text of an answer leaves here unchecked: what a refusal, a log or a status may carry (an `error` code, an email, an
// instant) must match a short grammar, else it reads as `unrecognized` or the answer as `malformed`, so a hostile hub
// can't reflect the bearer token into the renderer or the log.
import {
  isCertificates,
  isCertRetirement,
  isMachineCert,
  isMemberEmail,
  isSigned,
  type Certificates,
  type PendingEntry as PendingDevice,
  type RootTransition,
  type Signed,
  type SignedOrgState,
} from '../../../apps/org-protocol/src/index.ts';
import { orgTiming, type OrgTiming } from './timing';

export const BUILD_HEADER = 'x-desk-build';
export const ME_PATH = '/api/me';
export const ORG_STATE_PATH = '/api/org/state';
export const PENDING_DEVICES_PATH = '/api/devices/pending';
/** The most pages one read of the chain takes (a page is about 1 MiB and holds at least one state); the endpoint's bound. */
const MAX_PAGES = 1000;

export type HubFailure =
  | { kind: 'credentials'; status: number } // Access answered: the credential is no longer admitted
  | { kind: 'denied'; status: number } // the Worker: 403 not-a-member
  | { kind: 'unreachable'; detail: string } // no answer, or none in time
  | { kind: 'status'; status: number; error: string | null }; // any other answer
export type HubResult<T> = { ok: true; value: T } | ({ ok: false } & HubFailure);

export type Me = { org: { id: string }; member: { id: string; email: string; role: string } };
export type OrgStateView = { head: SignedOrgState | null; transitions: Signed<RootTransition>[]; certificates: Certificates | null; chain?: SignedOrgState[]; more?: boolean };
export type Served = { chain: SignedOrgState[]; head: SignedOrgState | null; transitions: Signed<RootTransition>[]; certificates: Certificates | null };
export type PendingEntry = {
  deviceId: string;
  class: 'native-mac';
  keyStorage: 'software';
  channelPub: string;
  stepUpPub: string;
  mac: string;
};
export type PendingAnswer = { pending: { expires: string } };

export interface HubClient {
  me(signal?: AbortSignal): Promise<HubResult<Me>>;
  /** The state with no `since`: the head, the transitions and the certificates. */
  state(signal?: AbortSignal): Promise<HubResult<OrgStateView>>;
  /** The chain after `since` (0: from genesis), every page, with the last page's head, transitions and certificates. */
  chain(since: number, signal?: AbortSignal): Promise<HubResult<Served>>;
  postPending(entry: PendingEntry, signal?: AbortSignal): Promise<HubResult<PendingAnswer>>;
  /** M3: a signed successor of the hub's head. `201 {version}`; a 409's `error` is the verdict code (`not-head`, `rollback`, …). */
  postState(signed: SignedOrgState, signal?: AbortSignal): Promise<HubResult<{ version: number }>>;
  /**
   * M4a: a member's pending device entries, as the approving side judges them (`judgeEntry`). `null` reads the caller's
   * own (the plain read); another member's id is H1's admin read (`?member=`): `403 not-admin` for a non-admin, `404
   * no-member` for an id the head doesn't list, `503 hub-updating` from a Registry before H1. An item out of the entry's
   * shape is dropped; the hub's own fields (its member, its times) are left out.
   */
  pendingOf(member: string | null, signal?: AbortSignal): Promise<HubResult<PendingDevice[]>>;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** A Worker's error code (`not-a-member`, `too-many`): anything else is reported as `unrecognized`. */
const ERROR_CODE = /^[a-z][a-z0-9-]{0,39}$/;
/** An ISO 8601 instant in UTC, as the Worker writes one. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/**
 * The served certificates: absent is null; a set that is not one is malformed (undefined). Items that are not a signed
 * certificate or retirement are dropped: each is judged where it is used, but a reader of the set may walk them first.
 */
function readCertificates(value: unknown): Certificates | null | undefined {
  if (value === undefined || value === null) return null;
  if (!isCertificates(value)) return undefined;
  return { certs: value.certs.filter((c) => isSigned(c, isMachineCert)), retirements: value.retirements.filter((r) => isSigned(r, isCertRetirement)) };
}

/**
 * A pending entry's fields as the judges read them, each a string where the entry has one, or null: its grammar (a
 * device the state could list, its MAC under the code's secret) is `judgeEntry`'s, which trusts nothing of the hub's.
 */
function readPendingDevice(item: unknown): PendingDevice | null {
  if (!isObject(item)) return null;
  const { deviceId, class: cls, keyStorage, channelPub, stepUpPub, passkey, mac } = item;
  if (typeof deviceId !== 'string' || typeof cls !== 'string' || typeof keyStorage !== 'string' || typeof channelPub !== 'string' || typeof mac !== 'string') return null;
  if (stepUpPub !== undefined && typeof stepUpPub !== 'string') return null;
  if (passkey !== undefined && !(isObject(passkey) && typeof passkey.credentialId === 'string' && typeof passkey.publicKey === 'string' && typeof passkey.rpId === 'string')) return null;
  return {
    deviceId,
    class: cls,
    keyStorage,
    channelPub,
    ...(stepUpPub === undefined ? {} : { stepUpPub }),
    ...(passkey === undefined ? {} : { passkey: { credentialId: passkey.credentialId, publicKey: passkey.publicKey, rpId: passkey.rpId } }),
    mac,
  } as PendingDevice;
}

export function hubClient(input: {
  url: string;
  headers(): Promise<Record<string, string>>;
  fetch?: typeof fetch;
  timing?: Partial<OrgTiming>;
}): HubClient {
  const base = input.url.replace(/\/+$/, '');
  const doFetch = input.fetch ?? fetch;
  const timing = orgTiming(input.timing);

  async function request<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal }, read: (body: unknown) => T | null): Promise<HubResult<T>> {
    const bound = AbortSignal.timeout(timing.FETCH_TIMEOUT_MS);
    const signal = init.signal === undefined ? bound : AbortSignal.any([bound, init.signal]);
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        method: init.method ?? 'GET',
        headers: { ...(await input.headers()), ...(init.body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        redirect: 'manual',
        signal,
      });
    } catch (error) {
      if (init.signal?.aborted) throw init.signal.reason ?? error;
      return { ok: false, kind: 'unreachable', detail: (error as Error).message };
    }
    const fromWorker = response.headers.has(BUILD_HEADER);
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // Access's pages and redirects are not JSON
    }
    if (!fromWorker) {
      if (response.status === 401 || response.status === 403 || (response.status >= 300 && response.status < 400) || response.type === 'opaqueredirect') {
        return { ok: false, kind: 'credentials', status: response.status };
      }
      return { ok: false, kind: 'status', status: response.status, error: null };
    }
    const error = isObject(body) && typeof body.error === 'string' ? (ERROR_CODE.test(body.error) ? body.error : 'unrecognized') : null;
    if (response.status === 403 && error === 'not-a-member') return { ok: false, kind: 'denied', status: 403 };
    if (!response.ok) return { ok: false, kind: 'status', status: response.status, error };
    const value = read(body);
    return value === null ? { ok: false, kind: 'status', status: response.status, error: 'malformed' } : { ok: true, value };
  }

  const readView = (body: unknown): OrgStateView | null => {
    if (!isObject(body) || !Array.isArray(body.transitions)) return null;
    const certificates = readCertificates(body.certificates);
    if (certificates === undefined) return null;
    return {
      head: (body.head ?? null) as SignedOrgState | null,
      transitions: body.transitions as Signed<RootTransition>[],
      certificates,
      ...(Array.isArray(body.chain) ? { chain: body.chain as SignedOrgState[] } : {}),
      ...(body.more === true ? { more: true } : {}),
    };
  };

  return {
    me: (signal) =>
      request(ME_PATH, { signal }, (body) => {
        if (!isObject(body) || !isObject(body.org) || !isObject(body.member)) return null;
        const { org, member } = body;
        // Strict on purpose, for security (`isMemberEmail`): a hostile hub can't reflect the token as an email. Writers keep the grammar, so only legacy data can fail it; a grammar change checks the stored emails first.
        if (typeof org.id !== 'string' || typeof member.id !== 'string' || !isMemberEmail(member.email)) return null;
        return { org: { id: org.id }, member: { id: member.id, email: member.email, role: String(member.role) } };
      }),
    state: (signal) => request(ORG_STATE_PATH, { signal }, readView),
    async chain(since, signal) {
      const chain: SignedOrgState[] = [];
      let cursor = since;
      for (let page = 0; page < MAX_PAGES; page++) {
        const read = await request(`${ORG_STATE_PATH}?since=${cursor}`, { signal }, readView);
        if (!read.ok) return read;
        const got = read.value.chain ?? [];
        chain.push(...got);
        const last = got.at(-1)?.state?.version;
        if (read.value.more !== true || got.length === 0 || typeof last !== 'number') {
          return { ok: true, value: { chain, head: read.value.head, transitions: read.value.transitions, certificates: read.value.certificates } };
        }
        cursor = last;
      }
      return { ok: false, kind: 'status', status: 200, error: `the chain ran past ${MAX_PAGES} pages` };
    },
    postPending: (entry, signal) =>
      request(PENDING_DEVICES_PATH, { method: 'POST', body: entry, signal }, (body) =>
        isObject(body) && isObject(body.pending) && typeof body.pending.expires === 'string' && INSTANT.test(body.pending.expires) ? { pending: { expires: body.pending.expires } } : null,
      ),
    postState: (signed, signal) =>
      request(ORG_STATE_PATH, { method: 'POST', body: signed, signal }, (body) =>
        isObject(body) && typeof body.version === 'number' && Number.isInteger(body.version) && body.version >= 1 ? { version: body.version } : null,
      ),
    pendingOf: (member, signal) =>
      request(member === null ? PENDING_DEVICES_PATH : `${PENDING_DEVICES_PATH}?member=${encodeURIComponent(member)}`, { signal }, (body) =>
        isObject(body) && Array.isArray(body.pending) ? body.pending.map(readPendingDevice).filter((entry) => entry !== null) : null,
      ),
  };
}
