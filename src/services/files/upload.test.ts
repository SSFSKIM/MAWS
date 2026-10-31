// `files.upload` (P5 O3-E M3, docs/doperpowers/plans/2026-10-30-p5-o3-e-checkout.md, Interfaces §F; D7; acceptance 5):
// bounded bytes written into a session's attachments directory with lane A's rules, refusals as values with nothing
// written, the root recorded before the first byte and swept a day after its last upload. Scratch directories only
// (realpath'd: the system temp root is itself a link on macOS), never a real repository or `~`.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { REMOTE_UPLOAD_PART_BYTES, UPLOAD_FILE_MAX_BYTES, type FilesUploadInput, type UploadPart } from '@shared/ipc/schema/files';
import { validateCommandInput } from '@shared/ipc/validate';
import type { SetupIntent } from '@shared/sessions/intent';
import { record as sessionRecord } from '../../../test/support/builders';
import { fakeSpineView } from '../../../test/support/fake-spine-view';
import { GitFixture } from '../../../test/support/git-fixture';
import { EXCLUDE_LINE, type UploadRecords } from '../fs/upload-roots';
import { createGitRunner } from '../git/runner';
import { createUpload, scheduleUploadSweep, UPLOAD_SWEEP_MS, uploadRootsOf, type UploadDeps } from './upload';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PDF = Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1');
const TEXT = Buffer.from('hello\n');
const ID = 'c6bb8a7b-7b58-44c4-a0fa-01314e461f36' as AppSessionId;

const scratch: string[] = [];
const fixtures: GitFixture[] = [];
const dir = (prefix = 'o3e-upload-') => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  scratch.push(d);
  return d;
};
afterEach(() => {
  vi.useRealTimers();
  for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true });
  for (const f of fixtures.splice(0)) f.dispose();
});
async function repo(): Promise<GitFixture> {
  const f = await GitFixture.create();
  fixtures.push(f);
  return f;
}

const file = (name: string, bytes: Buffer) => ({ name, bytes: bytes.toString('base64') });
const input = (...files: { name: string; bytes: string }[]): FilesUploadInput => ({ appSessionId: ID, files });
const rootIn = (base: string) => join(base, '.claude', 'desk-uploads', ID);
const noGit = () => createGitRunner({ env: { PATH: process.env.PATH, HOME: dir() } });

// A record whose calls are kept, each with what its root held when it was made
function keptRecords() {
  const recorded: { session: string; root: string; held: string[] | null }[] = [];
  const records: UploadRecords = {
    record: (session, root) => void recorded.push({ session, root, held: existsSync(root) ? readdirSync(root) : null }),
    sweep: () => 0,
  };
  return { records, recorded };
}

function upload(over: Partial<UploadDeps> & { directory?: string; worktree?: string } = {}) {
  const { directory, worktree, ...deps } = over;
  const sessions = deps.sessions ?? fakeSpineView({ records: directory === undefined ? [] : [sessionRecord(ID, { directory, worktree: worktree === undefined ? null : { path: worktree, branch: 'wt' } })] });
  const kept = keptRecords();
  const log = vi.fn<(line: string) => void>();
  return { run: createUpload({ sessions, roots: kept.records, git: noGit(), mint: () => 'up1', log, ...deps }), recorded: kept.recorded, log };
}

