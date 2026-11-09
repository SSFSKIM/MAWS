// The hub's HTTP routes as the app uses them (P5 O8 M1, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md,
// Orientation's "The hub, for an app"): `GET /api/me`, `GET /api/org/state` (from a version, every page), and
// `POST /api/devices/pending`, M3's `POST /api/org/state` (a signed successor), and M4a's `GET /api/devices/pending`
// (`?member=`, H1: an admin's read of another member's entries), M7a's `GET /api/projects/<id>/attestations` (a
// project's history attestations, for the channel's migrated history), and M4b's enrollment and drop: `POST
// /api/enrollments`, `GET /api/enrollments/<id>/key`, and the DELETE of a dropped machine's Registry row (the one
// machine path outside the remote module, boundary.test.ts's allowance), and M4c's provisioning keys: `POST`, `GET` and
// `DELETE /api/provisioning-keys[/<id>]` and the desk track's `POST /api/provisioning-keys/<id>/renew`. A minted key's
// token is a secret: it is in the mint's answer alone, never in a failure, and this module logs nothing. None of its
// answers is trusted (RL §5.9): the
// session verifies every state against what it holds, the pairing judges every entry, and this module only reads and
// classifies.
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
  isHistoryAttestation,
  isMachineCert,
  isMemberEmail,
  isSigned,
  type Certificates,
  type HistoryAttestation,
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
/** M4b: a minted enrollment: its id, its end, and the one-time token the code carries (shown in the start's answer alone). */
export type MintedEnrollment = { id: string; expires: string; token: string };
/** M4b: the key a machine posted under an enrollment, unjudged: its MAC under the code's secret is the enrollment's to check. */
export type EnrollmentKey = { machine: string; pub: string; ref: string; mac: string };

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
  /**
   * M4b: an admin's enrollment token (`registry.ts`'s `createEnrollment`), live `ttl_s` seconds; `machine`, an active
   * machine's name, makes it a re-enrollment of that machine in place. `403 not-admin`, `409 unknown-machine`.
   */
  mintEnrollment(body: { ttl_s: number; machine?: string }, signal?: AbortSignal): Promise<HubResult<MintedEnrollment>>;
  /** M4b: the key posted under the enrollment `id`, for the member who minted it: `404 no-key` until then, `403 not-yours`, `404 unknown-enrollment`. */
  enrollmentKey(id: string, signal?: AbortSignal): Promise<HubResult<EnrollmentKey>>;
  /**
   * M4b: the machine's hub row removed (`machine drop`'s DELETE). A name-only 200 is `deleted`. A keyed 200 is
   * `acknowledged`: the hub took the removal, but under its key-bound precondition (#538) it answers 200 too when the
   * row's posted key no longer matched and nothing was touched, so it is a completed cleanup, not a verified deletion.
   * `absent` is a row already gone (`404 unknown-machine`).
   */
  /**
   * `GET /api/machines` (M4b): each hub row's name, with the key its current enrollment posted, or null for none (a row
   * re-enrolled in place whose new enrollment posted nothing yet, or a certified machine's). A row out of shape fails
   * the whole read, as `malformed`.
   */
  machines(signal?: AbortSignal): Promise<HubResult<HubMachineRow[]>>;
  /**
   * `key`: the dropped machine's ref and the pub the org state holds for it, sent as the hub's precondition (both or
   * neither): a row another key enrolled since is left, answered as acknowledged.
   */
  deleteMachine(name: string, key?: { ref: string; pub: string }, signal?: AbortSignal): Promise<HubResult<'deleted' | 'acknowledged' | 'absent'>>;
}

/** A hub row as `GET /api/machines` lists it, for a drop's delete: its name, and the key its enrollment posted. */
export type HubMachineRow = { name: string; key: { ref: string; pub: string } | null };

export const PROVISIONING_KEYS_PATH = '/api/provisioning-keys';

/**
 * M4c: a provisioning key as the hub lists it (desk-hub's `ProvisioningKeyRecord`), the fields the app reads, each in
 * its grammar: `id` 32 lowercase hex; `label` 1 to 100 characters; `created`, `expires` and `revoked` instants (a
 * renewal writes its delegation's `expires` verbatim, ISO millis); `max_uses` null for no cap.
 */
