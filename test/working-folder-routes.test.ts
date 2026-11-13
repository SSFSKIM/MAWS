// The routes, and one answer on them (UX wave U8c-2, M2; docs/doperpowers/plans/2026-11-12-ux-wave-U8c-live-working-folder.md,
// Interfaces §E, acceptance B-1 and B-2). The probe's two recorded sessions, one MAWS ran headless and one run in a
// terminal (spikes/protocol-probe/fixtures/pass3/uxwave/uxwave-folder-{headless,terminal}.jsonl), are replayed step by
// step through the summary and the index over a git repository made here with the worktrees the probe used: at each
// step the transcript holds the rows every step so far added (by their recorded index, up to the step's total), at the
// project folder the step found it in, with each row's recorded type, cwd, gitBranch, isSidechain and relocatedCwd, the
// probe's folders re-rooted here. Both give one answer, §E's table; and the fields build F's record carries are at every
// step what the probe recorded from the index before this landing (uxwave-folder-index-{headless,terminal}.json). A
// second session of invented rows in the probe's shapes is launched in a sub-folder of its repository and follows its
// agent into a worktree the engine made and into one registered by hand (§E's second table).
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { workingBranch, workingFolder, workingWorktree } from '@shared/sessions/working-folder';
import { slugOf } from '../src/engine-host/fs/paths';
import { HEAD_TAIL_BYTES, summarize } from '../src/engine-host/fs/summarize';
import { rootsOf } from '../src/services/files/allowlist';
import { Index } from '../src/services/index/index';
import { FIXTURE_DIR } from './support/fixtures';
import { gitCheckout, gitWorktree, tempDir } from './support/index-fixture';

const PROBE = join(FIXTURE_DIR, 'pass3/uxwave');
const ROW_KEYS = ['type', 'cwd', 'gitBranch', 'isSidechain', 'relocatedCwd'] as const;

type ProbeRow = { i: number } & Partial<Record<(typeof ROW_KEYS)[number], unknown>>;
interface StepRecord {
  name: string;
  transcript: { file: string; total: number; added: ProbeRow[] }[];
}
interface IndexStep {
  step: string;
  rows: number;
  record: { directory: string; worktree: { path: string; branch: string | null } | null; branch: string | null };
}

const lines = (file: string) => readFileSync(join(PROBE, file), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { frame: { event?: string } });
const stepRecords = (file: string): StepRecord[] => lines(file).flatMap(({ frame }) => (frame.event === 'step_record' ? [frame as unknown as StepRecord] : []));

// One session's transcript in a scratch engine store, written whole at each step at the project folder of the folder it
// is filed under; a step that files it elsewhere moves it there, as the engine renames it.
class Transcript {
  private path: string | null = null;
  constructor(
    private readonly store: string,
    readonly sessionId: string,
  ) {}

  write(folder: string, rows: object[]): string {
    const slug = slugOf(folder);
    const path = join(this.store, 'projects', slug, `${this.sessionId}.jsonl`);
    if (this.path !== null && this.path !== path) rmSync(this.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, rows.map((row) => `${JSON.stringify(row)}\n`).join(''));
    this.path = path;
    return path;
  }

  // What the engine host sends the index for the file as it stands: its 64 KiB head and tail windows summarised.
  summary(): ReturnType<typeof summarize> {
    const path = this.path!;
    const bytes = readFileSync(path);
    const stat = statSync(path);
    const head = bytes.subarray(0, HEAD_TAIL_BYTES);
    const tail = bytes.subarray(Math.max(0, bytes.length - HEAD_TAIL_BYTES));
    return summarize(head, tail, { size: stat.size, mtimeMs: stat.mtimeMs, birthtimeMs: stat.birthtimeMs }, path, dirname(path).split('/').pop()!);
  }
}

interface Replayed {
  step: string;
  record: SessionRecord;
}