describe('files.upload writes', () => {
  it('each file under <working directory>/.claude/desk-uploads/<appSessionId>/, 0600 in 0700 directories, the root recorded before the first byte, and answers the absolute paths in input order', async () => {
    const base = dir();
    const { run, recorded } = upload({ directory: base });
    const root = rootIn(base);
    expect(await run(input(file('shot.png', PNG), file('notes.txt', TEXT)))).toEqual({ status: 'ok', paths: [join(root, 'up1.0.png'), join(root, 'up1.1.txt')] });
    expect(readFileSync(join(root, 'up1.0.png')).equals(PNG)).toBe(true);
    expect(readFileSync(join(root, 'up1.1.txt'), 'utf8')).toBe('hello\n');
    expect(statSync(join(root, 'up1.0.png')).mode & 0o777).toBe(0o600);
    expect(statSync(join(root, 'up1.1.txt')).mode & 0o777).toBe(0o600);
    for (const d of [join(base, '.claude'), join(base, '.claude', 'desk-uploads'), root]) expect(statSync(d).mode & 0o777, d).toBe(0o700);
    expect(recorded).toEqual([{ session: ID, root, held: null }]); // before the directory, so before any byte
  });

  it('names a PNG, a JPEG and a PDF by their signature, a text file by its name, and a file with no usable extension by none', async () => {
    const base = dir();
    const { run } = upload({ directory: base });
    const root = rootIn(base);
    const answer = await run(input(
      file('screenshot', PNG), // the signature wins over a missing name extension
      file('photo.jpeg', JPEG), // and over the name's spelling
      file('paper.txt', PDF), // and over a wrong one
      file('Notes.TXT', TEXT), // the name's extension, lowercased
      file('Makefile', TEXT), // none
      file('archive.tar-gz', TEXT), // not letters and digits alone: none
      file('a.abcdefghijklmnopq', TEXT), // 17 characters: none
      file('', Buffer.alloc(0)), // an empty file with no name
    ));
    expect(answer).toEqual({ status: 'ok', paths: ['up1.0.png', 'up1.1.jpg', 'up1.2.pdf', 'up1.3.txt', 'up1.4', 'up1.5', 'up1.6', 'up1.7'].map((name) => join(root, name)) });
    expect(readFileSync(join(root, 'up1.7')).length).toBe(0);
  });

  it('under the worktree when the session runs in one, and under its setup intent’s location before its first send', async () => {
    const [checkout, worktree] = [dir(), dir()];
    const inWorktree = upload({ directory: checkout, worktree });
    expect(await inWorktree.run(input(file('a.txt', TEXT)))).toEqual({ status: 'ok', paths: [join(rootIn(worktree), 'up1.0.txt')] });
    expect(existsSync(join(checkout, '.claude'))).toBe(false);

    const project = dir();
    const intent = { appSessionId: ID, location: { kind: 'directory', path: project }, additionalDirectories: [], progress: { worktree: null } } as unknown as SetupIntent;
    const unstarted = upload({ sessions: fakeSpineView({ intents: [intent] }) });
    expect(await unstarted.run(input(file('a.txt', TEXT)))).toEqual({ status: 'ok', paths: [join(rootIn(project), 'up1.0.txt')] });
  });

  it('resolves the working directory first, as lane A resolves its bridge’s: a link above it is the session’s own spelling', async () => {
    const real = dir();
    const spelled = join(dir(), 'via');
    symlinkSync(real, spelled);
    const { run } = upload({ directory: spelled });
    expect(await run(input(file('a.txt', TEXT)))).toEqual({ status: 'ok', paths: [join(rootIn(real), 'up1.0.txt')] });
  });

  it('excludes the directory by the repository’s info/exclude, so git status stays clean', async () => {
    const f = await repo();
    const { run } = upload({ directory: f.root, git: createGitRunner({ env: f.serviceEnv() }) });
    expect(await f.git('status', '--porcelain', '--untracked-files=all')).toBe('');
    expect(await run(input(file('a.png', PNG), file('b.txt', TEXT)))).toMatchObject({ status: 'ok' });
    expect(readFileSync(join(f.root, '.git', 'info', 'exclude'), 'utf8').split('\n')).toContain(EXCLUDE_LINE);
    expect(await f.git('status', '--porcelain', '--untracked-files=all')).toBe('');
  });

  it('writes outside a repository with no exclude line, and says so in the log', async () => {
    const base = dir();
    const { run, log } = upload({ directory: base });
    expect(await run(input(file('a.txt', TEXT)))).toMatchObject({ status: 'ok' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('is in no repository'));
  });
});

describe('files.upload refuses, with nothing written', () => {
  const nothingUnder = (base: string) => expect(existsSync(join(base, '.claude')), 'nothing written').toBe(false);

  it('an unknown session, a session with no working directory, and a name with a path separator', async () => {
    expect(await upload().run(input(file('a.txt', TEXT)))).toEqual({ status: 'refused', reason: `unknown app session: ${ID}` });
    const unchosen = { appSessionId: ID, location: null, additionalDirectories: [], progress: { worktree: null } } as unknown as SetupIntent;
    expect(await upload({ sessions: fakeSpineView({ intents: [unchosen] }) }).run(input(file('a.txt', TEXT)))).toEqual({ status: 'refused', reason: 'the session has no working directory' });
    const base = dir();
    const { run, recorded } = upload({ directory: base });
    for (const name of ['sub/a.txt', 'sub\\a.txt']) expect(await run(input(file('ok.txt', TEXT), file(name, TEXT)))).toEqual({ status: 'refused', reason: `${name} has a path separator` });
    nothingUnder(base);
    expect(recorded).toEqual([]);
  });

  it('a working directory that is gone', async () => {
    const base = join(dir(), 'gone');
    expect(await upload({ directory: base }).run(input(file('a.txt', TEXT)))).toMatchObject({ status: 'refused', reason: expect.stringContaining('working directory could not be read') });
  });

  it('a link at .claude, at desk-uploads or at the session’s directory, writing nothing through it, on the walk of each platform', async () => {
    const plants: [string, (base: string, elsewhere: string) => void][] = [
      ['.claude', (base, elsewhere) => symlinkSync(elsewhere, join(base, '.claude'))],
      ['desk-uploads', (base, elsewhere) => (mkdirSync(join(base, '.claude')), symlinkSync(elsewhere, join(base, '.claude', 'desk-uploads')))],
      ['the session’s directory', (base, elsewhere) => (mkdirSync(join(base, '.claude', 'desk-uploads'), { recursive: true }), symlinkSync(elsewhere, rootIn(base)))],
    ];
    for (const load of [() => import('./upload'), portableUpload]) {
      const { createUpload: create } = await load();
      for (const [where, plant] of plants) {
        const [base, elsewhere] = [dir(), dir('o3e-elsewhere-')];
        plant(base, elsewhere);
        const run = create({ sessions: fakeSpineView({ records: [sessionRecord(ID, { directory: base })] }), roots: keptRecords().records, git: noGit(), mint: () => 'up1', log: () => {} });
        expect(await run(input(file('a.txt', TEXT))), where).toMatchObject({ status: 'refused', reason: expect.stringContaining('a path on the way is a link') });
        expect(readdirSync(elsewhere), where).toEqual([]);
      }
    }
  });

  it('a link at a file’s own name, as a name already there, following it nowhere', async () => {
    const base = dir();
    const target = join(dir('o3e-elsewhere-'), 'target');
    writeFileSync(target, 'kept');
    mkdirSync(rootIn(base), { recursive: true });
    symlinkSync(target, join(rootIn(base), 'up1.0.txt'));
    expect(await upload({ directory: base }).run(input(file('a.txt', TEXT)))).toEqual({ status: 'refused', reason: 'up1.0.txt is already there' });
    expect(readFileSync(target, 'utf8')).toBe('kept');
  });

  it('a name already there, taking back the files this call made (a text file, an extensionless one) and nothing else', async () => {
    const base = dir();
    const root = rootIn(base);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'up1.2.png'), 'someone else’s');
    writeFileSync(join(root, 'notes.md'), 'unrelated');
    const { run } = upload({ directory: base });
    expect(await run(input(file('a.txt', TEXT), file('Makefile', TEXT), file('c.png', PNG)))).toEqual({ status: 'refused', reason: 'up1.2.png is already there' });
    expect(readdirSync(root).sort()).toEqual(['notes.md', 'up1.2.png']);
    expect(readFileSync(join(root, 'up1.2.png'), 'utf8')).toBe('someone else’s');
  });

  it('a second call with the same upload id, keeping the first call’s files', async () => {
    const base = dir();
    const { run } = upload({ directory: base });
    expect(await run(input(file('a.png', PNG)))).toMatchObject({ status: 'ok' });
    expect(await run(input(file('b.png', PNG)))).toEqual({ status: 'refused', reason: 'up1.0.png is already there' });
    expect(readdirSync(rootIn(base))).toEqual(['up1.0.png']);
    expect(readFileSync(join(rootIn(base), 'up1.0.png')).equals(PNG)).toBe(true);
  });

  it('a linked exclude, writing nothing', async () => {
    const f = await repo();
    const target = join(dir(), 'target');
    writeFileSync(target, 'kept\n');
    rmSync(join(f.root, '.git', 'info', 'exclude'), { force: true });
    symlinkSync(target, join(f.root, '.git', 'info', 'exclude'));
    const { run } = upload({ directory: f.root, git: createGitRunner({ env: f.serviceEnv() }) });
    expect(await run(input(file('a.txt', TEXT)))).toMatchObject({ status: 'refused', reason: expect.stringContaining('info/exclude') });
    expect(readFileSync(target, 'utf8')).toBe('kept\n');
    expect(existsSync(rootIn(f.root))).toBe(false);
  });

  it('a root that cannot be recorded, writing nothing', async () => {
    const base = dir();
    const roots: UploadRecords = { record: () => { throw new Error('disk full'); }, sweep: () => 0 };
    expect(await upload({ directory: base, roots }).run(input(file('a.txt', TEXT)))).toEqual({ status: 'refused', reason: 'the upload could not be recorded (disk full), so nothing was saved' });
    nothingUnder(base);
  });
});

