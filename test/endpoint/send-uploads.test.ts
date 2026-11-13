// A send's uploads (P5 O7 M8, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M8 "The attachment", Interfaces
// §U): `session.send`'s `uploads` names files a remote device sent up to the session's upload root, and the endpoint reads
// each into the send as a document block before the act reaches the engine host, so the model gets the PDF as a local
// drop gives it. The read is the files service's (`files.readUploads`, over the real upload root of a scratch checkout):
// only the sending session's own root, by its real path with no link on the way, a file still there, written within the
// day, a PDF within the engine's size limit. Anything else refuses the send `malformed`, and nothing reaches the engine
// host. What the engine host queues holds the blocks themselves, so a queued send outlives the upload's sweep and a
// restart of the engine host.
import { linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Action } from 'org-protocol';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { MAX_SEND_DOCUMENT_BYTES } from '@shared/engine/session-state-store';
import { SEND_UPLOADS_MAX, UPLOAD_FILES_MAX } from '@shared/ipc/schema/files';
import { MessageQueue } from '../../src/engine-host/queue';
import { FileSessionStateStore } from '../../src/engine-host/store/file-session-state-store';
import { ENDPOINT_CAPABILITIES } from '../../src/endpoint/capabilities';
import { NotARepositoryError } from '../../src/services/git/runner';
import { registerFilesHandlers } from '../../src/services/files/register';
import { createUpload, createUploadReader, uploadRootsOf } from '../../src/services/files/upload';
import { act, done, makeOrg, openRemote, startEndpoint, stopAll, type Fixture, type HostSession, type Org, type Remote } from './sub-harness';

let org: Org;
const started: Fixture[] = [];
const dirs: string[] = [];

beforeAll(async () => {
  org = await makeOrg();
});
afterEach(async () => {
  await stopAll(started);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
afterAll(() => stopAll(started));

const APP = 'app-1';
const OTHER = 'app-2';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
const TEXT = 'Read the brief\n\n@.claude/desk-uploads/app-1/brief.pdf';
const block = (bytes: Buffer) => ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: bytes.toString('base64') } });
const notARepository = async (): Promise<string> => {
  throw new NotARepositoryError();
};

type Setup = { f: Fixture; s: HostSession; a: Remote; dir: string; root: string; upload: (appSessionId: string, bytes?: Buffer) => Promise<string>; dispose: () => void };

/** Two live sessions, each rooted at its own scratch directory; the files service's real upload and its reader on the machine. */
async function setup(): Promise<Setup> {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'send-uploads-')));
  dirs.push(scratch);
  const directory = (id: string) => join(scratch, id);
  for (const id of [APP, OTHER]) mkdirSync(directory(id));
  const f = await startEndpoint(org, started);
  const s = f.host.add(APP);
  const other = f.host.add(OTHER);
  for (const [id, row] of [[APP, s], [OTHER, other]] as const) {
    f.spine.set(id, row.engineSessionId, { appId: id, directory: directory(id), additionalDirectories: [], worktree: null });
    f.records.set({ lane: 'B', session: row.engineSessionId!, owners: ['@machine'] }, id);
  }
  const view = {
    record: (id: AppSessionId) => (id === APP || id === OTHER ? ({ directory: directory(id), additionalDirectories: [], worktree: null } as unknown as SessionRecord) : null),
    intent: () => null,
  };
  const roots = uploadRootsOf(join(scratch, 'uploads.json'), { log: () => {} });
  const write = createUpload({ sessions: view, roots, git: notARepository, log: () => {} });
  const files = registerFilesHandlers(view.record, {
    bus: f.spine.bus as never,
    emit: () => {},
    port: { openExternal: async () => ({ opened: false, message: null }), reveal: async () => ({ revealed: false }) } as never,
    env: {},
    upload: write,
    readUploads: createUploadReader({ sessions: view }),
  });
  const upload = async (appSessionId: string, bytes: Buffer = PDF): Promise<string> => {
    const answer = await write({ appSessionId: appSessionId as AppSessionId, files: [{ name: 'brief.pdf', bytes: bytes.toString('base64') }] });
    if (answer.status !== 'ok') throw new Error(answer.reason);
    return answer.paths[0]!;
  };
  return { f, s, a: await openRemote(f, org.a1, org.A), dir: directory(APP), root: join(directory(APP), '.claude', 'desk-uploads', APP), upload, dispose: () => files.dispose() };
}

