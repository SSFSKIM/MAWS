// A temporary CLAUDE_CONFIG_DIR tree built from fixtures and torn down after the test (C4 execution document, "Test
// support"). M1 ships the transcript and sidecar parts; M2 adds registry records, jobs and tasks. Tests write here,
// never under the owner's ~/.claude.
import { appendFile, mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { JobState, LiveSessionRecord, PersistedTask } from '@shared/wire/store';
import type { TranscriptRecord } from '@shared/wire/transcript';
import { resolveStorePaths, slugOf, type StorePaths } from '../../src/engine-host/fs/paths';

export class StoreFixture {
  readonly paths: StorePaths;
  private readonly slugBySession = new Map<string, string>();
  private counter = 0;

  private constructor(readonly configHome: string) {
    this.paths = resolveStorePaths({ CLAUDE_CONFIG_DIR: configHome });
  }

  static async create(): Promise<StoreFixture> {
    const configHome = await mkdtemp(join(tmpdir(), 'maws-store-'));
    const fixture = new StoreFixture(configHome);
    await Promise.all([mkdir(fixture.paths.projects), mkdir(fixture.paths.sessions), mkdir(fixture.paths.jobs), mkdir(fixture.paths.tasks)]);
    return fixture;
  }

  // Writes projects/<slugOf(directory)>/<sessionId>.jsonl and returns the path. Written synchronously in spirit (the
  // promise resolves once the file exists) so a test can start a follower on the returned path.
  async addTranscript(directory: string, sessionId: string, lines: string[] | TranscriptRecord[]): Promise<string> {
    const slug = slugOf(directory);
    const path = join(this.paths.projects, slug, `${sessionId}.jsonl`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, serialize(lines));
    this.slugBySession.set(sessionId, slug);
    return path;
  }

  async appendLines(path: string, lines: string[]): Promise<void> {
    await appendFile(path, serialize(lines));
  }

  // Torn-write simulation: raw bytes, no newline discipline.
  async appendBytes(path: string, bytes: Buffer): Promise<void> {
    await appendFile(path, bytes);
  }

  // Temp-and-rename, the engine's GC shape: a new inode under the same name.
  async rewriteFile(path: string, lines: string[]): Promise<void> {
    const temp = `${path}.tmp.${process.pid}.${++this.counter}`;
    await writeFile(temp, serialize(lines));
    await rename(temp, path);
  }

  // projects/<slug>/<sessionId>/<rel>: custom-title.json, subagents/agent-*.jsonl|.meta.json, workflows/…
  async addSidecar(sessionId: string, rel: string, content: string | object): Promise<string> {
    const slug = this.slugBySession.get(sessionId);
    if (slug === undefined) throw new Error(`addSidecar: no transcript added for session ${sessionId}`);
    const path = join(this.paths.projects, slug, sessionId, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content));
    return path;
  }

  // sessions/<pid>.json, written as the engine writes it: a bare writeFile (SPEC 35.27.1). The pid is the file name.
  async addRegistryRecord(pid: number, record: Partial<LiveSessionRecord>): Promise<string> {
    const path = join(this.paths.sessions, `${pid}.json`);
    await writeFile(path, JSON.stringify(record));
    return path;
  }

  async removeRegistryRecord(pid: number): Promise<void> {
    await rm(join(this.paths.sessions, `${pid}.json`), { force: true });
  }

  // jobs/<short>/state.json (SPEC 20.15.5)
  async addJob(short: string, state: Partial<JobState>): Promise<string> {
    const path = join(this.paths.jobs, short, 'state.json');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(state));
    return path;
  }

  // tasks/<listId>/<id>.json, pretty-printed as the engine writes it (SPEC 20.2.3)
  async addTask(listId: string, task: PersistedTask): Promise<string> {
    const path = join(this.paths.tasks, listId, `${task.id}.json`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(task, null, 2));
    return path;
  }

  transcriptPath(sessionId: string): string {
    const slug = this.slugBySession.get(sessionId);
    if (slug === undefined) throw new Error(`transcriptPath: no transcript added for session ${sessionId}`);
    return join(this.paths.projects, slug, `${sessionId}.jsonl`);
  }

  async dispose(): Promise<void> {
    await rm(this.configHome, { recursive: true, force: true });
  }
}

function serialize(lines: string[] | TranscriptRecord[]): string {
  return lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line)) + '\n').join('');
}