describe('the upload roots’ record and its sweep', () => {
  it('records under its own file and sweeps a root a day after its last upload: indices 0 to 7 of every extension and none, nothing else', async () => {
    const data = dir();
    let now = Date.parse('2026-10-30T10:00:00Z');
    const roots = uploadRootsOf(join(data, 'sessions', 'uploads.json'), { now: () => now, log: () => {} });
    const base = dir();
    const run = createUpload({ sessions: fakeSpineView({ records: [sessionRecord(ID, { directory: base })] }), roots, git: noGit(), mint: () => 'up1', log: () => {} });
    expect(await run(input(file('a.png', PNG), file('b.txt', TEXT), file('Makefile', TEXT), ...Array.from({ length: 5 }, (_, n) => file(`f${n}.csv`, TEXT))))).toMatchObject({ status: 'ok' });
    const root = rootIn(base);
    for (const other of ['notes.md', 'up1.8.png', 'up1.0.TXT', 'up1.0.png.bak']) writeFileSync(join(root, other), 'not the upload’s');
    expect(JSON.parse(readFileSync(join(data, 'sessions', 'uploads.json'), 'utf8'))).toEqual({ version: 1, roots: [{ path: root, session: ID, at: '2026-10-30T10:00:00.000Z' }] });

    now += 23 * 3600_000;
    expect(roots.sweep()).toBe(0);
    expect(readdirSync(root)).toHaveLength(12);
    now += 3600_000;
    roots.sweep();
    expect(readdirSync(root).sort()).toEqual(['notes.md', 'up1.0.TXT', 'up1.0.png.bak', 'up1.8.png']);
  });

  it('runs the sweep once at the start, then every hour, until stopped', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setImmediate', 'clearImmediate'] });
    const sweep = vi.fn(() => 0);
    const stop = scheduleUploadSweep({ record: () => {}, sweep }, { log: () => {} });
    expect(sweep).not.toHaveBeenCalled(); // not inside the start
    vi.advanceTimersByTime(0);
    expect(sweep).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(UPLOAD_SWEEP_MS);
    expect(sweep).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(UPLOAD_SWEEP_MS);
    expect(sweep).toHaveBeenCalledTimes(3);
    stop();
    vi.advanceTimersByTime(3 * UPLOAD_SWEEP_MS);
    expect(sweep).toHaveBeenCalledTimes(3);
    expect(UPLOAD_SWEEP_MS).toBe(3600_000);
  });

  it('logs a sweep that removed roots, and one that threw, and keeps its schedule', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setImmediate', 'clearImmediate'] });
    const log = vi.fn<(line: string) => void>();
    const sweep = vi.fn().mockReturnValueOnce(2).mockImplementationOnce(() => { throw new Error('unreadable'); }).mockReturnValue(0);
    const stop = scheduleUploadSweep({ record: () => {}, sweep }, { log });
    vi.advanceTimersByTime(2 * UPLOAD_SWEEP_MS);
    expect(log.mock.calls.map(([line]) => line)).toEqual([expect.stringContaining('swept 2 upload roots'), expect.stringContaining('unreadable')]);
    vi.advanceTimersByTime(UPLOAD_SWEEP_MS);
    expect(sweep).toHaveBeenCalledTimes(4);
    stop();
  });

  it('starts empty from a missing file', () => {
    expect(uploadRootsOf(join(dir(), 'none.json'), { log: () => {} }).sweep()).toBe(0);
  });
});

