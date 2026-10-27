// The DX1 org key (O10 M6; RL §9: dual-coding until the org key retires). Outbound events carry the v2 signature and
// DX1's `mac` (over the event with its `sig`), so machines not yet moved can read them; a v1-only event from one of them
// verifies under the same key. The key is handed over once: at an RL10 hello on an endpoint that holds no
// `legacy.json`, the endpoint asks for it (`legacy-key?`), sminos answers from its `hub.json` when the org matches, and
// the endpoint keeps it at 0600, until O14's final brief deletes it (`mawsd endpoint legacy retire`). With no key, events
// go out v2-only and legacy events can't be checked. The key is in no log line and no frame but sminos's answer. A key
// kept for another org than the enrollment's (the machine moved) is no key: it is removed when next read, and the new
// org's is asked for.
import { base64urlDecode, deriveLogNonce, importOrgKey, seal, verify, type OrgKey } from 'desk-hub/protocol';
import type { EndpointState } from '../state/store';

export type Mac = { nonce: string; value: string };

export class LegacyKey {
  readonly #state: () => EndpointState | null;
  readonly #org: () => string | null;
  #imported: { raw: string; key: Promise<OrgKey> } | null = null;

  /** `org` is the enrollment's org now (null when not enrolled). */
  constructor(state: () => EndpointState | null, org: () => string | null) {
    this.#state = state;
    this.#org = org;
  }

  /** Whether a key of the enrollment's org is held. */
  get held(): boolean {
    return this.#current() !== null;
  }

  /** The key held for the enrollment's org; one kept for another org is removed. */
  #current(): { org: string; key: string } | null {
    const state = this.#state();
    const held = state?.legacyKey ?? null;
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

  /**
   * Keeps the key sminos handed over (`legacy-key {org, key}`), when it is the enrollment's org's and 32 bytes; what it
   * was, as a word for the log (never the key).
   */
  take(frame: Record<string, unknown>, org: string): 'kept' | 'held' | 'other-org' | 'malformed' {
    const state = this.#state();
    if (state === null) return 'malformed';
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

  /** DX1's `mac` for an own event, already v2-signed (the mac covers the `sig`), or null with no key held. */
  async mac(project: string, signed: Record<string, unknown>): Promise<Mac | null> {
    const key = await this.#key();
    if (key === null) return null;
    const sealed = await seal(key, 'log', project, signed, await deriveLogNonce(key, project, signed));
    return sealed.mac;
  }

  /** Whether a v1 event's DX1 code verifies under the held key (false with none). */
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
