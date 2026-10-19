// P3-F L242: the transcript a replayed session leaves when the replay takes its first prompt, as the engine writes one
// then: the record in the shape of a recorded CLI stream-json store transcript, under the session's id in its working
// directory's project, never over one that exists; and only into the e2e's scratch store under C10's replay seam.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { StdinFrame } from '@shared/wire/frames';
import type { JournalRow } from '@shared/wire/journal';
import { loadEngineJournal, TRANSCRIPT_FIXTURE_DIR } from '../../test/support/fixtures';
import { ScratchRepo } from '../../test/support/scratch-repo';
import { resolveStorePaths, slugOf } from './fs/paths';
import { replayTranscriptProjects, seedOnFirstUser, seedReplayTranscript } from './replay-transcript';
import { replayEngine } from './replay-transport';

// The first record of a recorded CLI stream-json session (engine 2.1.283, `entrypoint: "sdk-cli"`), MAWS's launch mode
const RECORDED = JSON.parse(readFileSync(join(TRANSCRIPT_FIXTURE_DIR, 'sdk-unended.jsonl'), 'utf8').split('\n').find((line) => line.includes('"parentUuid":null'))!) as Record<string, unknown>;
const FIRST = { type: 'user', uuid: 'f1e2d3c4-0000-4000-8000-000000000001', message: { role: 'user', content: [{ type: 'text', text: 'Make me a dashboard page.' }] }, parent_tool_use_id: null } as unknown as StdinFrame;
const SESSION = '5eed0000-0000-4000-8000-000000000001';
const session = (cwd: string, sessionId = SESSION) => ({ cwd, sessionId, engineVersion: '2.1.300', permissionMode: null });

const made: string[] = [];
const repos: ScratchRepo[] = [];
const scratch = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return realpathSync(dir); // as the gate names the store: its real path
};
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const repo of repos.splice(0)) repo.dispose();
});

describe('the replay transcript store (the e2e scratch store under C10’s seam only)', () => {
  const seam = (config: string | undefined, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ MAWS_E2E: '1', MAWS_E2E_REPLAY_FIXTURES: 'a.jsonl', ...(config !== undefined && { CLAUDE_CONFIG_DIR: config }), ...extra });

  it('names the scratch store’s projects directory by its real path, the one main’s transcript paths name', () => {
    const config = scratch('maws-replay-config-');
    expect(replayTranscriptProjects(seam(config))).toBe(resolveStorePaths(seam(config)).projects);
    const link = join(scratch('maws-replay-link-'), 'config'); // the config home named through a symlink
    symlinkSync(config, link);
    expect(replayTranscriptProjects(seam(link))).toBe(join(config, 'projects'));
  });

  it('names none outside C10’s seam, without a config home, or for one that is not under the temporary directory', () => {
    const config = scratch('maws-replay-config-');
    expect(replayTranscriptProjects(seam(config, { MAWS_E2E: undefined }))).toBeNull();
    expect(replayTranscriptProjects(seam(config, { MAWS_E2E_REPLAY_FIXTURES: '' }))).toBeNull();
    expect(replayTranscriptProjects(seam(undefined))).toBeNull(); // the engine would read ~/.claude
    expect(replayTranscriptProjects(seam(join(homedir(), '.claude')))).toBeNull(); // named, but the owner's
    expect(replayTranscriptProjects(seam(join(config, 'not-made')))).toBeNull(); // no such directory to prove
    expect(replayTranscriptProjects(seam(config), scratch('maws-replay-elsewhere-'))).toBeNull(); // not under the temporary directory given
  });
});

