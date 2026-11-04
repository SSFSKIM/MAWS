// A send's upload read on a machine that cannot hold an open to its path (P5 O7 M8,
// docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "The attachment"; task 3's review). Off macOS the no-link
// open walks the ancestors first and then checks the opened descriptor's own path (`/proc/self/fd`), so an ancestor
// turned into a link between the walk and the open is refused. Where `/proc` is not mounted that check cannot be made,
// and the read would follow such a link out of the root unseen: the expansion is refused there, nothing read. The
// write path keeps its behaviour (the upload is made below as on any machine).
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { NotARepositoryError } from '../git/runner';
import { createUpload, createUploadReader, uploadRootsOf } from './upload';

// this machine as one whose opens cannot be confirmed: off macOS, with no `/proc/self/fd`
vi.mock('../fs/no-link', async (actual) => ({ ...(await actual<typeof import('../fs/no-link')>()), OPENS_CONFIRMED: false }));

const APP = 'app-1' as AppSessionId;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('a send’s upload read where an open cannot be confirmed', () => {
  it('refuses the expansion, naming why, and reads nothing', async () => {
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'upload-unconfirmed-')));
    dirs.push(scratch);
    const directory = join(scratch, APP);
    mkdirSync(directory);
    const sessions = {
      record: (id: AppSessionId) => (id === APP ? ({ directory, additionalDirectories: [], worktree: null } as unknown as SessionRecord) : null),
      intent: () => null,
    };
    const notARepository = async (): Promise<string> => {
      throw new NotARepositoryError();
    };
    const write = createUpload({ sessions, roots: uploadRootsOf(join(scratch, 'uploads.json'), { log: () => {} }), git: notARepository, log: () => {} });
    const written = await write({ appSessionId: APP, files: [{ name: 'brief.pdf', bytes: PDF.toString('base64') }] });
    expect(written.status).toBe('ok');
    const uploadId = basename(written.status === 'ok' ? written.paths[0]! : '');

    const read = await createUploadReader({ sessions })({ appSessionId: APP, uploads: [{ uploadId, as: 'document' }] });
    expect(read).toEqual({ status: 'refused', reason: expect.stringMatching(/can’t confirm/) });
  });
});
