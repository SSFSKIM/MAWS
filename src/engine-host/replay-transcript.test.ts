// P3-F L242: the transcript a replayed session leaves when the replay takes its first prompt, as the engine writes one
// then: the record in the shape of a recorded CLI stream-json store transcript, under the session's id in its working
// directory's project, never over one that exists; and only into the e2e's scratch store under C10's replay seam.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { StdinFrame } from '@shared/wire/frames';
import { TRANSCRIPT_FIXTURE_DIR } from '../../test/support/fixtures';
import { ScratchRepo } from '../../test/support/scratch-repo';
import { resolveStorePaths, slugOf } from './fs/paths';
import { replayTranscriptProjects, seedReplayTranscript } from './replay-transcript';

// The first record of a recorded CLI stream-json session (engine 2.1.283, `entrypoint: "sdk-cli"`), MAWS's launch mode
const RECORDED = JSON.parse(readFileSync(join(TRANSCRIPT_FIXTURE_DIR, 'sdk-unended.jsonl'), 'utf8').split('\n').find((line) => line.includes('"parentUuid":null'))!) as Record<string, unknown>;
const FIRST = { type: 'user', uuid: 'f1e2d3c4-0000-4000-8000-000000000001', message: { role: 'user', content: [{ type: 'text', text: 'Make me a dashboard page.' }] }, parent_tool_use_id: null } as unknown as StdinFrame;
const SESSION = '5eed0000-0000-4000-8000-000000000001';

const made: string[] = [];
const repos: ScratchRepo[] = [];
const scratch = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const repo of repos.splice(0)) repo.dispose();
});

describe('the replay transcript store (the e2e scratch store under C10’s seam only)', () => {
  const seam = (config: string | undefined, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ MAWS_E2E: '1', MAWS_E2E_REPLAY_FIXTURES: 'a.jsonl', ...(config !== undefined && { CLAUDE_CONFIG_DIR: config }), ...extra });

  it('names the scratch store’s projects directory, as main’s transcript paths name it', () => {
    const config = scratch('maws-replay-config-');
    expect(replayTranscriptProjects(seam(config))).toBe(resolveStorePaths(seam(config)).projects);
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
});
