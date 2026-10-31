// P5 O4 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, U7: Interfaces §A, Decision Log D3 to D6): the machine's
// custody of route D's sealed OAuth grants, a software key the spine's process holds. Chromium's safeStorage (the
// Keychain) is out of reach of a plain-Node `mawsd`, and an unsigned build's Keychain grant is keyed by its code hash,
// so every rebuild would prompt again, under launchd on a screen no one may be watching; a key file prompts never and
// works on Linux unchanged. It is the class the device and machine keys already hold until signed builds exist (the
// remote layer's §5.1, src/main/device/keys.ts), and the Keychain can return behind the same sealer seam then.
//
// - The key: `<directory>/key`, 32 random bytes, mode 0600, this uid's, a regular file, in the 0700 directory (a wider
//   existing directory tightened, as the store does). It is made on first use only (a profile that never connects has
//   none), at a temporary name opened O_CREAT|O_EXCL|O_NOFOLLOW and linked into place, so a crash never leaves a short
//   key and two first uses at once keep one key. A key file of another mode, a link, another uid's, not a regular file
//   or not 32 bytes long is refused, never repaired or replaced: the custody fails closed (`available()` false, seal and
//   open throw) and every record under it stays unreadable until the owner looks.
// - Backups: the whole directory, key and records, leaves Time Machine (D5): a restored Mac reconnects, as it registers
//   its device keys afresh. The exclusion is set once, when this load makes the key, before the key is linked in, and
//   `key.excluded` records that it was set (no reader yet); a failed exclusion is logged and the key is made anyway.
// - The seal (D6): AES-256-GCM under a fresh 12-byte nonce, the connection id as associated data, so a file copied
//   under another id never opens; the bytes are nonce ‖ ciphertext ‖ tag (12, n, 16). Files carry format line 2.
// - A failure is not remembered: the next use reads the key again. A key once read is held for the custody's life,
//   which is one spine load.
import { constants } from 'node:fs';
import * as fsp from 'node:fs/promises';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { SEALED_FORMAT_V2, type ConnectorOAuthSealer } from '@shared/connectors/sealer';
import { excludeFromBackup } from '@shared/fs/backup-exclusion';

export { SEALED_FORMAT_V2 };
export const CUSTODY_KEY_FILE = 'key';
export const CUSTODY_EXCLUDED_MARKER = 'key.excluded';

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const ALGORITHM = 'aes-256-gcm';

// The part of node:fs/promises the custody uses: a test hands a double of it.
export type CustodyFs = Pick<typeof fsp, 'chmod' | 'link' | 'lstat' | 'mkdir' | 'open' | 'rm'>;

export type ConnectorCustodyRefusal = 'directory' | 'symlink' | 'owner' | 'not-a-file' | 'mode' | 'length';
// Fixed words: no path, no key material.
export class ConnectorCustodyError extends Error {
  constructor(readonly reason: ConnectorCustodyRefusal) {
    super(`connector custody key refused: ${reason}`);
    this.name = 'ConnectorCustodyError';
  }
}

export interface FileKeyCustodyOptions {
  // True once set, false where there is nothing to exclude from (off macOS); rejects when it could not be set.
  excludeFromBackup?: (path: string) => Promise<boolean>;
  fs?: CustodyFs;
}