export type ProvisioningKey = { id: string; label: string; prefix: string; created: string; expires: string; max_uses: number | null; uses: number; revoked: string | null };
/** M4c: a minted key and its secret, which the provisioning code carries; the hub shows the token this once. */
export type MintedProvisioningKey = { key: ProvisioningKey; token: string };

/**
 * M4c: the provisioning keys' routes, which the create transaction, renew's and drop's hub halves and the view's hub
 * column use. Each failure keeps the Worker's code: `403 not-admin`; `404 unknown-key` (no such key) apart from `404
 * not-found` (a hub without the route, still the Worker's); the renewal's `410 key-revoked`, `410 key-expired`, `409
 * not-renewed` and `409 too-long`; `503 hub-updating`.
 */
export interface ProvisioningKeyRoutes {
  /**
   * `POST /api/provisioning-keys` with exactly `{label, prefix, ttl_s, max_uses?}` (no `max_uses` for no cap; the hub's
   * `offline_revoke_s` default, never, is the delegation's `NEVER_OFFLINE`). Only `201 {key, token}` is a mint: any other
   * 2xx is a failure (`unexpected-status`), its body unread.
   */
  mintProvisioningKey(body: { label: string; prefix: string; ttl_s: number; max_uses?: number }, signal?: AbortSignal): Promise<HubResult<MintedProvisioningKey>>;
  /** `POST /api/provisioning-keys/<id>/renew`, no body: the key as `GET` lists it, its `expires` the head delegation's. */
  renewProvisioningKey(id: string, signal?: AbortSignal): Promise<HubResult<ProvisioningKey>>;
  /** `DELETE /api/provisioning-keys/<id>`: `revoked` for `200 {revoked: id}` (a soft revoke, still listed); `absent` for `404 unknown-key`. */
  revokeProvisioningKey(id: string, signal?: AbortSignal): Promise<HubResult<'revoked' | 'absent'>>;
  /** `GET /api/provisioning-keys`: every key, revoked ones included; one out of its grammar fails the whole read. */
  provisioningKeys(signal?: AbortSignal): Promise<HubResult<{ keys: ProvisioningKey[] }>>;
}

