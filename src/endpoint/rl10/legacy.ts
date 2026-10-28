// The DX1 org key (O10 M6; RL §9: dual-coding until the org key retires). Outbound events carry the v2 signature and
// DX1's `mac` (over the event with its `sig`), so machines not yet moved can read them; a v1-only event from one of them
// verifies under the same key. The key is handed over once: at an RL10 hello on an endpoint that holds no
// `legacy.json`, the endpoint asks for it (`legacy-key?`), sminos answers from its `hub.json` when the org matches, and
// the endpoint keeps it at 0600. With no key, events go out v2-only and legacy events can't be checked. The key is in no
// log line and no frame but sminos's answer. A key kept for another org than the enrollment's (the machine moved) is no
// key: it is removed when next read, and the new org's is asked for.
//
// The retirement (O14 M5a) is the signed state's (`legacyRetired`), and `legacy.json` follows the head (`follow`, at
// each adoption and at start): at a head that carries the mark it becomes the tombstone `{org, retired, key}`, keeping
// the bytes, and the endpoint asks for no key, keeps none it is sent, codes nothing and checks no v1 code (a v1 event
// goes down as an inert record, log-relay.ts); at a head without it the bytes are the key again at once, with no hello
// (the retirement undone). A machine that never held the key under a head without the mark has nothing to keep: the
// tombstone it writes holds no bytes (no key at all, or the first sync's head already retiring). `legacy purge` deletes
// the bytes, from the tombstone and from every `stale-<time>/` copy, for good.
import { base64urlDecode, deriveLogNonce, importOrgKey, seal, verify, type OrgKey } from 'desk-hub/protocol';
import type { OrgState } from 'org-protocol';
import type { EndpointState, LegacyFile } from '../state/store';

export type Mac = { nonce: string; value: string };

/** What `legacy status` says: the key in use, its tombstone with or without bytes left on disk, or nothing. */
export type LegacyStatus = 'held' | 'retired (bytes kept)' | 'purged' | 'none';

export class LegacyKey {
  readonly #state: () => EndpointState | null;
  readonly #org: () => string | null;
  #imported: { raw: string; key: Promise<OrgKey> } | null = null;

  /** `org` is the enrollment's org now (null when not enrolled). */
  constructor(state: () => EndpointState | null, org: () => string | null) {
    this.#state = state;
    this.#org = org;
  }

  /** Whether a key of the enrollment's org is held in use. */
  get held(): boolean {
    return this.#current() !== null;
  }

  /** Whether the org state retired the key: the enrollment's org's tombstone is held. */
  get retired(): boolean {
    const file = this.#file();
    return file !== null && 'retired' in file;
  }

  /** `legacy.json` when it is the enrollment's org's; one kept for another org is removed. */
  #file(): LegacyFile | null {
    const state = this.#state();
    const held = state?.legacyFile ?? null;
    const org = this.#org();
    if (state === null || held === null || org === null) return null;
    if (held.org === org) return held;
    try {
      state.removeLegacy();
    } catch {
      // a state that refuses writes keeps the file; the key is still not this org's
    }
    return null;
  }

  /** The key in use for the enrollment's org (no tombstone). */
  #current(): { org: string; key: string } | null {
    const file = this.#file();
    return file === null || 'retired' in file ? null : file;
  }

  /**
   * `legacy.json` made the head's (see the header); `first` when the head is the first this enrollment adopted. Answers
   * whether the file changed. Nothing when not enrolled, or for another org's head.
   */
  follow(head: OrgState, first: boolean): boolean {
    const state = this.#state();
    const org = this.#org();
    if (state === null || org === null || head.org !== org) return false;
    const file = this.#file();
    const mark = head.legacyRetired;
    if (mark !== undefined) {
      if (file !== null && 'retired' in file && file.retired === mark.at) return false;
      const key = file === null || first ? undefined : file.key;
      state.setLegacy({ org, retired: mark.at, ...(key === undefined ? {} : { key }) });
      return true;
    }
    if (file === null || !('retired' in file)) return false;
    if (file.key === undefined) state.removeLegacy();
    else state.setLegacy({ org, key: file.key });
    return true;
  }

  /** What is held of the key, and how many copies earlier enrollments left under `stale-<time>/`. */
  status(): { status: LegacyStatus; stale: number } {
    const state = this.#state();
    const file = this.#file() ?? state?.legacyFile ?? null;
    const stale = state?.staleLegacyCopies().length ?? 0;
    if (file === null) return { status: 'none', stale };
    if (!('retired' in file)) return { status: 'held', stale };
    return { status: file.key !== undefined || stale > 0 ? 'retired (bytes kept)' : 'purged', stale };
  }

  /**
   * Deletes the key's bytes for good (`legacy purge`), from the tombstone and every stale copy: refused while a key is
   * in use, since only the org state retires it. Answers the files it deleted the bytes from.
   */
  purge(): string[] {
    const state = this.#state();
    if (state === null) throw new Error('the endpoint has not started');
    if (state.legacy) throw new Error('the legacy org key is not retired by the org state: it is purged only after `deployment admin keys retire`');
    return state.purgeLegacy();
  }

  /**
   * Keeps the key sminos handed over (`legacy-key {org, key}`), when it is the enrollment's org's and 32 bytes, and the
   * org state hasn't retired it; what it was, as a word for the log (never the key).
   */
  take(frame: Record<string, unknown>, org: string): 'kept' | 'held' | 'retired' | 'other-org' | 'malformed' {
    const state = this.#state();
    if (state === null) return 'malformed';
    if (this.retired) return 'retired';
    if (this.#current() !== null) return 'held';
    if (frame.org !== org) return 'other-org';
    if (typeof frame.key !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(frame.key)) return 'malformed';
    try {
      if (base64urlDecode(frame.key).length !== 32) return 'malformed';
    } catch {
      return 'malformed';
    }
    state.setLegacy({ org, key: frame.key });
    return 'kept';
  }

  /** DX1's `mac` for an own event, already v2-signed (the mac covers the `sig`), or null with no key in use. */
  async mac(project: string, signed: Record<string, unknown>): Promise<Mac | null> {
    const key = await this.#key();
    if (key === null) return null;
    const sealed = await seal(key, 'log', project, signed, await deriveLogNonce(key, project, signed));
    return sealed.mac;
  }

  /** Whether a v1 event's DX1 code verifies under the key in use (false with none). */
  async verifies(project: string, event: object): Promise<boolean> {
    const key = await this.#key();
    return key !== null && verify(key, 'log', project, event);
  }

  async #key(): Promise<OrgKey | null> {
    const held = this.#current();
    if (held === null) {
      this.#imported = null;
      return null;
    }
    if (this.#imported?.raw !== held.key) this.#imported = { raw: held.key, key: importOrgKey(base64urlDecode(held.key)) };
    return this.#imported.key;
  }
}
