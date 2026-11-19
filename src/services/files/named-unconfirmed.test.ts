// A subagent's transcript on a machine that cannot hold an open to its path (UX wave U6b-4c,
// docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4c-markdown-links.md, R2 and X2.9). Off macOS the no-link open walks the
// folders first and then checks the opened descriptor's own path (`/proc/self/fd`), so a folder turned into a link
// between the walk and the open is refused. Where `/proc` is not mounted that check cannot be made, and an open would
// follow such a link to another session's file unseen: there a subagent's file is no source at all. Not named, no file
// opened, no folder read and no locator asked, and the follow it serves answers not-linked and records nothing.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { open as fsOpen } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { createNamedPaths, type NamedPathsOptions } from './named';
import { createFilesService } from './service';

// this machine as one whose opens cannot be confirmed: off macOS, with no `/proc/self/fd`
vi.mock('../fs/no-link', async (actual) => ({ ...(await actual<typeof import('../fs/no-link')>()), OPENS_CONFIRMED: false }));
const dirReads = vi.hoisted(() => ({ count: 0 }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readdir: ((...args: Parameters<typeof actual.readdir>) => ((dirReads.count += 1), actual.readdir(...args))) as typeof actual.readdir };
});

const S = 'app-unconfirmed' as AppSessionId;
const AGENT = 'a1b2c3';
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const linkTo = (path: string) => JSON.stringify({ type: 'assistant', uuid: 'a-1', isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text: `Wrote [the notes](${path}).` }] } });
function write(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

describe('a subagent’s transcript where an open cannot be confirmed', () => {
  it('names nothing in a subagent’s file and opens none, its `located` called once, and the follow records nothing; the session’s own transcript is still searched', async () => {
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'named-unconfirmed-')));
    dirs.push(scratch);
    const directory = join(scratch, 'repo');
    mkdirSync(directory);
    const target = join(scratch, 'out', 'notes.txt');
    write(target, 'notes\n');
    const transcript = join(scratch, 'projects', '-repo', 'engine-session-1.jsonl');
    write(transcript, `${linkTo(target)}\n`);
    write(join(scratch, 'projects', '-repo', 'engine-session-1', 'subagents', `agent-${AGENT}.jsonl`), `${linkTo(target)}\n`);
    const opened: string[] = [];
    const open: NonNullable<NamedPathsOptions['open']> = async (path, flags) => (opened.push(path), fsOpen(path, flags));
    const locate = vi.fn(async () => transcript);
    const named = createNamedPaths({ transcript: locate, open });
    const located = vi.fn();
    expect(await named.namesInAgent(S, AGENT, target, undefined, located)).toBe(false);
    expect({ opened, dirs: dirReads.count, locator: locate.mock.calls.length, located: located.mock.calls.length }).toEqual({ opened: [], dirs: 0, locator: 0, located: 1 });

    const add = vi.fn();
    const files = createFilesService({
      records: (id) => (id === S ? { directory, additionalDirectories: [], worktree: null } : null),
      links: { add, get: () => null },
      agentNames: named.namesInAgent,
    });
    expect(await files.follow({ appSessionId: S, path: target, from: { agent: AGENT } })).toEqual({ status: 'not-linked' });
    expect({ add: add.mock.calls.length, opened, dirs: dirReads.count }).toEqual({ add: 0, opened: [], dirs: 0 });

    // the control: the same search opens and reads the session's own transcript, which links the same path
    expect(await named.names(S, target)).toBe('counted');
    expect(opened).toEqual([transcript]);
  });
});