export function fileKeyCustody(directory: string, options: FileKeyCustodyOptions = {}): ConnectorOAuthSealer {
  const fs = options.fs ?? fsp;
  const exclude = options.excludeFromBackup ?? excludeFromBackup;
  const uid = process.getuid?.();
  const keyFile = join(directory, CUSTODY_KEY_FILE);
  let held: Promise<Buffer> | null = null;

  const key = (): Promise<Buffer> => {
    held ??= loadOrCreate().catch((error: unknown) => {
      held = null;
      throw error;
    });
    return held;
  };

  async function loadOrCreate(): Promise<Buffer> {
    await privateDirectory();
    const existing = await readKey();
    if (existing !== null) return existing;
    const excluded = await exclude(directory).catch((error: unknown) => {
      console.warn(`[connectors] could not exclude the OAuth custody directory from Time Machine: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    });
    if ((await createKey()) && excluded) await markExcluded();
    const created = await readKey(); // whichever first use linked its key, every use reads that one
    if (created === null) throw new ConnectorCustodyError('length');
    return created;
  }

  async function privateDirectory(): Promise<void> {
    let info;
    try {
      await fs.mkdir(directory, { recursive: true, mode: DIRECTORY_MODE });
      info = await fs.lstat(directory);
    } catch {
      throw new ConnectorCustodyError('directory');
    }
    if (info.isSymbolicLink()) throw new ConnectorCustodyError('symlink');
    if (!info.isDirectory()) throw new ConnectorCustodyError('directory');
    if (uid !== undefined && info.uid !== uid) throw new ConnectorCustodyError('owner');
    if ((info.mode & 0o077) !== 0) await fs.chmod(directory, info.mode & DIRECTORY_MODE);
  }

  // The key, checked on the descriptor it is read from (no link followed, no FIFO waited on); null when there is none.
  async function readKey(): Promise<Buffer | null> {
    let handle: fsp.FileHandle;
    try {
      handle = await fs.open(keyFile, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return null;
      if (code === 'ELOOP') throw new ConnectorCustodyError('symlink');
      if (code === 'EACCES' || code === 'EPERM') throw new ConnectorCustodyError('mode');
      throw new ConnectorCustodyError('not-a-file');
    }
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new ConnectorCustodyError('not-a-file');
      if (uid !== undefined && info.uid !== uid) throw new ConnectorCustodyError('owner');
      if ((info.mode & 0o777) !== FILE_MODE) throw new ConnectorCustodyError('mode');
      if (info.size !== KEY_BYTES) throw new ConnectorCustodyError('length');
      const bytes = Buffer.alloc(KEY_BYTES + 1);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      if (bytesRead !== KEY_BYTES) throw new ConnectorCustodyError('length');
      return bytes.subarray(0, KEY_BYTES);
    } finally {
      await handle.close();
    }
  }

  // Whether this use's key was linked into place (false: another first use's stands).
  async function createKey(): Promise<boolean> {
    const temporary = join(directory, `.key-${process.pid}-${randomUUID()}`);
    try {
      const handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, FILE_MODE);
      try {
        await handle.chmod(FILE_MODE); // whatever the umask
        await handle.writeFile(randomBytes(KEY_BYTES));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.link(temporary, keyFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    } finally {
      await fs.rm(temporary, { force: true });
    }
    await syncDirectory();
    return true;
  }

  async function markExcluded(): Promise<void> {
    try {
      const handle = await fs.open(join(directory, CUSTODY_EXCLUDED_MARKER), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, FILE_MODE);
      try {
        await handle.writeFile('the directory was excluded from Time Machine before the key was made\n');
      } finally {
        await handle.close();
      }
    } catch {
      // a record with no reader: its absence only claims nothing
    }
  }

  async function syncDirectory(): Promise<void> {
    const handle = await fs.open(directory, constants.O_RDONLY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  const associated = (id: string) => Buffer.from(id, 'utf8');

  return {
    format: SEALED_FORMAT_V2,
    async available() {
      try {
        await key();
        return true;
      } catch {
        return false;
      }
    },
    async seal(text, id) {
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv(ALGORITHM, await key(), nonce, { authTagLength: TAG_BYTES });
      cipher.setAAD(associated(id));
      return Buffer.concat([nonce, cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    },
    async open(sealed, id) {
      const secret = await key();
      if (sealed.length < NONCE_BYTES + TAG_BYTES) throw new Error('sealed record too short');
      const decipher = createDecipheriv(ALGORITHM, secret, sealed.subarray(0, NONCE_BYTES), { authTagLength: TAG_BYTES });
      decipher.setAAD(associated(id));
      decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
      const text = Buffer.concat([decipher.update(sealed.subarray(NONCE_BYTES, sealed.length - TAG_BYTES)), decipher.final()]).toString('utf8');
      return { text, reseal: false };
    },
  };
}