describe('the working folder on the routes (§E)', () => {
  let tree: ReturnType<typeof tempDir>;
  const indexes: Index[] = [];
  const at = (rel: string) => join(tree.path, 'probe', rel);
  const work = () => at('work');
  const alpha = () => at('work/.claude/worktrees/pz-alpha');
  const beta = () => at('work/.claude/worktrees/pz-beta');

  // The probe's repository: `work` on master, `.claude/worktrees/pz-alpha` on worktree-pz-alpha (the tool's), and
  // `.claude/worktrees/pz-beta` on pz-beta with a `sub` folder (made by hand, reached by `cd`).
  beforeAll(async () => {
    tree = tempDir('maws-routes-');
    await gitCheckout(work(), 'master');
    await gitWorktree(work(), alpha(), 'worktree-pz-alpha');
    await gitWorktree(work(), beta(), 'pz-beta');
    mkdirSync(join(beta(), 'sub'));
  });
  afterAll(() => {
    for (const index of indexes) index.close();
    tree.dispose();
  });

  const openIndex = (name: string) => {
    const index = new Index(join(tree.path, `${name}.sqlite`));
    indexes.push(index);
    return index;
  };

  // The recorded steps of one session, replayed through `summarize` and one index in step order. The headless
  // session's resume (uxwave-folder-headless-resume.jsonl) is the same session's next step, `s9-after-resume`.
  const replayProbe = (name: string, files: string[]): { steps: Replayed[]; recorded: Map<string, IndexStep>; probeRoot: string } => {
    const steps = files.flatMap(stepRecords);
    const mainFile = (file: string) => /^[^/]+\/[^/]+\.jsonl$/.test(file);
    const first = steps[0].transcript.find((t) => mainFile(t.file))!;
    const sessionId = first.file.split('/')[1].replace(/\.jsonl$/, '');
    const probeRoot = dirname(first.added.find((row) => typeof row.cwd === 'string')!.cwd as string);
    const reroot = (value: unknown) => (typeof value === 'string' && value.startsWith(`${probeRoot}/`) ? at(value.slice(probeRoot.length + 1)) : value);
    const folderOfSlug = new Map(['work', 'work/.claude/worktrees/pz-alpha'].map((rel) => [slugOf(`${probeRoot}/${rel}`), at(rel)]));
    const index = openIndex(name);
    const transcript = new Transcript(join(tree.path, `${name}-store`), sessionId);
    const rows = new Map<number, object>();
    const replayed: Replayed[] = [];
    for (const step of steps) {
      const main = step.transcript.find((t) => mainFile(t.file))!;
      for (const row of main.added) rows.set(row.i, Object.fromEntries(ROW_KEYS.filter((key) => key in row).map((key) => [key, reroot(row[key])])));
      const kept = [...rows].filter(([i]) => i < main.total).sort(([a], [b]) => a - b).map(([, row]) => row);
      const folder = folderOfSlug.get(main.file.split('/')[0]);
      expect(folder, `${name} ${step.name}: a project folder of the probe's`).toBeDefined();
      transcript.write(folder!, kept);
      const { record } = index.sessions.upsertFromSummary(transcript.summary());
      expect(record.engineSessionId).toBe(sessionId as SessionId);
      replayed.push({ step: step.name, record });
    }
    const recorded = JSON.parse(readFileSync(join(PROBE, `uxwave-folder-index-${name}.json`), 'utf8')) as IndexStep[];
    return { steps: replayed, recorded: new Map(recorded.map((entry) => [entry.step, entry])), probeRoot };
  };

  // §E's first table; folders relative to the probe's scratch root, the selector's `launch` being `work` at every step.
  const table = (step: string) => {
    if (step === 's0-start') return { path: work(), cwd: work(), moved: false, branch: 'master', worktree: null, facts: 'neither' };
    if (step === 's1-enter-worktree' || step === 's2-run-there')
      return { path: alpha(), cwd: alpha(), moved: true, branch: 'worktree-pz-alpha', worktree: { path: alpha(), branch: 'worktree-pz-alpha' }, facts: 'launch' };
    if (step === 's4-cd-second-worktree' || step === 's4b-run-after-cd') return { path: beta(), cwd: beta(), moved: true, branch: 'pz-beta', worktree: { path: beta(), branch: 'pz-beta' }, facts: 'agent' };
    if (step === 's5-cd-subfolder' || step === 's5b-run-after-subfolder')
      return { path: beta(), cwd: join(beta(), 'sub'), moved: true, branch: 'pz-beta', worktree: { path: beta(), branch: 'pz-beta' }, facts: 'agent' };
    return { path: work(), cwd: work(), moved: false, branch: 'master', worktree: null, facts: 'neither' }; // s3, s3b, s6 and every later step
  };
  const factsOf = (record: SessionRecord) => (record.launchFolder !== undefined ? (record.agentFolder !== undefined ? 'both' : 'launch') : record.agentFolder !== undefined ? 'agent' : 'neither');

  const fixtures = {
    headless: ['uxwave-folder-headless.jsonl', 'uxwave-folder-headless-resume.jsonl'],
    terminal: ['uxwave-folder-terminal.jsonl'],
  } as const;
  const replays = new Map<string, ReturnType<typeof replayProbe>>();
  const replay = (name: keyof typeof fixtures) => {
    let found = replays.get(name);
    if (found === undefined) replays.set(name, (found = replayProbe(name, [...fixtures[name]])));
    return found;
  };

  describe.each(Object.keys(fixtures) as (keyof typeof fixtures)[])('the %s session', (name) => {
    it("keeps build F's fields as the index recorded them before this landing, and the selector answers §E's folders at every step", () => {
      const { steps, recorded, probeRoot } = replay(name);
      const reroot = (value: string) => (value.startsWith(`${probeRoot}/`) ? at(value.slice(probeRoot.length + 1)) : value);
      for (const { step, record } of steps) {
        const before = recorded.get(step);
        expect(before, `${step}: recorded by the probe's index`).toBeDefined();
        expect({ directory: record.directory, worktree: record.worktree, branch: record.branch }, step).toEqual({
          directory: reroot(before!.record.directory),
          worktree: before!.record.worktree === null ? null : { path: reroot(before!.record.worktree.path), branch: before!.record.worktree.branch },
          branch: before!.record.branch,
        });
        const folder = workingFolder(record);
        const want = table(step);
        expect(folder.launch, `${step}: launch`).toBe(work());
        expect({ path: folder.path, cwd: folder.cwd, moved: folder.moved }, step).toEqual({ path: want.path, cwd: want.cwd, moved: want.moved });
        expect(folder.moved, step).toBe(folder.path !== folder.launch);
        expect(factsOf(record), `${step}: the facts behind the table`).toBe(want.facts);
      }
      expect(steps.map((s) => s.step)).toContain('s5b-run-after-subfolder');
    });

    // M3 (§G): the files service reads the selector's working folder and launch folder at every step, through the admission
    it("gives the files service the selector's working folder and launch folder as roots at every step", async () => {
      for (const { step, record } of replay(name).steps) {
        const folder = workingFolder(record);
        expect(await rootsOf(record), step).toEqual(expect.arrayContaining([folder.path, folder.launch]));
      }
    });

    it('names the working folder\'s branch and worktree at every step', () => {
      for (const { step, record } of replay(name).steps) {
        const want = table(step);
        expect({ branch: workingBranch(record), worktree: workingWorktree(record) }, step).toEqual({ branch: want.branch, worktree: want.worktree });
      }
    });
  });

  it('gives the headless session and the terminal session the same answer at every step both recorded', () => {
    const answer = ({ record }: Replayed) => ({ ...workingFolder(record), branch: workingBranch(record), worktree: workingWorktree(record) });
    const terminal = new Map(replay('terminal').steps.map((s) => [s.step, answer(s)]));
    const shared = replay('headless').steps.filter((s) => terminal.has(s.step));
    expect(shared.length).toBeGreaterThanOrEqual(12);
    for (const step of shared) expect(answer(step), step.step).toEqual(terminal.get(step.step));
  });

  // §E's second table: a session launched in `packages/app`, a sub-folder of its repository, whose project directory is
  // that sub-folder (the index's grouping is no test of repository identity, Decision Log 3, finding D).
  it('follows a session launched in a sub-folder into a worktree the engine made and one registered by hand, and back', async () => {
    const repo = join(tree.path, 'sub-launch', 'repo');
    await gitCheckout(repo, 'main', { 'packages/app/index.ts': 'export {};\n' });
    const app = join(repo, 'packages/app');
    const w1 = await gitWorktree(repo, join(repo, '.claude/worktrees/w1'), 'worktree-w1');
    const wt = await gitWorktree(repo, join(app, 'wt'), 'side');
    const index = openIndex('sub-launch');
    const transcript = new Transcript(join(tree.path, 'sub-launch', 'store'), '6f0c3d2a-5b1e-4c7d-9a8f-2e4b6d8c0a13');
    const rows: object[] = [];
    const turn = (cwd: string, gitBranch: string) => rows.push({ type: 'user', cwd, gitBranch, isSidechain: false }, { type: 'assistant', cwd, gitBranch, isSidechain: false });
    const relocated = (to: string) => rows.push({ type: 'relocated', relocatedCwd: to });
    const apply = (filed: string) => {
      transcript.write(filed, rows);
      return index.sessions.upsertFromSummary(transcript.summary()).record;
    };
    const answer = (record: SessionRecord) => ({
      directory: record.directory,
      worktree: record.worktree,
      ...workingFolder(record),
      branch: workingBranch(record),
      workingWorktree: workingWorktree(record),
    });
    const home = { directory: app, worktree: null, path: app, cwd: app, launch: app, moved: false, branch: 'main', workingWorktree: null };

    turn(app, 'main');
    expect(answer(apply(app)), 'start in packages/app').toEqual(home);

    relocated(w1);
    turn(w1, 'worktree-w1');
    const inW1 = { worktree: { path: w1, branch: 'worktree-w1' }, path: w1, launch: app, moved: true, branch: 'worktree-w1', workingWorktree: { path: w1, branch: 'worktree-w1' } };
    expect(answer(apply(w1)), 'the tool enters .claude/worktrees/w1').toEqual({ ...inW1, directory: w1, cwd: w1 });

    relocated(join(w1, 'packages/app'));
    turn(join(w1, 'packages/app'), 'worktree-w1');
    expect(answer(apply(join(w1, 'packages/app'))), 'the home names w1/packages/app').toEqual({ ...inW1, directory: join(w1, 'packages/app'), cwd: join(w1, 'packages/app') });

    relocated(app);
    turn(app, 'main');
    expect(answer(apply(app)), 'the tool leaves').toEqual(home);

    turn(wt, 'main'); // a `cd`: the rows' branch stays the one the engine named at the launch folder
    expect(answer(apply(app)), 'cd into packages/app/wt').toEqual({ ...home, path: wt, cwd: wt, moved: true, branch: 'side', workingWorktree: { path: wt, branch: 'side' } });

    turn(app, 'main');
    expect(answer(apply(app)), 'cd back').toEqual(home);
  });
});