const send = (t: Setup, args: Record<string, unknown>): Action =>
  t.a.device.action({ machine: t.f.ref, action: 'session.send', session: APP, context: { lane: 'B', launchId: t.s.launchId, engineSessionId: t.s.engineSessionId! }, args: { appSessionId: APP, content: TEXT, ...args } });
const uploads = (...ids: string[]) => ({ uploads: ids.map((uploadId) => ({ uploadId, as: 'document' })) });
/** Each `host.op` of a `session.send` the engine host was handed, from `from` on. */
const handed = (t: Setup, from = 0) => t.f.host.calls.slice(from).filter((c) => c.name === 'host.op' && (c.input as { name?: string }).name === 'session.send');

/** Refused `malformed`, the machine's log saying why (`why`; none for a refusal of the schema, before anything is read), nothing handed on. */
async function refusedAndNothingQueued(t: Setup, action: Action, why: RegExp | null): Promise<void> {
  const from = t.f.host.calls.length;
  const runs = t.f.host.runs.length;
  const lines = t.f.services.lines.length;
  expect(await act(t.a, action)).toBe('malformed');
  expect(handed(t, from)).toEqual([]);
  expect(t.f.host.runs.length).toBe(runs);
  const said = t.f.services.lines.slice(lines).filter((line) => line.includes('a send on channel'));
  if (why === null) expect(said).toEqual([]);
  else expect(said).toEqual([expect.stringMatching(why)]);
}

