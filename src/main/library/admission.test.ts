// Main's file admission from the library's index (the P3-L document, M6b; Decision Log 16 and 36i): the files service
// admits a delivered file outside a session's directories when a live File artifact names it: one linked to the
// session or a side thread's ancestor, or one no session is linked to (the owner's own, read by its own viewer).
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ArtifactSessionLink } from '@shared/artifacts/entity';
import type { AppSessionId } from '@shared/graph/ids';
import type { LibraryEntry } from '@shared/ipc/schema/library';
import { summary, tempDir } from '../../../test/support/index-fixture';
import { Index } from '../index/index';
import { fileAdmission } from './admission';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const entry = (n: number, over: Partial<LibraryEntry>): LibraryEntry => ({
  id: uuid(n), kind: 'file', title: `File ${n}`, createdBy: { kind: 'human' }, createdAt: 1, updatedAt: 2, lastViewedAt: null, pinned: false,
  agentEditsAsSuggestions: false, revision: 1, lastEditor: { kind: 'human' }, lastEditedAt: 2, ...over,
});

describe('fileAdmission (M6b)', () => {
  let dir: ReturnType<typeof tempDir>;
  let index: Index;
  let files: string;
  beforeEach(() => {
    dir = tempDir();
    index = new Index(join(dir.path, 'index.sqlite'));
    files = join(dir.path, 'outside');
    mkdirSync(files);
  });
  afterEach(() => {
    index.close();
    dir.dispose();
  });
  const session = (title: string) => index.sessions.upsertFromSummary(summary({ customTitle: title })).record.appId;
  const link = (n: number, appSessionId: AppSessionId): ArtifactSessionLink => ({ artifactId: uuid(n), appSessionId, role: 'created', lastAt: 1 });
  const file = (name: string) => {
    const path = join(files, name);
    writeFileSync(path, name);
    return path;
  };

  it('admits a live File artifact’s path for its session and the session’s side threads, and no other session', async () => {
    const parent = session('Parent');
    const thread = session('Thread');
    const other = session('Other');
    index.sideThreads.opened(thread, parent, 't1');
    const report = file('report.pdf');
    index.library.reconcile({ artifacts: [entry(1, { linkedPath: report })], links: [link(1, parent)], spaces: [] });
    const admitted = fileAdmission(index.library);

    expect(await admitted(parent, report)).toBe(true);
    expect(await admitted(thread, report)).toBe(true); // a side thread reads its ancestor's delivered file
    expect(await admitted(other, report)).toBe(false);
    expect(await admitted(parent, file('unrelated.txt'))).toBe(false);
  });

  it('admits a File artifact no session is linked to (the owner’s own) for any session, and never a page or a deleted one', async () => {
    const someone = session('Someone');
    const mine = file('mine.txt');
    const page = file('page.html');
    const gone = file('gone.txt');
    index.library.reconcile({ artifacts: [entry(1, { linkedPath: mine }), entry(2, { kind: 'html', linkedPath: page }), entry(3, { linkedPath: gone })], links: [], spaces: [] });
    index.library.remove(uuid(3));
    const admitted = fileAdmission(index.library);

    expect(await admitted(someone, mine)).toBe(true);
    expect(await admitted(someone, page)).toBe(false);
    expect(await admitted(someone, gone)).toBe(false);
  });

  it('compares realpaths: an artifact linked through a symlinked directory admits the file’s realpath, and a gone file admits nothing', async () => {
    const owner = session('Owner');
    const real = file('notes.md');
    symlinkSync(files, join(dir.path, 'alias'));
    index.library.reconcile({ artifacts: [entry(1, { linkedPath: join(dir.path, 'alias', 'notes.md') }), entry(2, { linkedPath: join(files, 'missing.md') })], links: [link(1, owner), link(2, owner)], spaces: [] });
    const admitted = fileAdmission(index.library);

    expect(await admitted(owner, real)).toBe(true);
    expect(await admitted(owner, join(files, 'missing.md'))).toBe(false);
  });

  it('admits nothing while the index is unavailable', async () => {
    expect(await fileAdmission(null)(session('Any'), file('x.txt'))).toBe(false);
  });
});
