// A channel entry's id as it leaves the endpoint (P5 O8 M7b fix wave, R5): the journal's id is table-wide (an SQLite row
// id across every project), so handed out as it is it shows the gaps other projects' and hidden sessions' entries leave,
// and a `before` naming any id is an oracle for whether that entry exists. Every entry a member is given (history's,
// the feed's) carries an opaque cursor instead, which `channel.history` takes back as its `before`.
//
// A cursor is sealed deterministically (SIV): its nonce is an HMAC-SHA256 of the project and the plaintext under one half
// of the key, and the plaintext (the journal id, the entry's lane and its session's id) is sealed with AES-256-GCM
// under the other half, the project as associated data. The same entry always seals to the same cursor, so a device
// dedupes the feed's entries against history's by it, across restarts; a cursor opens only for its own project, and
// nothing the endpoint did not seal opens at all. The session it carries lets a `before` be ranked (a member pages only
// from an entry they view) without a read of the journal.
//
// The key is 64 random bytes, `cursor-key` in the endpoint's state (its `channel/` subdirectory, 0600), made at the first
// seal and kept: never in the journal, which the machine's other readers hold.
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { HostEntry } from '@shared/ipc/schema/channel';
import { readPrivateText, writeAtomic } from './state/files';

/** What a cursor names: its entry's journal id, and the entry's lane and session (lane A's engine session, lane B's app session). */
export type CursorAt = { id: string; lane: 'A' | 'B'; session: string };

const KEY_FILE = 'cursor-key';
const NONCE = 12;
const TAG = 16;
/** A cursor's plaintext is at most a journal id, a lane and a session id (512): one longer is none sealed here. */
const CURSOR_MAX = 1024;

export class ChannelCursors {
  readonly #dir: () => string;
  #key: { seal: Buffer; nonce: Buffer } | null = null;

  /** `dir`: the endpoint's state subdirectory the key is kept in (throws while there is none). */
  constructor(dir: () => string) {
    this.#dir = dir;
  }

  /** `entry`'s cursor. */
  seal(entry: HostEntry): string {
    const session = (entry.lane === 'A' ? entry.engineSessionId : entry.appSessionId) ?? '';
    const plain = Buffer.from(`${entry.id}\n${entry.lane}\n${session}`, 'utf8');
    const key = this.#keys();
    const nonce = this.#nonce(key, entry.project, plain);
    const cipher = createCipheriv('aes-256-gcm', key.seal, nonce);
    cipher.setAAD(Buffer.from(entry.project, 'utf8'));
    const sealed = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([nonce, sealed, cipher.getAuthTag()]).toString('base64url');
  }

  /** What `cursor` names, when this endpoint sealed it for `project`; else null. */
  open(cursor: string, project: string): CursorAt | null {
    if (cursor.length > CURSOR_MAX || !/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
    const bytes = Buffer.from(cursor, 'base64url');
    if (bytes.length <= NONCE + TAG) return null;
    const key = this.#keys();
    const nonce = bytes.subarray(0, NONCE);
    let plain: Buffer;
    try {
      const decipher = createDecipheriv('aes-256-gcm', key.seal, nonce);
      decipher.setAAD(Buffer.from(project, 'utf8'));
      decipher.setAuthTag(bytes.subarray(bytes.length - TAG));
      plain = Buffer.concat([decipher.update(bytes.subarray(NONCE, bytes.length - TAG)), decipher.final()]);
    } catch {
      return null;
    }
    if (!this.#nonce(key, project, plain).equals(nonce)) return null;
    const [id, lane, session, ...rest] = plain.toString('utf8').split('\n');
    if (rest.length > 0 || (lane !== 'A' && lane !== 'B') || id === '' || session === undefined) return null;
    return { id, lane, session };
  }

  #nonce(key: { nonce: Buffer }, project: string, plain: Buffer): Buffer {
    return createHmac('sha256', key.nonce).update(project, 'utf8').update(Buffer.of(0)).update(plain).digest().subarray(0, NONCE);
  }

  #keys(): { seal: Buffer; nonce: Buffer } {
    if (this.#key !== null) return this.#key;
    const dir = this.#dir();
    let text = readPrivateText(join(dir, KEY_FILE));
    if (text === null) {
      text = randomBytes(64).toString('base64');
      writeAtomic(dir, KEY_FILE, text);
    }
    const bytes = Buffer.from(text.trim(), 'base64');
    if (bytes.length !== 64) throw new Error(`the channel's cursor key (${join(dir, KEY_FILE)}) is not 64 bytes`);
    this.#key = { seal: bytes.subarray(0, 32), nonce: bytes.subarray(32) };
    return this.#key;
  }
}