describe('seeding the replay’s transcript', () => {
  const pathOf = (projects: string, cwd: string) => join(projects, slugOf(realpathSync(cwd)), `${SESSION}.jsonl`);

  it('writes the first prompt’s record in the recorded shape, under the session’s id in its directory’s project, its branch the checkout’s', async () => {
    const projects = join(scratch('maws-replay-config-'), 'projects');
    const repo = await ScratchRepo.create();
    repos.push(repo);
    const cwd = await repo.addManagedWorktree('seed');
    const written = await seedReplayTranscript(projects, { cwd, sessionId: SESSION, engineVersion: '2.1.300', permissionMode: 'acceptEdits' }, FIRST, new Date('2026-10-18T12:00:00.000Z'));
    expect(written).toBe(pathOf(projects, cwd));
    const lines = readFileSync(written!, 'utf8').split('\n');
    expect(lines).toHaveLength(2); // one record, newline-terminated
    const record = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(Object.keys(record).sort()).toEqual(Object.keys(RECORDED).sort());
    expect(record).toMatchObject({
      parentUuid: null, isSidechain: false, type: 'user', message: (FIRST as unknown as { message: unknown }).message, uuid: 'f1e2d3c4-0000-4000-8000-000000000001',
      timestamp: '2026-10-18T12:00:00.000Z', permissionMode: 'acceptEdits', promptSource: 'sdk', turnOrigin: 'sdk', userType: 'external', entrypoint: 'sdk-cli',
      cwd: realpathSync(cwd), sessionId: SESSION, version: '2.1.300', gitBranch: 'worktree-seed',
    });
  });

  it('names the branch HEAD outside a repository and the mode default when the launch named none, as the engine records them', async () => {
    const projects = join(scratch('maws-replay-config-'), 'projects');
    const cwd = scratch('maws-replay-cwd-');
    await seedReplayTranscript(projects, { cwd, sessionId: SESSION, engineVersion: '2.1.300', permissionMode: null }, FIRST);
    expect(JSON.parse(readFileSync(pathOf(projects, cwd), 'utf8'))).toMatchObject({ gitBranch: 'HEAD', permissionMode: 'default' });
  });

  it('never writes over a transcript that exists (a test’s own seed, a resumed conversation)', async () => {
    const projects = join(scratch('maws-replay-config-'), 'projects');
    const cwd = scratch('maws-replay-cwd-');
    const path = pathOf(projects, cwd);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, '{"type":"user","seeded":true}\n');
    expect(await seedReplayTranscript(projects, { cwd, sessionId: SESSION, engineVersion: '2.1.300', permissionMode: null }, FIRST)).toBeNull();
    expect(readFileSync(path, 'utf8')).toBe('{"type":"user","seeded":true}\n');
    expect(existsSync(path)).toBe(true);
  });

  // P3-F L242 (review): the gate proves the config home; a symlink at or under it must not carry the write elsewhere
  describe('writes nowhere a symlink in the store would carry it out of the scratch store', () => {
    // a permitted temporary root, its config home, and a disposable directory outside that root the links point at
    const setup = () => {
      const root = scratch('maws-replay-root-');
      const config = join(root, 'config');
      mkdirSync(config);
      const outside = scratch('maws-replay-outside-');
      const projects = replayTranscriptProjects({ MAWS_E2E: '1', MAWS_E2E_REPLAY_FIXTURES: 'a.jsonl', CLAUDE_CONFIG_DIR: config }, root)!;
      expect(projects).toBe(join(config, 'projects'));
      return { config, outside, projects, cwd: scratch('maws-replay-cwd-') };
    };

    it('refuses a projects directory that is a symlink, creating nothing through it', async () => {
      const { outside, projects, cwd } = setup();
      symlinkSync(outside, projects);
      await expect(seedReplayTranscript(projects, session(cwd), FIRST)).rejects.toThrow('not a directory of the scratch store');
      expect(readdirSync(outside)).toEqual([]);
    });

    it('refuses a project directory that is a symlink, writing nothing through it', async () => {
      const { outside, projects, cwd } = setup();
      mkdirSync(projects);
      symlinkSync(outside, join(projects, slugOf(cwd)));
      await expect(seedReplayTranscript(projects, session(cwd), FIRST)).rejects.toThrow('not a directory of the scratch store');
      expect(readdirSync(outside)).toEqual([]);
    });

    it('refuses a config home that no longer is its own real path (an ancestor swapped for a symlink)', async () => {
      const { config, outside, cwd } = setup();
      const link = join(scratch('maws-replay-link-'), 'config');
      symlinkSync(outside, link);
      await expect(seedReplayTranscript(join(link, 'projects'), session(cwd), FIRST)).rejects.toThrow('not a directory of the scratch store');
      expect(readdirSync(outside)).toEqual([]);
      expect(readdirSync(config)).toEqual([]);
    });

    it('refuses a session id that would name a file outside its project', async () => {
      const { config, projects, cwd } = setup();
      await expect(seedReplayTranscript(projects, session(cwd, '../../escape'), FIRST)).rejects.toThrow('not a transcript name');
      expect(readdirSync(config)).toEqual([]);
    });
  });
});

// P3-F L242 (review): the launcher's hook at the replay transport: the conversation's transcript exists by the time the
// replay plays the first prompt's reply, so a side thread or fork asked for once it shows is never refused as blank
describe('the replay’s first prompt, its transcript and its reply', () => {
  const at = '2026-10-18T00:00:00.000Z';
  const journal: JournalRow[] = [
    { seq: 1, direction: 'out', at, frame: { type: 'user', uuid: 'rec-u', message: (FIRST as unknown as { message: unknown }).message, parent_tool_use_id: null } },
    { seq: 2, direction: 'in', at, frame: { type: 'result', subtype: 'success', user_message_uuids: ['rec-u'] } },
    { seq: 3, direction: 'meta', at, frame: { event: 'exit', code: 0, signal: null } },
  ];

  it('has the transcript written before the reply plays', async () => {
    const projects = join(scratch('maws-replay-config-'), 'projects');
    const cwd = scratch('maws-replay-cwd-');
    const log: string[] = [];
    const transport = replayEngine(journal, { prelude: loadEngineJournal('replay-handshake'), onFirstUser: seedOnFirstUser(projects, session(cwd), (message) => log.push(message)) });
    const write = transport.write(FIRST);
    const reply = await transport.frames[Symbol.asyncIterator]().next();
    expect(reply.value).toMatchObject({ frame: { type: 'result' } });
    expect(existsSync(join(projects, slugOf(cwd), `${SESSION}.jsonl`))).toBe(true);
    await write;
    expect(log).toEqual([]);
  });

  it('plays the reply after a seed that failed, its failure logged', async () => {
    const projects = join(scratch('maws-replay-config-'), 'projects');
    symlinkSync(scratch('maws-replay-outside-'), projects);
    const log: string[] = [];
    const transport = replayEngine(journal, { prelude: loadEngineJournal('replay-handshake'), onFirstUser: seedOnFirstUser(projects, session(scratch('maws-replay-cwd-')), (message) => log.push(message)) });
    void transport.write(FIRST);
    expect((await transport.frames[Symbol.asyncIterator]().next()).value).toMatchObject({ frame: { type: 'result' } });
    expect(log).toEqual([expect.stringContaining("the replay's transcript was not written")]);
  });
});