describe('a send’s uploads', () => {
  it('is a capability the endpoint lists', () => {
    expect(ENDPOINT_CAPABILITIES).toContain('rl2.upload-blocks');
  });

  it('reads an upload of the session’s own root into the send as a document block, the text after it, before the engine host sees the send', async () => {
    const t = await setup();
    try {
      const path = await t.upload(APP);
      const action = send(t, uploads(basename(path)));
      const from = t.f.host.calls.length;
      expect(await act(t.a, action)).toBe('ok');
      expect(await done(t.a, action)).toMatchObject({ state: 'done' });
      const [op] = handed(t, from);
      expect((op!.input as { input: Record<string, unknown> }).input).toEqual({ appSessionId: APP, content: [block(PDF), { type: 'text', text: TEXT }] });
      expect(t.f.host.runs.at(-1)?.content).toEqual([block(PDF), { type: 'text', text: TEXT }]);
    } finally {
      t.dispose();
    }
  });

  // M8's reviewer-high review: a message's PDFs are bounded by SEND_UPLOADS_MAX, not by one upload call's file count
  it('reads more uploads than one upload call carries into the send, and refuses past the message’s bound by its schema', async () => {
    const t = await setup();
    try {
      const paths: string[] = [];
      for (let i = 0; i <= UPLOAD_FILES_MAX; i += 1) paths.push(await t.upload(APP));
      const action = send(t, uploads(...paths.map((path) => basename(path))));
      expect(await act(t.a, action)).toBe('ok');
      await done(t.a, action);
      expect(t.f.host.runs.at(-1)?.content).toEqual([...paths.map(() => block(PDF)), { type: 'text', text: TEXT }]);
      const past = Array.from({ length: SEND_UPLOADS_MAX + 1 }, (_, i) => `past${String(i).padStart(4, '0')}.0.pdf`);
      await refusedAndNothingQueued(t, send(t, uploads(...past)), null);
    } finally {
      t.dispose();
    }
  });

  it('places the documents after the images a message carries inline and before its text, as a local drop does', async () => {
    const t = await setup();
    try {
      const path = await t.upload(APP);
      const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from('png').toString('base64') } };
      const action = send(t, { content: [image, { type: 'text', text: TEXT }], ...uploads(basename(path)) });
      expect(await act(t.a, action)).toBe('ok');
      await done(t.a, action);
      expect(t.f.host.runs.at(-1)?.content).toEqual([image, block(PDF), { type: 'text', text: TEXT }]);
    } finally {
      t.dispose();
    }
  });

  it('refuses another session’s upload: an id resolves only inside the sending session’s own root', async () => {
    const t = await setup();
    try {
      const foreign = await t.upload(OTHER);
      await refusedAndNothingQueued(t, send(t, uploads(basename(foreign))), /refused malformed: .* is not among this session’s uploads/);
    } finally {
      t.dispose();
    }
  });

  it('refuses a traversal or a path for an id, before anything is read', async () => {
    const t = await setup();
    try {
      const foreign = await t.upload(OTHER);
      for (const id of [`../${OTHER}/${basename(foreign)}`, foreign, '..', `${basename(foreign)}/x`]) await refusedAndNothingQueued(t, send(t, uploads(id)), null);
    } finally {
      t.dispose();
    }
  });

  it('refuses an upload that is a link (symbolic or hard) or has a link on its way', async () => {
    const t = await setup();
    try {
      await t.upload(APP); // the root exists
      const foreign = await t.upload(OTHER);
      symlinkSync(foreign, join(t.root, 'symbolicsymbolic.0.pdf'));
      await refusedAndNothingQueued(t, send(t, uploads('symbolicsymbolic.0.pdf')), /symbolicsymbolic\.0\.pdf is a link or not a file of its own/);
      linkSync(foreign, join(t.root, 'hardhardhardhard.0.pdf'));
      await refusedAndNothingQueued(t, send(t, uploads('hardhardhardhard.0.pdf')), /hardhardhardhard\.0\.pdf is a link or not a file of its own/);
      // the session's own `.claude` a link to another session's: its upload is not reached through it
      const own = await t.upload(APP);
      rmSync(join(t.dir, '.claude'), { recursive: true });
      const uploadsOfOther = dirname(dirname(foreign)); // <app-2>/.claude/desk-uploads
      mkdirSync(join(uploadsOfOther, APP), { recursive: true });
      writeFileSync(join(uploadsOfOther, APP, basename(own)), PDF, { mode: 0o600 });
      symlinkSync(dirname(uploadsOfOther), join(t.dir, '.claude'));
      await refusedAndNothingQueued(t, send(t, uploads(basename(own))), /is a link or not a file of its own/);
    } finally {
      t.dispose();
    }
  });

  it('refuses an upload no longer there (swept) and one written more than a day ago (expired)', async () => {
    const t = await setup();
    try {
      const swept = await t.upload(APP);
      rmSync(swept);
      await refusedAndNothingQueued(t, send(t, uploads(basename(swept))), /is not among this session’s uploads/);
      await refusedAndNothingQueued(t, send(t, uploads('neveruploadedhere.0.pdf')), /neveruploadedhere\.0\.pdf is not among this session’s uploads/);
      const old = await t.upload(APP);
      const twoDaysAgo = Date.now() / 1000 - 2 * 24 * 3600;
      utimesSync(old, twoDaysAgo, twoDaysAgo);
      await refusedAndNothingQueued(t, send(t, uploads(basename(old))), /was uploaded more than a day ago/);
    } finally {
      t.dispose();
    }
  });

  it('refuses an upload past the engine’s document limit, and one that is not a PDF', async () => {
    const t = await setup();
    try {
      await t.upload(APP);
      const big = join(t.root, 'bigbigbigbigbigb.0.pdf');
      writeFileSync(big, Buffer.concat([PDF, Buffer.alloc(MAX_SEND_DOCUMENT_BYTES + 1 - PDF.length)]), { mode: 0o600 });
      await refusedAndNothingQueued(t, send(t, uploads(basename(big))), /is larger than 32 MiB, the most a document can be/);
      const notes = await t.upload(APP, Buffer.from('plain notes\n'));
      await refusedAndNothingQueued(t, send(t, uploads(basename(notes))), /is not a PDF/);
    } finally {
      t.dispose();
    }
  }, 20_000);

  it('queues the blocks themselves: a queued send outlives the upload’s sweep and the engine host’s restart', async () => {
    const t = await setup();
    try {
      const path = await t.upload(APP);
      const action = send(t, uploads(basename(path)));
      expect(await act(t.a, action)).toBe('ok');
      await done(t.a, action);
      const content = t.f.host.runs.at(-1)!.content as never;
      // the engine host's own queue, over its state file, with a turn running: the send waits there
      const userData = join(dirname(t.dir), 'engine-host');
      const queueOf = (store: FileSessionStateStore) =>
        new MessageQueue({ appSessionId: APP as AppSessionId, store, write: async () => {}, meta: () => {}, turnOpen: () => true, canWrite: () => true, cancel: async () => false, sendNow: async () => undefined, onChange: () => {}, log: () => {} });
      const before = queueOf(new FileSessionStateStore(userData));
      await before.recover();
      expect((await before.send(content)).disposition).toBe('queued');
      await before.settled();
      before.dispose();
      // the upload's root swept, the engine host started again
      rmSync(t.root, { recursive: true });
      const after = queueOf(new FileSessionStateStore(userData));
      await after.recover();
      expect(after.state.entries.map((entry) => entry.content)).toEqual([[block(PDF), { type: 'text', text: TEXT }]]);
      after.dispose();
    } finally {
      t.dispose();
    }
  });
});
