// The machines the signed-in member holds a grant on (the project registry, docs/doperpowers/plans/2026-11-10-project-
// registry.md, M10's decision "What a member sees"; design §11: the app lists a project for a member who owns or holds a
// grant on a machine with a location of it). Ownership is the head's; a grant is a record kept by the machine's own
// ledger, so it is read from there: `endpoint.grants`, which answers a member who owns nothing their own entry. A grant
// counts while its rights are not empty (an empty one is a withdrawal), and ends when the held head revokes the key that
// signed it, as the machine's ledger ends it (`dropRevokedGrants`): so the signer's key id is kept with it, and the
// head's revocations are applied here too, at load and at each change of the session, the machine offline or not.
//
// - Read when the machine's link comes up, at each of its `caps` and at each new head (the registry asks, `read`), one
//   call per machine at a time. A failed or malformed answer changes nothing: the last answer stands.
// - Kept in `<userData>/org/member-grants.json` for the member it was read for, so a relaunch with the machine off still
//   lists its projects; another member's sign-in reads none of it.
//
// Electron-free: the registry injects the links' call.
import { GrantsAnswerSchema } from '@shared/ipc/schema/endpoint';
import type { CallResult } from '../machines/remote/link';
import type { OrgFiles } from './files';
import type { OrgSession } from './session';

export const MEMBER_GRANTS_FILE = 'member-grants.json';
/** `granted`: per machine ref, the key id that signed the member's grant there. */
export type MemberGrantsFile = { version: 1; org: string; member: string; granted: Record<string, string> };

export interface MemberGrants {
  granted(ref: string): boolean;
  /** Reads the machine's ledger for the signed-in member (its link is up). */
  read(ref: string): void;
  onChanged(listener: () => void): () => void;
  loaded: Promise<void>;
  settled(): Promise<void>;
  close(): Promise<void>;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isFile = (value: unknown): value is MemberGrantsFile =>
  isObject(value) && value.version === 1 && typeof value.org === 'string' && typeof value.member === 'string' && isObject(value.granted) && Object.values(value.granted).every((kid) => typeof kid === 'string');

export function createMemberGrants(deps: {
  session: OrgSession;
  files: OrgFiles;
  /** The machine's link's call; null while it has none. */
  call(ref: string, name: 'endpoint.grants', input: null): Promise<CallResult> | null;
  log(line: string): void;
}): MemberGrants {
  const log = (line: string) => deps.log(`[org-grants] ${line}`);
  /** Whose grants `granted` holds: the org and member they were read for. */
  let reader: { org: string; member: string } | null = null;
  /** Per machine ref, the key id that signed the member's grant there. */
  let granted = new Map<string, string>();
  const reading = new Set<string>();
  const listeners = new Set<() => void>();
  let closed = false;
  let writing: Promise<void> = Promise.resolve();
  let pending: Promise<void>[] = [];

  const current = () => {
    const c = deps.session.current();
    return c === null ? null : { org: c.identity.org, member: c.identity.member };
  };
  const same = (a: { org: string; member: string } | null, b: { org: string; member: string } | null) => a !== null && b !== null && a.org === b.org && a.member === b.member;

  function changed(): void {
    for (const listener of [...listeners]) listener();
    if (reader === null) return;
    const file: MemberGrantsFile = { version: 1, ...reader, granted: Object.fromEntries([...granted].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) };
    writing = writing.then(async () => {
      try {
        const check = await deps.files.check();
        if (check === null || !check.ok) return void log(`${MEMBER_GRANTS_FILE} not written: ${check === null ? `${deps.files.dir} does not exist` : check.detail}`);
        await deps.files.write(MEMBER_GRANTS_FILE, file);
      } catch (error) {
        log(`${MEMBER_GRANTS_FILE} not written: ${(error as Error).message}`);
      }
    });
  }

  /** The signed-in member's grants are the ones held, or none: another member's are never read for them. */
  function follow(): void {
    const who = current();
    if (who === null) return;
    if (!same(who, reader)) {
      reader = who;
      granted = new Map();
      changed();
    }
    dropRevoked();
  }

  /** Ends each held grant whose signer's key the held head revokes, as the machine's ledger does. */
  function dropRevoked(): void {
    const state = deps.session.current()?.view.head().state;
    if (state === undefined || granted.size === 0) return;
    const revoked = new Set(state.revoked.map((r) => r.keyId));
    const ended = [...granted].filter(([, kid]) => revoked.has(kid));
    if (ended.length === 0) return;
    for (const [ref] of ended) granted.delete(ref);
    changed();
  }

  const loaded = (async () => {
    const raw = await deps.files.read(MEMBER_GRANTS_FILE).catch(() => null);
    const who = current();
    if (isFile(raw) && (who === null || same(who, raw))) {
      reader = { org: raw.org, member: raw.member };
      granted = new Map(Object.entries(raw.granted));
    }
    follow();
  })();
  const unsubscribe = deps.session.onChanged(() => follow());

  async function readOne(ref: string): Promise<void> {
    const who = current();
    const call = who === null ? null : deps.call(ref, 'endpoint.grants', null);
    if (call === null || who === null) return;
    const result = await call.catch((error: unknown): CallResult => ({ ok: false, error: { code: (error as Error).message } }));
    if (closed || !same(who, current()) || !same(who, reader)) return;
    if (!result.ok) return void log(`${ref.slice(0, 64)}'s grants did not read: ${result.error.code}`);
    const parsed = GrantsAnswerSchema.safeParse(result.output);
    if (!parsed.success) return void log(`${ref.slice(0, 64)}'s grants answer is not a grants read`);
    const grant = parsed.data.members.find((m) => m.member === who.member && m.grant !== null && m.grant.body.rights.length > 0)?.grant ?? null;
    const signer = grant?.sig.kid ?? null;
    // a grant whose signer the held head revokes is no grant, though a machine behind on heads still answers it
    const kid = signer !== null && deps.session.current()?.view.head().state.revoked.some((r) => r.keyId === signer) !== true ? signer : null;
    if (kid === (granted.get(ref) ?? null)) return;
    if (kid !== null) granted.set(ref, kid);
    else granted.delete(ref);
    changed();
  }

  return {
    granted: (ref) => same(current(), reader) && granted.has(ref),
    read(ref) {
      if (closed || reading.has(ref)) return;
      reading.add(ref);
      const run = loaded.then(() => readOne(ref)).finally(() => reading.delete(ref));
      pending = [...pending, run];
    },
    onChanged(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    loaded,
    async settled() {
      while (pending.length > 0) {
        const now = pending;
        pending = [];
        await Promise.all(now);
      }
      await writing;
    },
    async close() {
      if (closed) return;
      closed = true;
      unsubscribe();
      await Promise.all(pending);
      await writing;
    },
  };
}