/** M7a's read beside the session's: the project channel's, which the signer's and the pairing's clients don't carry. */
export interface ProjectReads {
  /** The project's history attestations as the member reads them; an item that is no signed record is dropped. */
  attestations(project: string, signal?: AbortSignal): Promise<HubResult<Signed<HistoryAttestation>[]>>;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** A Worker's error code (`not-a-member`, `too-many`): anything else is reported as `unrecognized`. */
const ERROR_CODE = /^[a-z][a-z0-9-]{0,39}$/;
/** An ISO 8601 instant in UTC, as the Worker writes one. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
/** An enrollment's id (the Registry's `newId`), and its token: 256 random bits as base64url. */
const ENROLLMENT_ID = /^[0-9a-f]{32}$/;
const ENROLLMENT_TOKEN = /^[A-Za-z0-9_-]{43}$/;
/** The most characters a posted key's field is read with; its grammar is the MAC check's. */
const KEY_FIELD_MAX = 256;
const keyField = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= KEY_FIELD_MAX;
/** M4c: a provisioning key's id (the Registry's `newId`) and its secret (256 random bits as base64url). */
const PROVISIONING_KEY_ID = /^[0-9a-f]{32}$/;
const PROVISIONING_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const instant = (value: unknown): value is string => typeof value === 'string' && INSTANT.test(value);
const whole = (value: unknown, min: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min;

/** A provisioning key as the hub lists it, in its grammar (`ProvisioningKey`), or null; the hub's other fields left out. */
function readProvisioningKey(value: unknown): ProvisioningKey | null {
  if (!isObject(value)) return null;
  const { id, label, prefix, created, expires, max_uses, uses, revoked } = value;
  if (typeof id !== 'string' || !PROVISIONING_KEY_ID.test(id) || typeof label !== 'string' || label.length < 1 || label.length > 100 || !keyField(prefix)) return null;
  if (!instant(created) || !instant(expires) || !(max_uses === null || whole(max_uses, 1)) || !whole(uses, 0) || !(revoked === null || instant(revoked))) return null;
  return { id, label, prefix, created, expires, max_uses, uses, revoked };
}

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
}): HubClient & ProjectReads & ProvisioningKeyRoutes {
  const base = input.url.replace(/\/+$/, '');
  const doFetch = input.fetch ?? fetch;
  const timing = orgTiming(input.timing);

  /** `init.expect`: the one success status the route answers; any other 2xx is `unexpected-status`, its body unread. */
  async function request<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal; expect?: number }, read: (body: unknown) => T | null): Promise<HubResult<T>> {
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
    if (init.expect !== undefined && response.status !== init.expect) return { ok: false, kind: 'status', status: response.status, error: 'unexpected-status' };
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
    mintEnrollment: (body, signal) =>
      request('/api/enrollments', { method: 'POST', body, signal }, (answer) => {
        if (!isObject(answer) || !isObject(answer.enrollment)) return null;
        const { id, expires } = answer.enrollment;
        const token = answer.token;
        if (typeof id !== 'string' || !ENROLLMENT_ID.test(id) || typeof expires !== 'string' || !INSTANT.test(expires) || typeof token !== 'string' || !ENROLLMENT_TOKEN.test(token)) return null;
        return { id, expires, token };
      }),
    enrollmentKey: (id, signal) =>
      request(`/api/enrollments/${encodeURIComponent(id)}/key`, { signal }, (answer) => {
        if (!isObject(answer)) return null;
        const { machine, pub, ref, mac } = answer;
        return keyField(machine) && keyField(pub) && keyField(ref) && keyField(mac) ? { machine, pub, ref, mac } : null;
      }),
    machines: (signal) =>
      request('/api/machines', { signal }, (body) => {
        if (!isObject(body) || !Array.isArray(body.machines)) return null;
        const rows: HubMachineRow[] = [];
        for (const item of body.machines) {
          if (!isObject(item) || !keyField(item.name)) return null;
          const key = item.key;
          if (key === undefined || key === null) rows.push({ name: item.name, key: null });
          else if (isObject(key) && keyField(key.ref) && keyField(key.pub)) rows.push({ name: item.name, key: { ref: key.ref, pub: key.pub } });
          else return null;
        }
        return rows;
      }),
    async deleteMachine(name, key, signal) {
      const precondition = key === undefined ? '' : `?ref=${encodeURIComponent(key.ref)}&pub=${encodeURIComponent(key.pub)}`;
      const done = key === undefined ? ('deleted' as const) : ('acknowledged' as const);
      const answer = await request(`/api/machines/${encodeURIComponent(name)}${precondition}`, { method: 'DELETE', signal }, () => done);
      return !answer.ok && answer.kind === 'status' && answer.status === 404 && answer.error === 'unknown-machine' ? { ok: true, value: 'absent' } : answer;
    },
    mintProvisioningKey: (body, signal) =>
      request(PROVISIONING_KEYS_PATH, { method: 'POST', body, signal, expect: 201 }, (answer) => {
        if (!isObject(answer)) return null;
        const key = readProvisioningKey(answer.key);
        const token = answer.token;
        return key !== null && typeof token === 'string' && PROVISIONING_TOKEN.test(token) ? { key, token } : null;
      }),
    renewProvisioningKey: (id, signal) =>
      request(`${PROVISIONING_KEYS_PATH}/${encodeURIComponent(id)}/renew`, { method: 'POST', signal }, (answer) => {
        const key = readProvisioningKey(answer);
        return key !== null && key.id === id ? key : null;
      }),
    async revokeProvisioningKey(id, signal) {
      const answer = await request(`${PROVISIONING_KEYS_PATH}/${encodeURIComponent(id)}`, { method: 'DELETE', signal }, (body) => (isObject(body) && body.revoked === id ? ('revoked' as const) : null));
      return !answer.ok && answer.kind === 'status' && answer.status === 404 && answer.error === 'unknown-key' ? { ok: true, value: 'absent' } : answer;
    },
    provisioningKeys: (signal) =>
      request(PROVISIONING_KEYS_PATH, { signal }, (body) => {
        if (!isObject(body) || !Array.isArray(body.keys)) return null;
        const keys = body.keys.map(readProvisioningKey);
        return keys.every((k) => k !== null) ? { keys: keys as ProvisioningKey[] } : null;
      }),
    attestations: (project, signal) =>
      request(`/api/projects/${encodeURIComponent(project)}/attestations`, { signal }, (body) =>
        isObject(body) && Array.isArray(body.records) ? body.records.filter((r): r is Signed<HistoryAttestation> => isSigned(r, isHistoryAttestation)) : null,
      ),
  };
}