// P5 O7 M4 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Uploads in parts", Interfaces §O): an upload
// from another machine, one file in parts of 2 MiB, each its own act; staged in order and moved into place at the last.
describe('files.upload in parts', () => {
  const UPLOAD = 'remoteUpload000000000A'; // the sender's id for the upload (22 base64url characters, as it mints them)
  const PART = REMOTE_UPLOAD_PART_BYTES;
  // `size` bytes that begin as a PDF, each byte position-dependent, so a part out of place shows
  const whole = (size: number) => {
    const bytes = Buffer.alloc(size);
    for (let i = 0; i < size; i++) bytes[i] = (i * 31 + (i >> 11)) & 0xff;
    PDF.copy(bytes);
    return bytes;
  };
  const partOf = (bytes: Buffer, index: number, last: boolean, upload = UPLOAD): FilesUploadInput & { part: UploadPart } => ({
    appSessionId: ID,
    part: { upload, index, last },
    files: [file('paper.pdf', bytes.subarray(index * PART, Math.min(bytes.length, (index + 1) * PART)))],
  });
  const stagingIn = (base: string) => join(rootIn(base), '.staging');

  it('stages each part in order under <root>/.staging/<upload>, 0600 in 0700, and moves the whole into place at the last, which alone answers its path', async () => {
    const base = dir();
    const { run, recorded } = upload({ directory: base });
    const bytes = whole(5 * 1024 * 1024); // three parts: 2, 2 and 1 MiB
    expect(await run(partOf(bytes, 0, false))).toEqual({ status: 'ok', paths: [] });
    const staged = join(stagingIn(base), UPLOAD);
    expect(statSync(staged).size).toBe(PART);
    expect(statSync(staged).mode & 0o777).toBe(0o600);
    expect(statSync(stagingIn(base)).mode & 0o777).toBe(0o700);
    expect(readdirSync(rootIn(base))).toEqual(['.staging']); // nothing in place before the last part
    expect(await run(partOf(bytes, 1, false))).toEqual({ status: 'ok', paths: [] });
    expect(await run(partOf(bytes, 2, true))).toEqual({ status: 'ok', paths: [join(rootIn(base), 'up1.0.pdf')] }); // named by part 0's signature
    expect(readFileSync(join(rootIn(base), 'up1.0.pdf')).equals(bytes)).toBe(true);
    expect(statSync(join(rootIn(base), 'up1.0.pdf')).mode & 0o777).toBe(0o600);
    expect(readdirSync(rootIn(base))).toEqual(['up1.0.pdf']); // the staging and its directory gone
    expect(recorded.map((r) => r.root)).toEqual([rootIn(base), rootIn(base), rootIn(base)]); // each part keeps the root's record fresh
  });

  it('takes a file of one part, and an empty last part after a whole one', async () => {
    const base = dir();
    const { run } = upload({ directory: base, mint: (() => { let n = 0; return () => `up${(n += 1)}`; })() });
    expect(await run({ appSessionId: ID, part: { upload: UPLOAD, index: 0, last: true }, files: [file('notes.txt', TEXT)] })).toEqual({ status: 'ok', paths: [join(rootIn(base), 'up1.0.txt')] });
    const exact = whole(PART);
    const other = 'remoteUpload000000000B';
    expect(await run(partOf(exact, 0, false, other))).toEqual({ status: 'ok', paths: [] });
    expect(await run({ appSessionId: ID, part: { upload: other, index: 1, last: true }, files: [file('paper.pdf', Buffer.alloc(0))] })).toEqual({ status: 'ok', paths: [join(rootIn(base), 'up2.0.pdf')] });
    expect(readFileSync(join(rootIn(base), 'up2.0.pdf')).equals(exact)).toBe(true);
  });

  it('refuses a part at any index but the one expected, keeping what was staged, so the right part still completes it', async () => {
    const base = dir();
    const { run } = upload({ directory: base });
    const bytes = whole(5 * 1024 * 1024);
    expect(await run(partOf(bytes, 1, false))).toEqual({ status: 'refused', reason: 'part out of order' }); // nothing staged yet
    expect(existsSync(join(stagingIn(base), UPLOAD))).toBe(false);
    expect(await run(partOf(bytes, 0, false))).toEqual({ status: 'ok', paths: [] });
    expect(await run(partOf(bytes, 2, true))).toEqual({ status: 'refused', reason: 'part out of order' }); // one skipped
    expect(await run(partOf(bytes, 0, false))).toEqual({ status: 'refused', reason: 'part out of order' }); // one again
    expect(statSync(join(stagingIn(base), UPLOAD)).size).toBe(PART);
    expect(await run(partOf(bytes, 1, false))).toEqual({ status: 'ok', paths: [] });
    expect(await run(partOf(bytes, 2, true))).toMatchObject({ status: 'ok', paths: [join(rootIn(base), 'up1.0.pdf')] });
    expect(readFileSync(join(rootIn(base), 'up1.0.pdf')).equals(bytes)).toBe(true);
  });

  it('bounds the whole at 32 MiB: the part that would pass it is refused and the staging removed', async () => {
    const base = dir();
    const { run } = upload({ directory: base });
    const part = file('big.bin', Buffer.alloc(PART, 7));
    const max = UPLOAD_FILE_MAX_BYTES / PART;
    for (let index = 0; index < max; index++) expect(await run({ appSessionId: ID, part: { upload: UPLOAD, index, last: false }, files: [part] }), `part ${index}`).toEqual({ status: 'ok', paths: [] });
    expect(statSync(join(stagingIn(base), UPLOAD)).size).toBe(UPLOAD_FILE_MAX_BYTES);
    expect(await run({ appSessionId: ID, part: { upload: UPLOAD, index: max, last: true }, files: [file('big.bin', Buffer.alloc(1))] })).toEqual({ status: 'refused', reason: `the file exceeds ${UPLOAD_FILE_MAX_BYTES / 1024 / 1024} MiB, so nothing was saved` });
    expect(existsSync(join(stagingIn(base), UPLOAD))).toBe(false);
  });

  it('refuses a malformed part at the schema: two files, or a part before the last that is not exactly 2 MiB', () => {
    const two = { appSessionId: ID, part: { upload: UPLOAD, index: 0, last: true }, files: [file('a.txt', TEXT), file('b.txt', TEXT)] };
    expect(validateCommandInput('files.upload', two)).toMatchObject({ ok: false });
    const short = { appSessionId: ID, part: { upload: UPLOAD, index: 0, last: false }, files: [file('a.txt', TEXT)] };
    expect(validateCommandInput('files.upload', short)).toMatchObject({ ok: false });
    const long = { appSessionId: ID, part: { upload: UPLOAD, index: 0, last: true }, files: [file('a.bin', Buffer.alloc(PART + 1))] };
    expect(validateCommandInput('files.upload', long)).toMatchObject({ ok: false });
    expect(validateCommandInput('files.upload', { ...short, part: { upload: 'short', index: 0, last: true } })).toMatchObject({ ok: false }); // the id's pattern
    expect(validateCommandInput('files.upload', { ...short, part: { upload: UPLOAD, index: 0, last: true } })).toMatchObject({ ok: true });
  });

  it('sweeps a staging left over a day: in a root no upload went to since, with the root; in a root still in use, by its own age', async () => {
    const data = dir();
    let now = Date.now();
    const roots = uploadRootsOf(join(data, 'sessions', 'uploads.json'), { now: () => now, log: () => {} });
    const base = dir();
    const run = createUpload({ sessions: fakeSpineView({ records: [sessionRecord(ID, { directory: base })] }), roots, git: noGit(), mint: () => 'up1', log: () => {} });
    const bytes = whole(3 * 1024 * 1024);
    expect(await run(partOf(bytes, 0, false))).toEqual({ status: 'ok', paths: [] });
    expect(roots.sweep()).toBe(0);
    expect(readdirSync(stagingIn(base))).toEqual([UPLOAD]); // a day not yet passed
    now += 25 * 3600_000;
    expect(roots.sweep()).toBe(1);
    expect(existsSync(rootIn(base))).toBe(false); // the staging, its directory and the root

    // a root an upload went to an hour ago keeps its record; a staging in it untouched for a day goes alone
    expect(await run(partOf(bytes, 0, false))).toEqual({ status: 'ok', paths: [] });
    const fresh = 'remoteUpload000000000C';
    expect(await run(partOf(bytes, 0, false, fresh))).toEqual({ status: 'ok', paths: [] });
    const old = (now - 25 * 3600_000) / 1000;
    utimesSync(join(stagingIn(base), UPLOAD), old, old);
    utimesSync(join(stagingIn(base), fresh), now / 1000, now / 1000); // written now, by the sweep's clock
    writeFileSync(join(stagingIn(base), 'notes.md'), 'not a staging');
    now += 3600_000;
    expect(roots.sweep()).toBe(0);
    expect(readdirSync(stagingIn(base)).sort()).toEqual(['notes.md', fresh]);
  });
});

// The module as it loads on another platform than macOS (Linux CI): its walk checks each ancestor, then opens with
// O_NOFOLLOW and confirms the descriptor, in place of macOS's O_NOFOLLOW_ANY. On Linux both loads are this one.
async function portableUpload(): Promise<typeof import('./upload')> {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: 'linux' });
  try {
    vi.resetModules();
    return await import('./upload');
  } finally {
    Object.defineProperty(process, 'platform', platform);
    vi.resetModules();
  }
}
