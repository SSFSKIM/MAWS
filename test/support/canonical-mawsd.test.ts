// The packaged daemon-shape check's watch on the account's canonical mawsd (O14 residue 18; e2e/support/canonical-mawsd.ts):
// which differences between two snapshots count. A live canonical mawsd's own writes (its logs and out files and their
// rotations, O10's endpoint state, its directories' mtimes) never do; anything else the job could cause always does.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DAEMON_FILES } from '@shared/daemon/files';
import { SUPERVISOR_FILES } from '../../src/engine-host/supervisor-files';
import { canonicalDifferences, snapshotCanonical, type CanonicalSnapshot, type Entry } from '../../e2e/support/canonical-mawsd';

const file = (mtimeMs = 1, ino = 10): Entry => ({ kind: 'file', ino, mtimeMs });
const dir = (mtimeMs = 1, ino = 20): Entry => ({ kind: 'dir', ino, mtimeMs });
const socket = (mtimeMs = 1, ino = 30): Entry => ({ kind: 'socket', ino, mtimeMs });
const SOCK = '/Users/u/Library/Application Support/MAWS/mawsd/machine.sock';
const FALLBACK = '/var/folders/x/T/maws-mawsd-0123456789ab/machine.sock';

function live(over: Partial<Record<string, Entry>> = {}, extra: Partial<CanonicalSnapshot> = {}): CanonicalSnapshot {
  const profile: Record<string, Entry> = {
    '.': dir(), 'mawsd.lock': file(), 'mawsd.token': file(), 'mawsd.log': file(), 'mawsd.out': file(), 'machine.sock': socket(),
    endpoint: dir(), 'endpoint/state.json': file(), 'pty-host': dir(), 'pty-host/host.log': file(), 'pty-host/host.lock': file(), bin: dir(), 'bin/mawsd': file(),
  };
  for (const [rel, entry] of Object.entries(over)) {
    if (entry === undefined) delete profile[rel];
    else profile[rel] = entry;
  }
  return { plist: { text: '<plist/>', mtimeMs: 1 }, sockets: { [SOCK]: socket(), [FALLBACK]: null }, profile, ...extra };
}

describe('canonicalDifferences', () => {
  it('nothing changed: no difference', () => {
    expect(canonicalDifferences(live(), live())).toEqual([]);
  });

  it('a live canonical mawsd writing its own logs, out file, endpoint state and their directories is no difference', () => {
    const after = live({
      '.': dir(2), 'mawsd.log': file(2), 'mawsd.out': file(2), 'mawsd.log.1': file(2), // a first rotation
      'pty-host': dir(2), 'pty-host/host.log': file(2), endpoint: dir(2), 'endpoint/state.json': file(2), 'endpoint/new.json': file(2),
    });
    expect(canonicalDifferences(live(), after)).toEqual([]);
    expect(canonicalDifferences(live({ 'endpoint/state.json': undefined }), live())).toEqual([]); // below endpoint/, names too
  });

  it('every log name the daemon and its hosts write is one whose mtime is theirs', () => {
    for (const name of [DAEMON_FILES.log, DAEMON_FILES.out, SUPERVISOR_FILES.log, `${DAEMON_FILES.log}.1`]) {
      expect(canonicalDifferences(live({ [name]: file(1) }), live({ [name]: file(2) })), name).toEqual([]);
    }
  });

  it('any other entry rewritten, created or removed counts, and so does endpoint itself', () => {
    expect(canonicalDifferences(live(), live({ 'mawsd.token': file(2) }))).toEqual(['mawsd/mawsd.token was rewritten']);
    expect(canonicalDifferences(live(), live({ 'pty-host/host.lock': file(2) }))).toEqual(['mawsd/pty-host/host.lock was rewritten']);
    expect(canonicalDifferences(live(), live({ 'engine-host.sock': socket() }))).toEqual(['mawsd/engine-host.sock appeared']);
    expect(canonicalDifferences(live(), live({ 'bin/mawsd': undefined }))).toEqual(['mawsd/bin/mawsd was removed']);
    expect(canonicalDifferences(live(), live({ endpoint: undefined }))).toEqual(['mawsd/endpoint was removed']);
    expect(canonicalDifferences(live(), live({ 'mawsd.lock': dir() }))).toEqual(['mawsd/mawsd.lock changed from a file to a dir']);
  });

  it('the plist, each socket path (in mawsd/ or the fallback) and the tree as a whole count whether or not they existed', () => {
    expect(canonicalDifferences(live({}, { plist: null }), live())).toEqual(['the plist appeared']);
    expect(canonicalDifferences(live(), live({}, { plist: { text: '<plist changed/>', mtimeMs: 1 } }))).toEqual(['the plist changed']);
    expect(canonicalDifferences(live(), live({}, { sockets: { [SOCK]: socket(1, 31), [FALLBACK]: null } }))).toEqual([`${SOCK} changed`]);
    expect(canonicalDifferences(live(), live({}, { sockets: { [SOCK]: socket(), [FALLBACK]: socket() } }))).toEqual([`${FALLBACK} appeared`]);
    expect(canonicalDifferences(live({}, { profile: null }), live({}, { profile: null }))).toEqual([]);
    expect(canonicalDifferences(live({}, { profile: null }), live())).toEqual(['the profile\'s mawsd/ appeared']);
  });
});

describe('snapshotCanonical', () => {
  let root: string | null = null;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = null;
  });

  it('records absent paths as null, walks the tree without entering endpoint/ or following links', () => {
    root = mkdtempSync(join(tmpdir(), 'maws-canonical-'));
    const mawsd = join(root, 'MAWS', 'mawsd');
    const paths = { plist: join(root, 'dev.maws.mawsd.plist'), sockets: [join(mawsd, 'machine.sock')], profileMawsd: mawsd };
    expect(snapshotCanonical(paths)).toEqual({ plist: null, sockets: { [join(mawsd, 'machine.sock')]: null }, profile: null });

    mkdirSync(join(mawsd, 'endpoint', 'deep'), { recursive: true });
    writeFileSync(join(mawsd, 'endpoint', 'state.json'), '{}');
    writeFileSync(join(mawsd, 'mawsd.lock'), '{}');
    mkdirSync(join(root, 'elsewhere'));
    writeFileSync(join(root, 'elsewhere', 'secret'), 'x');
    symlinkSync(join(root, 'elsewhere'), join(mawsd, 'link'));
    const snapshot = snapshotCanonical(paths);
    expect(Object.keys(snapshot.profile!).sort()).toEqual(['.', 'endpoint', 'link', 'mawsd.lock']);
    expect(snapshot.profile!.link!.kind).toBe('link');
    expect(canonicalDifferences(snapshot, snapshotCanonical(paths))).toEqual([]);
  });
});
