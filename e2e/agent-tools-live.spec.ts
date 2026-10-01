// C8b's live acceptance (C8b execution document, acceptance item 4, steps (i) to (x)), through Playwright against the
// built app with the renderer's development surface on (`window.__maws_agents`, which App.tsx's C8b block sets only in a
// development build; `e2e/support/dev-surface.vite.config.mjs` builds the product that way), with the window hidden.
// One session, created with the pinned binary through ClaudeUsage's relay in a scratch clone of this repository, lives
// in a scratch CLAUDE_CONFIG_DIR that the app runs over; MAWS resumes it and drives each step's turn through
// `session.send`, while the panel's tools are read and clicked as the owner would. The event log each step reads is
// `session.events` filtered to the task kinds; the relay's delivery evidence is the child's inbox file and the
// `queued_command` attachment in its disk transcript (O3). A second app launch over the same home reads the session from
// disk (x) and then resumes it under CLAUDE_CODE_TASK_LIST_ID (ix's override) with the engine's fork gate off, so that a
// foreground dispatch really runs in the foreground (vii; the product's launch backgrounds every agent). Children run on haiku
// (`subagentModel`), the parent on Sonnet. What the run measured is printed as `[c8b-live]` lines and written to
// `<scratch>/observations.json`, the journals copied beside it. The owner's ~/.claude and ~/.claude.json are only read,
// after the run, to check that nothing names it. Run on purpose only; it spends money (about US$1.7–1.9
// per full run, measured 2026-09-29):
//   pnpm exec electron-vite build -c e2e/support/dev-surface.vite.config.mjs
//   MAWS_C8B_LIVE=1 pnpm exec playwright test e2e/agent-tools-live.spec.ts
// MAWS_C8B_LIVE_STEPS=i,ii,… runs a subset (setup always runs); MAWS_C8B_LIVE_KEEP=1 keeps the scratch clone and home.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { ENGINE_BIN, ENGINE_VERSION, GATEWAY_AUTH_TOKEN, RELAY_URL } from '../src/engine-host/launch';
import { scratchConfigHome } from '../test/live/support/live';
import { launchMaws, REPO_ROOT, test, type MawsLaunch } from './support/launch';
import { sidebarRow } from './support/sidebar';

function skipReason(): string | null {
  if (process.env.MAWS_C8B_LIVE !== '1') return 'the C8b live acceptance runs only under MAWS_C8B_LIVE=1';
  if (!existsSync(ENGINE_BIN)) return `engine binary missing at ${ENGINE_BIN}`;
  const version = execFileSync(ENGINE_BIN, ['--version'], { encoding: 'utf8', timeout: 15_000 }).trim();
  if (!version.startsWith(ENGINE_VERSION)) return `engine reports ${version}, expected ${ENGINE_VERSION}`;
  const code = execFileSync('/usr/bin/curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', `${RELAY_URL}/api/hello`], { encoding: 'utf8' }).trim();
  if (code !== '200') return `relay at ${RELAY_URL} answered ${code}: start ClaudeUsage`;
  const main = readdirSync(join(REPO_ROOT, 'out/renderer/assets')).filter((f) => f.startsWith('index-') && f.endsWith('.js'));
  if (!main.some((f) => readFileSync(join(REPO_ROOT, 'out/renderer/assets', f), 'utf8').includes('__maws_agents'))) {
    return 'the build has no development surface: pnpm exec electron-vite build -c e2e/support/dev-surface.vite.config.mjs';
  }
  return null;
}
const skip = skipReason();
test.skip(skip !== null, skip ?? '');
test.describe.configure({ timeout: 75 * 60_000 });

const STEPS = new Set((process.env.MAWS_C8B_LIVE_STEPS ?? 'i,ii,iii,iv,v,vi,vii,viii,ix,x').split(',').map((s) => s.trim()));
const RUN = Date.now().toString(36);
// Distinct /tmp paths per run (the dispatch's rule), each named in the step's prompt.
const TMP = {
  perm: `/tmp/maws-c8b-${RUN}-perm-probe`,
  bg: `/tmp/maws-c8b-${RUN}-bg.txt`,
  stop: `/tmp/maws-c8b-${RUN}-relay-stop`,
  inbox: `/tmp/maws-c8b-${RUN}-inbox.txt`,
};
const TASK_LIST_OVERRIDE = `maws-live-test-${RUN}`;
const TASK_KINDS = new Set(['subagent.started', 'subagent.progress', 'subagent.finished', 'task.started', 'task.updated', 'task.notification', 'tasks.snapshot', 'workflow.progress', 'process.exited']);
// The pass-2 script (scenarios/pass2/workflow.mjs) and the pass-3 slow one (scenarios/pass3/stop-task.mjs).
const WORKFLOW_SCRIPT = `export const meta = { name: 'maws-probe', description: 'Two echo agents in one phase', phases: [{ title: 'Echo' }] }
phase('Echo')
const out = await parallel([() => agent('Reply with exactly ALPHA and nothing else.', {label: 'alpha', effort: 'low'}), () => agent('Reply with exactly BETA and nothing else.', {label: 'beta', effort: 'low'})])
return out`;
const SLOW_WORKFLOW_SCRIPT = `export const meta = { name: 'maws-stop-task', description: 'One slow agent', phases: [{ title: 'Wait' }] }
phase('Wait')
return await agent('Run "sleep 90" with Bash, then reply SLOW.', { label: 'slow', effort: 'low' })`;

type Ev = { id: string; kind: string; seq: number | null; at: string; agentId: string | null } & Record<string, unknown>;
type Status = {
  process: string; turn: { origin: string } | null; taskListId: string | null; journalPath: string; launchId: string; engineSessionId: string | null;
  backgroundTasks: { taskId: string; taskType: string }[]; permissionMode: { effective: string }; pendingRequests: number;
};
type Invoke = (name: string, input: Record<string, unknown>) => Promise<unknown>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).trim();

// ---- the in-page probe ---------------------------------------------------------------------------------------------------
// Installed once per page: DOM readers for the three tools (the selectors the harness's agentsProbes reads) and a
// recorder that notes, on every DOM mutation, when an agent row first showed and in which section, each row's elapsed and
// line, each workflow card's phases, a `stopping…` sighting per card and the relay line's history.
function installProbes(): void {
  const w = window as unknown as { __c8b?: unknown };
  if (w.__c8b) return;
  const text = (el: Element | null | undefined) => el?.textContent?.trim() ?? '';
  const all = <E extends Element = Element>(root: ParentNode | null | undefined, selector: string): E[] => Array.from(root?.querySelectorAll<E>(selector) ?? []);
  const panel = () => document.querySelector<HTMLElement>('[data-region="panel"]');
  const tabpanel = () => panel()?.querySelector<HTMLElement>('[role="tabpanel"]') ?? null;
  type Hist = { t: number; v: string }[];
  const rec = {
    rows: {} as Record<string, { firstSeen: number; sections: { t: number; v: string }[]; elapsed: Hist; lines: Hist }>,
    cards: {} as Record<string, Hist>,
    stopping: {} as Record<string, number>,
    relay: [] as Hist,
  };
  const push = (h: Hist, v: string, cap: number) => {
    if (h.at(-1)?.v !== v && h.length < cap) h.push({ t: Date.now(), v });
  };
  const scan = () => {
    const root = panel();
    if (!root) return;
    for (const row of all<HTMLElement>(root, '[data-agent-row]')) {
      const id = row.dataset.agentRow!;
      const r = (rec.rows[id] ??= { firstSeen: Date.now(), sections: [], elapsed: [], lines: [] });
      push(r.sections, row.closest('section')?.getAttribute('data-section') ?? '', 10);
      push(r.elapsed, text(row.querySelector('[data-part="elapsed"]')), 30);
      push(r.lines, text(row.querySelector('[data-part="line"]')), 30);
    }
    for (const card of all<HTMLElement>(root, '[data-workflow]')) {
      const phases = all(card, '[data-phase]').map(text).join(' | ');
      push((rec.cards[card.dataset.workflow!] ??= []), phases, 60);
    }
    for (const el of all<HTMLElement>(root, '[data-workflow], [data-shell]')) {
      if (all(el, 'button').some((b) => text(b) === 'stopping…')) rec.stopping[el.dataset.workflow ?? el.dataset.shell!] ??= Date.now();
    }
    const line = root.querySelector('[data-part="relay-line"]');
    push(rec.relay, line ? text(line) : '', 600);
  };
  new MutationObserver(scan).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });

  const subagents = () => {
    const body = tabpanel();
    const lists = body?.querySelector('[data-view="lists"]');
    const rows = (section: string) =>
      all<HTMLElement>(body, `section[data-section="${section}"] [data-agent-row]`).map((row) => ({
        agentId: row.dataset.agentRow!,
        depth: Number(row.dataset.depth),
        title: text(row.querySelector('[data-part="title"]')),
        elapsed: text(row.querySelector('[data-part="elapsed"]')),
        line: text(row.querySelector('[data-part="line"]')),
        waiting: row.querySelector('[data-part="waiting"]') !== null,
        nested: row.querySelector('[data-part="nested"]') !== null,
      }));
    const agent = body?.querySelector<HTMLElement>('[data-view="agent"]');
    const box = agent?.querySelector('textarea');
    return {
      headings: all(lists, 'section[data-section] > h3').map(text),
      notes: all(lists, ':scope > p').map(text),
      active: rows('active'),
      done: rows('done'),
      disk: rows('disk'),
      drillIn: agent
        ? {
            header: text(agent.querySelector('h2')),
            meta: text(agent.querySelector('[data-part="agent-meta"]')),
            dispatchedBy: text(agent.querySelector('[data-part="dispatched-by"]')),
            requestCards: agent.querySelectorAll('[data-request-card]').length,
            label: text(agent.querySelector('[data-key-sink="composer"] label')),
            disabled: box?.disabled ? box.placeholder : null,
            tooltip: box?.title || null,
            line: agent.querySelector('[data-part="relay-line"]') ? text(agent.querySelector('[data-part="relay-line"]')) : null,
          }
        : null,
      pending: Boolean(body?.querySelector('[data-view="pending"]')),
    };
  };
  const background = () => {
    const body = tabpanel();
    const tasks = body?.querySelector('section[data-section="tasks"]');
    return {
      headings: all(body, 'section[data-section] > h3').map(text),
      notes: all(body, 'p').map(text).filter(Boolean),
      workflows: all<HTMLElement>(body, '[data-workflow]').map((card) => ({
        taskId: card.dataset.workflow!,
        title: text(card.querySelector('h4')),
        line: text(card.querySelector('[data-part="line"]')),
        status: text(card.querySelector('[data-part="status"]')),
        phases: all(card, '[data-phase]').map(text),
        table: all(card, 'tbody tr').map((tr) => all(tr, 'td').map(text)),
        buttons: all(card, 'button').map(text),
      })),
      shells: all<HTMLElement>(body, '[data-shell]').map((row) => ({
        taskId: row.dataset.shell!,
        line: text(row.querySelector('[data-part="line"]')),
        output: all<HTMLButtonElement>(row, 'button').find((b) => text(b) === 'Output')?.disabled === false ? 'enabled' : 'disabled',
        buttons: all(row, 'button').map(text),
      })),
      monitors: all<HTMLElement>(body, '[data-monitor]').map((row) => text(row)),
      tasks: {
        heading: text(tasks?.querySelector('h3')),
        label: tasks?.querySelector('[data-part="label"]') ? text(tasks.querySelector('[data-part="label"]')) : null,
        rows: all(tasks, '[data-task]').map(text),
        text: text(tasks),
      },
    };
  };
  const log = () => {
    const body = tabpanel();
    const shown = body?.querySelector('[data-log]');
    return shown
      ? { heading: text(shown.querySelector('h2')), path: text(shown.querySelector('[data-part="path"]')), size: text(shown.querySelector('[data-part="size"]')), pages: body!.querySelectorAll('pre[data-log-page]').length }
      : { noFile: text(body?.querySelector('p')) };
  };
  w.__c8b = { rec, subagents, background, log };
}

type Probe = {
  rec: { rows: Record<string, { firstSeen: number; sections: { t: number; v: string }[]; elapsed: { t: number; v: string }[]; lines: { t: number; v: string }[] }>; cards: Record<string, { t: number; v: string }[]>; stopping: Record<string, number>; relay: { t: number; v: string }[] };
  subagents(): {
    headings: string[]; notes: string[];
    active: { agentId: string; depth: number; title: string; elapsed: string; line: string; waiting: boolean; nested: boolean }[];
    done: { agentId: string; depth: number; title: string; elapsed: string; line: string; waiting: boolean; nested: boolean }[];
    disk: { agentId: string; depth: number; title: string; elapsed: string; line: string; waiting: boolean; nested: boolean }[];
    drillIn: { header: string; meta: string; dispatchedBy: string; requestCards: number; label: string; disabled: string | null; tooltip: string | null; line: string | null } | null;
    pending: boolean;
  };
  background(): {
    headings: string[]; notes: string[];
    workflows: { taskId: string; title: string; line: string; status: string; phases: string[]; table: string[][]; buttons: string[] }[];
    shells: { taskId: string; line: string; output: string; buttons: string[] }[];
    monitors: string[];
    tasks: { heading: string; label: string | null; rows: string[]; text: string };
  };
  log(): { heading?: string; path?: string; size?: string; pages?: number; noFile?: string };
};
const probe = <T,>(page: Page, read: (p: Probe) => T): Promise<T> => page.evaluate(`(${read.toString()})(window.__c8b)`) as Promise<T>;

// ---- the session driver ----------------------------------------------------------------------------------------------------

// One engine launch of the session, seen from the app: its event log (`session.events` read incrementally), its status,
// sends, and the waits the steps need. Permission requests nobody asked for are allowed once and recorded (auto mode's
// classifier may escalate a scratch-directory write), except while a step holds them for its own card.
class Session {
  events: Ev[] = [];
  private lastSeq: number | null = null;
  holdChildPermissions = false;
  readonly stray: { toolName: string; agentId: string | null; input: unknown }[] = [];
  private answered = new Set<string>();

  constructor(
    readonly page: Page,
    readonly invoke: Invoke,
    readonly appId: string,
    readonly title: string,
  ) {}

  async status(): Promise<Status> {
    return ((await this.invoke('session.status', { appSessionId: this.appId })) as { value: Status }).value;
  }

  async pull(): Promise<Ev[]> {
    const r = (await this.invoke('session.events', { appSessionId: this.appId, afterSeq: this.lastSeq, limit: null })) as { ok: boolean; value?: { events: Ev[]; lastSeq: number | null } };
    if (!r.ok || !r.value) return this.events;
    const fresh = r.value.events.filter((e) => e.seq === null || this.lastSeq === null || e.seq > this.lastSeq);
    this.events.push(...fresh);
    if (r.value.lastSeq !== null) this.lastSeq = r.value.lastSeq;
    await this.answerStray();
    return this.events;
  }

  private async answerStray(): Promise<void> {
    const resolved = new Set(this.events.filter((e) => e.kind === 'permission.resolved').map((e) => e.requestId as string));
    for (const e of this.events) {
      if (e.kind !== 'permission.requested' || resolved.has(e.requestId as string) || this.answered.has(e.requestId as string)) continue;
      if (this.holdChildPermissions && e.agentId !== null) continue;
      this.answered.add(e.requestId as string);
      this.stray.push({ toolName: e.toolName as string, agentId: e.agentId, input: e.input });
      await this.invoke('session.answer', { appSessionId: this.appId, requestId: e.requestId, answer: { kind: 'permission', decision: 'allow', scope: 'once' } });
    }
  }

  get seq(): number {
    return this.lastSeq ?? 0;
  }

  async until<T>(what: string, find: (events: Ev[]) => T | undefined | null | false, timeout = 180_000): Promise<T> {
    const deadline = Date.now() + timeout;
    for (;;) {
      const found = find(await this.pull());
      if (found !== undefined && found !== null && found !== false) return found;
      if (Date.now() > deadline) throw new Error(`timed out after ${timeout / 1000} s waiting for ${what}`);
      await sleep(400);
    }
  }

  async send(prompt: string): Promise<number> {
    await this.pull();
    const from = this.seq;
    const r = (await this.invoke('session.send', { appSessionId: this.appId, content: prompt })) as { ok: boolean; error?: { message: string } };
    if (!r.ok) throw new Error(`session.send refused: ${r.error?.message}`);
    return from;
  }

  // The parent idle: no open turn for `quiet` ms running.
  async idle(timeout = 300_000, quiet = 4_000): Promise<void> {
    const deadline = Date.now() + timeout;
    let since: number | null = null;
    for (;;) {
      await this.pull();
      const s = await this.status();
      if (s.turn === null && s.pendingRequests === 0) {
        since ??= Date.now();
        if (Date.now() - since >= quiet) return;
      } else since = null;
      if (Date.now() > deadline) throw new Error('timed out waiting for the parent to go idle');
      await sleep(500);
    }
  }

  after(seq: number): Ev[] {
    return this.events.filter((e) => e.seq !== null && e.seq > seq);
  }

  taskLog(fromSeq: number, taskId?: string): string[] {
    return this.after(fromSeq)
      .filter((e) => TASK_KINDS.has(e.kind) && e.kind !== 'subagent.progress' && e.kind !== 'workflow.progress')
      .filter((e) => taskId === undefined || e.kind === 'tasks.snapshot' || e.taskId === taskId)
      .map((e) => {
        if (e.kind === 'tasks.snapshot') return `${e.seq} tasks.snapshot [${(e.tasks as { taskId: string }[]).map((t) => t.taskId).join(', ')}]`;
        if (e.kind === 'task.updated') return `${e.seq} task.updated ${e.taskId} ${JSON.stringify(e.patch)}`;
        const status = (e.status as string | undefined) ?? '';
        return `${e.seq} ${e.kind} ${(e.taskId as string | undefined) ?? ''} ${status}`.trim();
      });
  }
}

// R6's order in a stop's task log (`Session.taskLog` lines): a snapshot that omits the task, then `task.updated` with
// `killed`, then `task.notification` `stopped`.
function expectStopOrder(order: string[], taskId: string): void {
  const kinds = order.map((l) => l.split(' ')[1]);
  const snapshot = kinds.indexOf('tasks.snapshot');
  const updated = kinds.indexOf('task.updated');
  const notification = kinds.indexOf('task.notification');
  expect(snapshot, `a tasks.snapshot in ${JSON.stringify(order)}`).toBeGreaterThanOrEqual(0);
  expect(order[snapshot], 'the snapshot omits the stopped task').not.toContain(taskId);
  expect(snapshot).toBeLessThan(updated);
  expect(order[updated]).toContain('"status":"killed"');
  expect(updated).toBeLessThan(notification);
  expect(order[notification]).toMatch(/ stopped$/);
}

const tabOf = (page: Page, name: string) => page.locator('[data-region="panel"] [role="tab"]').filter({ hasText: new RegExp(`^${name}`) });
async function showTool(page: Page, name: 'Subagents' | 'Background work'): Promise<void> {
  if ((await tabOf(page, name).count()) > 0) {
    await tabOf(page, name).first().click();
    return;
  }
  await page.locator('[data-region="panel"]').getByRole('button', { name: 'Add a tool' }).click();
  await page.getByRole('menuitem', { name }).click();
  await expect(tabOf(page, name)).toHaveCount(1);
}

// The owner's home after the run, read only (C8c's check): nothing in ~/.claude/history.jsonl or ~/.claude.json names the
// run's session or scratch, and ~/.claude/projects has no folder for it.
function ownerHomeNames(sessionId: string, scratch: string): string[] {
  const home = join(homedir(), '.claude');
  const read = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : '');
  const hits: string[] = [];
  for (const path of [join(home, 'history.jsonl'), join(homedir(), '.claude.json')]) {
    const t = read(path);
    if (t.includes(sessionId) || t.includes(basename(scratch))) hits.push(path);
  }
  const projects = join(home, 'projects');
  if (existsSync(projects)) hits.push(...readdirSync(projects).filter((name) => name.includes(basename(scratch))).map((n) => join(projects, n)));
  return hits;
}

function findFile(dir: string, name: string): string | null {
  if (!existsSync(dir)) return null;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(path, name);
      if (found) return found;
    } else if (entry.name === name) return path;
  }
  return null;
}

// What one launch cost: the engine's cumulative `total_cost_usd` on its last main-lane result (C7's `processCost`).
function journalCost(path: string): number {
  if (!existsSync(path)) return 0;
  const costs = readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { direction: string; frame: { type?: string; total_cost_usd?: number; parent_tool_use_id?: string | null } })
    .filter((row) => row.direction === 'in' && row.frame.type === 'result' && !row.frame.parent_tool_use_id)
    .map((row) => row.frame.total_cost_usd ?? 0);
  return Math.max(0, ...costs);
}

test('live: the agent tools over a real session (acceptance item 4, steps i to x)', async () => {
  const observed: Record<string, unknown> = { run: RUN, tmp: TMP };
  const failures: string[] = [];
  const scratch = realpathSync(mkdtempSync('/tmp/maws-c8b-live-'));
  const config = join(scratch, 'claude-config');
  execFileSync('/bin/mv', [scratchConfigHome(), config]);
  const clone = join(scratch, 'maws');
  git(scratch, 'clone', '--quiet', REPO_ROOT, clone);
  writeFileSync(join(clone, 'README.md'), '# MAWS (scratch clone)\n\nThe relay agent reads this file between its sleeps.\n');
  const note = (key: string, value: unknown) => {
    observed[key] = value;
    writeFileSync(join(scratch, 'observations.json'), JSON.stringify(observed, null, 2));
    console.log(`[c8b-live] ${key} ${JSON.stringify(value)}`);
  };
  const journals: string[] = [];
  const kept = join(scratch, 'journals');
  mkdirSync(kept, { recursive: true });
  // C3 journals under the app's profile, which the launch's cleanup removes: copied before each cleanup.
  const keepJournals = () => {
    for (const path of journals) if (existsSync(path)) cpSync(path, join(kept, basename(path)));
  };
  let maws: MawsLaunch | null = null;

  const engineEnv: Record<string, string> = { TERM: 'xterm-256color', LANG: process.env.LANG ?? 'en_US.UTF-8' };
  for (const key of ['PATH', 'HOME', 'USER', 'SHELL', 'TMPDIR']) if (process.env[key]) engineEnv[key] = process.env[key]!;
  Object.assign(engineEnv, { CLAUDE_CONFIG_DIR: config, ANTHROPIC_BASE_URL: RELAY_URL, ANTHROPIC_AUTH_TOKEN: GATEWAY_AUTH_TOKEN });
  let created: { session_id: string; total_cost_usd: number };
  try {
    created = JSON.parse(
      execFileSync(ENGINE_BIN, ['-p', 'Reply with exactly: C8B LIVE READY', '--model', 'sonnet', '--max-budget-usd', '0.5', '--output-format', 'json'], {
        cwd: clone,
        env: engineEnv,
        encoding: 'utf8',
        timeout: 180_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    ) as { session_id: string; total_cost_usd: number };
  } catch (error) {
    rmSync(scratch, { recursive: true, force: true }); // nothing was measured: the clone and the home go
    throw error;
  }
  note('created', { sessionId: created.session_id, costUsd: created.total_cost_usd });

  // Runs one lettered step; a failure is recorded and the run goes on to the next step, so one live run reports them all.
  const step = async (id: string, name: string, body: () => Promise<void>) => {
    if (!STEPS.has(id)) return;
    try {
      await test.step(`(${id}) ${name}`, body);
    } catch (error) {
      const message = error instanceof Error ? error.message.split('\n').slice(0, 6).join(' / ') : String(error);
      failures.push(`(${id}) ${message}`);
      note(`failed:${id}`, message);
    }
  };

  const open = async (env: Record<string, string>) => {
    const launch = await launchMaws({ env: { CLAUDE_CONFIG_DIR: config, MAWS_HARNESS: '0', CLAUDE_CODE_ENABLE_TODO_TOOLS: '1', ...env } });
    await launch.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
    const page = launch.page;
    const invoke: Invoke = (name, input) => page.evaluate(([n, i]) => window.maws.invoke(n as never, i as never), [name, input] as const);
    let record: { appId: string; title: { text: string }; directory: string } | undefined;
    await expect
      .poll(
        async () => {
          const listed = (await invoke('session.list', {})) as { value?: { sessions: { appId: string; engineSessionId: string | null; title: { text: string }; directory: string }[] } };
          record = listed.value?.sessions.find((s) => s.engineSessionId === created.session_id);
          return record !== undefined;
        },
        { timeout: 30_000, message: 'C4’s index lists the session' },
      )
      .toBe(true);
    await page.evaluate(installProbes);
    // By the record's id: the title follows the session's latest prompt (the record's summary), so it changes as the run
    // goes. W5: the row is on its project's page, opened first.
    await (await sidebarRow(page, { appSessionId: record!.appId })).click();
    return { launch, page, invoke, record: record! };
  };
  const launchSession = async (invoke: Invoke, record: { appId: string; directory: string }, maxBudgetUsd: number, extraEnv: Record<string, string> | null = null) => {
    const spec = {
      appSessionId: record.appId, cwd: record.directory, additionalDirectories: [], model: 'sonnet', effort: null, permissionMode: 'auto',
      gateway: 'gateway', subagentModel: 'haiku', resume: { sessionId: created.session_id, fork: false }, sessionId: null, trust: null, mcpConfig: null,
      extraSettings: { enableWorkflows: true, skipWorkflowUsageWarning: true, ...(extraEnv ? { env: extraEnv } : {}) }, maxBudgetUsd, replay: null, inheritGrantsFrom: null,
    };
    const launched = (await invoke('session.launch', { spec })) as { ok: boolean };
    expect(launched, JSON.stringify(launched)).toMatchObject({ ok: true });
    await expect.poll(async () => (((await invoke('session.status', { appSessionId: record.appId })) as { value?: Status }).value?.process), { timeout: 90_000 }).toBe('ready');
  };

  try {
    // ---- launch 1: the live steps ---------------------------------------------------------------------------------------
    const first = await open({});
    maws = first.launch;
    const { page, invoke, record } = first;
    await launchSession(invoke, record, 3);
    const s = new Session(page, invoke, record.appId, record.title.text);
    const status0 = await s.status();
    journals.push(status0.journalPath);
    note('session', { appId: record.appId, title: record.title.text, directory: record.directory, taskListId: status0.taskListId, mode: status0.permissionMode });
    const panel = page.locator('[data-region="panel"]');
    const agents = <T,>(read: string) => page.evaluate(`(() => { const a = window.__maws_agents; return (${read})(a); })()`) as Promise<T>;
    const ids = { first: [] as string[], perm: '', relayBusy: '', relayIdle: '', foreground: '' };

    await step('i', 'two background agents under Active, then Done', async () => {
      await showTool(page, 'Subagents');
      const from = await s.send('Dispatch two general-purpose agents in the background, model haiku: one lists the files under docs/, the other under mockups/; report both.');
      const started = await s.until('two subagent.started', (ev) => {
        const found = ev.filter((e) => e.seq !== null && e.seq > from && e.kind === 'subagent.started');
        return found.length >= 2 ? found.slice(0, 2) : undefined;
      });
      ids.first = started.map((e) => e.taskId as string);
      await expect.poll(() => probe(page, (p) => p.subagents().headings), { timeout: 15_000 }).toContain('Active · 2');
      const shownActive = await probe(page, (p) => p.subagents().active);
      const t1 = await probe(page, (p) => p.subagents().active.map((r) => r.elapsed));
      await sleep(2_200);
      const t2 = await probe(page, (p) => p.subagents().active.map((r) => r.elapsed));
      const rec = await probe(page, (p) => p.rec.rows);
      const latency = started.map((e) => ({ agentId: e.taskId, description: e.description, isBackground: e.isBackground, startedAt: e.at, rowShownAfterMs: rec[e.taskId as string] ? rec[e.taskId as string].firstSeen - Date.parse(e.at) : null }));
      note('i.active', { rows: shownActive, elapsedThen: t1, elapsedLater: t2, latency });
      expect(t1).not.toEqual(t2);
      for (const l of latency) expect(l.rowShownAfterMs, `row of ${l.agentId} shown within a second of its start`).toBeLessThan(1_000);
      await s.until('both agents finished', (ev) => ids.first.every((id) => ev.some((e) => e.kind === 'subagent.finished' && e.taskId === id)), 240_000);
      await expect.poll(() => probe(page, (p) => p.subagents().headings), { timeout: 15_000 }).toContain('Done · 2');
      const done = await probe(page, (p) => p.subagents().done);
      note('i.done', { rows: done, finished: s.after(from).filter((e) => e.kind === 'subagent.finished').map((e) => ({ taskId: e.taskId, status: e.status, summary: e.summary })) });
      for (const row of done.filter((r) => ids.first.includes(r.agentId))) expect(row.line).toMatch(/^finished · /);
      await s.idle();
      note('i.log', s.taskLog(from));
    });

    await step('ii', 'the transcript row opens the drill-in; the agent tab shares its attachment', async () => {
      const opened = (await s.pull()).find((e) => e.kind === 'subagent.started' && (ids.first[0] === undefined || e.taskId === ids.first[0]));
      if (!opened) throw new Error('no agent to open (step i did not run)');
      const agentId = opened.taskId as string;
      const description = opened.description as string;
      await agents(`(a) => a.transcript.getState().expandAll(${JSON.stringify(record.appId)})`);
      await sleep(500);
      // The transcript is virtualised: the turn that dispatched the agents sits above the fold, so the list is walked
      // from its top until this agent's control (its glyph, `Open <description>`) is mounted, and that is clicked as the
      // owner would.
      const found = await page.evaluate(async (want) => {
        const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
        const main = document.querySelector('[data-region="main"]')!;
        let el: HTMLElement | null = main.querySelector<HTMLElement>('[data-index]')?.parentElement ?? null;
        while (el && el !== main && el.scrollHeight <= el.clientHeight) el = el.parentElement;
        if (!el || el === main) return { labels: [] as string[], clicked: false };
        el.scrollTop = 0;
        for (let i = 0; i < 400; i += 1) {
          await frame();
          const controls = Array.from(main.querySelectorAll<HTMLButtonElement>('button.transcript-subagent-line, button.transcript-glyph'));
          const labels = controls.map((c) => c.getAttribute('aria-label') ?? c.textContent?.trim() ?? '');
          const index = labels.indexOf(want);
          if (index >= 0) {
            controls[index].click();
            return { labels, clicked: true };
          }
          if (el.scrollTop + el.clientHeight >= el.scrollHeight) break;
          el.scrollTop += Math.max(200, el.clientHeight / 2);
        }
        return { labels: [] as string[], clicked: false };
      }, `Open ${description}`);
      if (!found.clicked) {
        await page.screenshot({ path: join(scratch, 'ii-main.png') }).catch(() => undefined);
        throw new Error(`no control "Open ${description}" in the main transcript, walked from its top`);
      }
      const labels = found.labels;
      await expect(tabOf(page, 'Subagents')).toHaveAttribute('aria-selected', 'true');
      await expect.poll(() => probe(page, (p) => p.subagents().drillIn?.header ?? null), { timeout: 10_000 }).not.toBeNull();
      const drill = await probe(page, (p) => p.subagents().drillIn);
      expect(drill?.header, 'the drill-in is on the agent whose control was clicked').toBe(description);
      const key = `${record.appId}:${agentId}`;
      const childTools = s.events.filter((e) => e.kind === 'tool.use' && e.agentId === agentId).map((e) => e.toolName);
      const rowsBefore = await agents<number>(`(a) => a.transcript.getState().rows(${JSON.stringify(key)}).length`);
      await agents(`(a) => a.layout.getState().openTab({ kind: 'agent', appSessionId: ${JSON.stringify(record.appId)}, agentId: ${JSON.stringify(agentId)} })`);
      await sleep(1_500);
      const keys = await agents<string[]>(`(a) => Object.keys(a.transcript.getState().entries).filter((k) => k.endsWith(${JSON.stringify(`:${agentId}`)}))`);
      const count = (selector: string) =>
        page.evaluate((sel) => {
          const root = document.querySelector(sel);
          const indexed = root ? Array.from(root.querySelectorAll<HTMLElement>('[data-index]')) : [];
          return indexed.length ? Math.max(...indexed.map((el) => Number(el.dataset.index))) + 1 : null;
        }, selector);
      const drillRows = await count('[data-region="panel"] [data-view="agent"]');
      const tabRows = await count('[data-region="main"]');
      const rowsAfter = await agents<number>(`(a) => a.transcript.getState().rows(${JSON.stringify(key)}).length`);
      note('ii', { transcriptControls: labels, drillIn: drill, childTools, storeRows: { before: rowsBefore, after: rowsAfter }, drillInRows: drillRows, agentTabRows: tabRows, keys });
      expect(keys).toEqual([key]);
      expect(drillRows).not.toBeNull();
      expect(drillRows).toBe(tabRows);
      // back to the session's main tab for the steps below
      await (await sidebarRow(page, { appSessionId: record.appId })).click();
    });

    await step('iii', 'a child’s permission renders inline and Allow lets it finish', async () => {
      const mode = (await invoke('session.setPermissionMode', { appSessionId: record.appId, mode: 'default' })) as { value?: { effective: string } };
      note('iii.mode', mode);
      expect(mode.value?.effective).toBe('default');
      s.holdChildPermissions = true;
      await showTool(page, 'Subagents');
      const from = await s.send(`Dispatch one general-purpose agent in the background, model haiku: run "touch ${TMP.perm}" with Bash and reply OK.`);
      const asked = await s.until('the child’s permission request', (ev) => ev.find((e) => e.seq !== null && e.seq > from && e.kind === 'permission.requested' && e.agentId !== null), 180_000);
      ids.perm = asked.agentId!;
      await expect.poll(() => probe(page, (p) => p.subagents().active.find((r) => r.waiting) ?? null), { timeout: 15_000 }).not.toBeNull();
      const row = (await probe(page, (p) => p.subagents().active)).find((r) => r.agentId === ids.perm);
      expect(row?.waiting, 'the waiting agent’s row carries the badge').toBe(true);
      expect(row?.line).toMatch(/^Approval needed · /);
      await panel.locator(`[data-agent-row="${ids.perm}"]`).click();
      const card = panel.locator('[data-view="agent"] [data-request-card]');
      await expect(card).toHaveCount(1, { timeout: 15_000 });
      const cardText = await card.textContent();
      await card.getByRole('button', { name: 'Allow', exact: true }).click();
      await s.until('the permission resolved', (ev) => ev.find((e) => e.kind === 'permission.resolved' && e.requestId === asked.requestId));
      await s.until('the agent finished', (ev) => ev.find((e) => e.kind === 'subagent.finished' && e.taskId === ids.perm), 180_000);
      await expect.poll(() => existsSync(TMP.perm), { timeout: 10_000 }).toBe(true);
      note('iii', { agentId: ids.perm, request: { toolName: asked.toolName, input: asked.input, decisionReasonType: asked.decisionReasonType }, row, card: cardText, touched: existsSync(TMP.perm) });
      s.holdChildPermissions = false;
      await s.idle();
      const back = (await invoke('session.setPermissionMode', { appSessionId: record.appId, mode: 'auto' })) as { value?: { effective: string } };
      note('iii.modeBack', back);
      await panel.getByRole('button', { name: '‹ Subagents' }).click();
    });

    await step('iv', 'a background shell: Output opens the Log, Stop reads stopping then stopped', async () => {
      await showTool(page, 'Background work');
      const from = await s.send(`Run exactly "sleep 300 && echo done > ${TMP.bg}" with Bash, run_in_background true; reply STARTED.`);
      const started = await s.until('the shell’s task.started', (ev) => ev.find((e) => e.seq !== null && e.seq > from && e.kind === 'task.started' && e.taskType === 'local_bash' && e.isBackground === true));
      const taskId = started.taskId as string;
      const row = panel.locator(`[data-shell="${taskId}"]`);
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect(row.getByRole('button', { name: 'Output' })).toBeEnabled({ timeout: 30_000 });
      const enabledAfterMs = Date.now() - Date.parse(started.at);
      const shell = (await probe(page, (p) => p.background().shells)).find((r) => r.taskId === taskId);
      const result = s.events.find((e) => e.kind === 'tool.result' && e.toolUseId === started.toolUseId);
      await row.getByRole('button', { name: 'Output' }).click();
      await expect(tabOf(page, 'Log')).toHaveCount(1);
      await expect.poll(() => probe(page, (p) => p.log().path ?? null), { timeout: 10_000 }).not.toBeNull();
      const log = await probe(page, (p) => p.log());
      note('iv.shell', { taskId, command: started.description, row: shell, outputEnabledAfterStartMs: enabledAfterMs, resultText: result?.content, log });
      expect(log.path).toMatch(/^\/private\/tmp\/claude-\d+\/.+\/tasks\/[^/]+\.output$/);
      await showTool(page, 'Background work');
      const stopFrom = s.seq;
      await row.getByRole('button', { name: 'Stop', exact: true }).click();
      await s.until('the shell’s task.notification', (ev) => ev.find((e) => e.kind === 'task.notification' && e.taskId === taskId), 30_000);
      await expect.poll(() => probe(page, (p) => p.background().shells.find((r) => r.line.includes('stopped'))?.line ?? null), { timeout: 10_000 }).not.toBeNull();
      const rec = await probe(page, (p) => p.rec.stopping);
      const order = s.taskLog(stopFrom, taskId);
      const stoppedLine = (await probe(page, (p) => p.background().shells)).find((r) => r.taskId === taskId)?.line;
      note('iv.stop', { stoppingSeen: rec[taskId] ?? null, line: stoppedLine, order });
      expect(rec[taskId], 'the shell’s row showed stopping…').toBeDefined();
      expect(stoppedLine).toMatch(/ · stopped /);
      expectStopOrder(order, taskId);
      await s.idle();
    });

    await step('v', 'a workflow shows its phases and table; Stop workflow ends a re-run', async () => {
      await showTool(page, 'Background work');
      const from = await s.send(`Call the Workflow tool once with this exact script as the script parameter, then reply STARTED:\n\n${WORKFLOW_SCRIPT}`);
      const started = await s.until('the workflow’s task.started', (ev) => ev.find((e) => e.seq !== null && e.seq > from && e.kind === 'task.started' && e.taskType === 'local_workflow'));
      const taskId = started.taskId as string;
      await s.until('the workflow’s notification', (ev) => ev.find((e) => e.kind === 'task.notification' && e.taskId === taskId), 300_000);
      await sleep(1_500);
      const card = (await probe(page, (p) => p.background().workflows)).find((c) => c.taskId === taskId);
      const history = (await probe(page, (p) => p.rec.cards))[taskId] ?? [];
      note('v.run', { taskId, description: started.description, workflowName: started.workflowName, card, phaseHistory: history.map((h) => h.v), frames: s.events.filter((e) => e.kind === 'workflow.progress' && e.taskId === taskId).length });
      const phases = history.map((h) => h.v).filter(Boolean);
      expect(phases[0], 'the first phase row: Echo 0/2, or Queued before any agent started').toMatch(/^Echo (0\/2|· Queued)$/);
      expect(phases.at(-1)).toBe('Echo 2/2');
      // `Echo 1/2` is recorded, not asserted: two agents finishing inside one progress frame would skip it.
      expect(card?.table.map((row) => row[2]), 'the table’s tokens').toEqual(card?.table.map(() => expect.stringMatching(/^\d+(\.\d)?[kM]?$/)));
      await s.idle();
      const again = await s.send(`Call the Workflow tool once with this exact script as the script parameter, then reply STARTED:\n\n${SLOW_WORKFLOW_SCRIPT}`);
      const slow = await s.until('the slow workflow’s task.started', (ev) => ev.find((e) => e.seq !== null && e.seq > again && e.kind === 'task.started' && e.taskType === 'local_workflow'));
      const slowId = slow.taskId as string;
      await s.until('the slow workflow’s first progress', (ev) => ev.find((e) => e.kind === 'workflow.progress' && e.taskId === slowId), 120_000);
      const cardLoc = panel.locator(`[data-workflow="${slowId}"]`);
      await expect(cardLoc.getByRole('button', { name: 'Stop workflow' })).toBeEnabled({ timeout: 15_000 });
      const stopFrom = s.seq;
      await cardLoc.getByRole('button', { name: 'Stop workflow' }).click();
      await s.until('the slow workflow’s notification', (ev) => ev.find((e) => e.kind === 'task.notification' && e.taskId === slowId), 30_000);
      await sleep(1_500);
      const stopped = (await probe(page, (p) => p.background().workflows)).find((c) => c.taskId === slowId);
      const order = s.taskLog(stopFrom, slowId);
      const stoppingSeen = (await probe(page, (p) => p.rec.stopping))[slowId];
      note('v.stop', { taskId: slowId, card: stopped, stoppingSeen: stoppingSeen ?? null, order });
      expect(stoppingSeen, 'the card showed stopping…').toBeDefined();
      expect(stopped?.status).toBe('stopped');
      expectStopOrder(order, slowId);
      await s.idle();
    });

    await step('vi', 'the relay: busy parent, then idle parent', async () => {
      rmSync(TMP.stop, { force: true });
      await showTool(page, 'Subagents');
      const relay = async (agentId: string, text: string, turnOpen: boolean) => {
        const back = panel.getByRole('button', { name: '‹ Subagents' });
        if (await back.isVisible()) await back.click();
        await panel.locator(`[data-agent-row="${agentId}"]`).click();
        const box = panel.locator('[data-view="agent"] textarea');
        await expect(box).toBeEnabled({ timeout: 10_000 });
        const before = await probe(page, (p) => p.subagents().drillIn);
        await box.fill(text);
        const sentFrom = s.seq;
        const sentAt = Date.now();
        await panel.locator('[data-view="agent"]').getByRole('button', { name: 'Send', exact: true }).click();
        await expect.poll(() => probe(page, (p) => p.subagents().drillIn?.line ?? ''), { timeout: 10_000 }).toMatch(/^Asked .+ to relay · /);
        const asked = await probe(page, (p) => p.subagents().drillIn?.line ?? '');
        if (turnOpen) expect(asked).toMatch(/forwards at its next tool boundary or when this turn ends$/);
        else expect(asked).not.toMatch(/ · .+ (forwards|is inside)/);
        const sendMessage = await s.until('the parent’s SendMessage to the agent', (ev) => ev.find((e) => e.seq !== null && e.seq > sentFrom && e.kind === 'tool.use' && e.agentId === null && e.toolName === 'SendMessage' && (e.input as { to?: string }).to === agentId), 240_000);
        await expect.poll(() => probe(page, (p) => p.subagents().drillIn?.line ?? ''), { timeout: 10_000 }).toMatch(/sent it with SendMessage after \d+ parent rounds? · .+ gets it at its next tool round$/);
        const forwarded = await probe(page, (p) => p.subagents().drillIn?.line ?? '');
        const reply = s.events.find((e) => e.kind === 'tool.result' && e.toolUseId === sendMessage.toolUseId);
        // The delivery's evidence (O3): the child appends the message to its inbox, and its disk transcript holds the
        // queued_command attachment; neither is a row the panel shows.
        const inboxAt = await (async () => {
          const deadline = Date.now() + 120_000;
          while (Date.now() < deadline) {
            if (existsSync(TMP.inbox) && readFileSync(TMP.inbox, 'utf8').includes(text)) return Date.now();
            await sleep(1_000);
          }
          return null;
        })();
        const transcript = findFile(join(config, 'projects'), `agent-${agentId}.jsonl`);
        const attachment = transcript
          ? readFileSync(transcript, 'utf8')
              .split('\n')
              .filter((l) => l.includes(text))
              .map((l) => JSON.parse(l) as { type?: string; attachment?: { type?: string; origin?: unknown }; isMeta?: boolean })
              .map((r) => ({ type: r.type, attachment: r.attachment?.type ?? null, origin: r.attachment?.origin ?? null, isMeta: r.isMeta ?? null }))
          : null;
        const resting = await probe(page, (p) => p.subagents().drillIn?.line ?? '');
        const lines = (await probe(page, (p) => p.rec.relay)).filter((h) => h.t >= sentAt - 1_000).map((h) => ({ ms: h.t - sentAt, v: h.v.replace(/ · \d+[smh][^·]*(?= · |$)/, ' · <elapsed>') }));
        const distinct = lines.filter((l, i) => i === 0 || l.v !== lines[i - 1].v);
        const parentRounds = /after (\d+) parent round/.exec(forwarded)?.[1] ?? null;
        return {
          agentId, before, asked, forwarded, resting, parentRounds, sentAt: new Date(sentAt).toISOString(),
          sendMessage: { input: sendMessage.input, at: sendMessage.at, seq: sendMessage.seq, afterSendMs: Date.parse(sendMessage.at) - sentAt },
          reply: reply?.content ?? null, inboxAfterSendMs: inboxAt === null ? null : inboxAt - sentAt, transcript, attachment, lineHistory: distinct,
        };
      };

      // Busy: the parent's turn is open (its own `sleep 60`) while the agent runs.
      // The item's wording ("…; then run "sleep 60" with Bash yourself and reply DONE.") left the parent's own sleep
      // to the model, which folded it into the agent's task on the first run; the two duties are spelled out here.
      const busyFrom = await s.send(`Do two things in this turn. First, dispatch one general-purpose agent in the background, model haiku: repeat rounds of Read README.md then "sleep 2" with Bash until ${TMP.stop} exists, appending any message you receive to ${TMP.inbox}. Second, once it is dispatched, run "sleep 60" with Bash yourself, in the foreground (not in the background), and then reply DONE.`);
      const busyAgent = await s.until('the relay agent’s start', (ev) => ev.find((e) => e.seq !== null && e.seq > busyFrom && e.kind === 'subagent.started' && e.isBackground === true));
      ids.relayBusy = busyAgent.taskId as string;
      const sleepUse = await s.until('the parent’s sleep 60', (ev) => ev.find((e) => e.seq !== null && e.seq > busyFrom && e.kind === 'tool.use' && e.agentId === null && e.toolName === 'Bash' && JSON.stringify(e.input).includes('sleep 60')), 120_000);
      const busyStatus = await s.status();
      const busy = await relay(ids.relayBusy, `RELAY-${RUN}-BUSY`, true);
      expect(busy.resting, 'O3: the line rests at forwarded after delivery').toBe(busy.forwarded);
      const sleepReturned = s.events.find((e) => e.kind === 'tool.result' && e.toolUseId === sleepUse.toolUseId);
      note('vi.busy', { ...busy, parentTurnAtSend: busyStatus.turn, parentSleep: { startedAt: sleepUse.at, returnedAt: sleepReturned?.at ?? null } });
      await s.idle(300_000);

      // Idle: a second such agent, the parent's turn ended after the dispatch.
      const idleFrom = await s.send(`Dispatch one general-purpose agent in the background, model haiku: repeat rounds of Read README.md then "sleep 2" with Bash until ${TMP.stop} exists, appending any message you receive to ${TMP.inbox}. Then reply DISPATCHED.`);
      const idleAgent = await s.until('the second relay agent’s start', (ev) => ev.find((e) => e.seq !== null && e.seq > idleFrom && e.kind === 'subagent.started' && e.isBackground === true));
      ids.relayIdle = idleAgent.taskId as string;
      await s.idle(180_000, 3_000);
      const idle = await relay(ids.relayIdle, `RELAY-${RUN}-IDLE`, false);
      expect(idle.resting, 'O3: the line rests at forwarded after delivery').toBe(idle.forwarded);
      note('vi.idle', idle);
      writeFileSync(TMP.stop, '');
      await s.until('both relay agents finished', (ev) => [ids.relayBusy, ids.relayIdle].every((id) => ev.some((e) => e.kind === 'subagent.finished' && e.taskId === id)), 240_000);
      note('vi.inbox', existsSync(TMP.inbox) ? readFileSync(TMP.inbox, 'utf8') : null);
      await s.idle();
    });

    // A foreground dispatch and its drill-in. MAWS launches the engine with CLAUDE_CODE_FORK_SUBAGENT=true (X6, charter
    // §4.1), under which the engine runs every Agent call asynchronously (SPEC 18, `forceAsync = fZ()`), so on the
    // product's launch the "foreground" agent starts backgrounded and its composer is enabled; launch 2 turns the fork
    // gate off through the flag settings' env to show a genuine foreground child.
    const foreground = async (pg: Page, sess: Session) => {
      const pnl = pg.locator('[data-region="panel"]');
      await showTool(pg, 'Subagents');
      const back = pnl.getByRole('button', { name: '‹ Subagents' });
      if (await back.isVisible()) await back.click();
      const from = await sess.send('Dispatch one general-purpose agent in the foreground, model haiku: run "sleep 30" with Bash and reply OK; wait for it.');
      const started = await sess.until('the foreground agent’s start', (ev) => ev.find((e) => e.seq !== null && e.seq > from && e.kind === 'subagent.started'));
      const dispatch = sess.events.find((e) => e.kind === 'tool.use' && e.toolUseId === started.toolUseId);
      await pnl.locator(`[data-agent-row="${started.taskId as string}"]`).click();
      await expect.poll(() => probe(pg, (p) => p.subagents().drillIn?.label ?? null), { timeout: 10_000 }).not.toBeNull();
      await sleep(500);
      const drill = (await probe(pg, (p) => p.subagents().drillIn))!;
      return { agentId: started.taskId as string, isBackground: started.isBackground as boolean, dispatchInput: dispatch?.input ?? null, drill, session: drill.label.replace(/^Relay via /, '') };
    };
    const finishedReads = async (pg: Page, sess: Session, agentId: string) => {
      const pnl = pg.locator('[data-region="panel"]');
      await sess.until('the agent finished', (ev) => ev.find((e) => e.kind === 'subagent.finished' && e.taskId === agentId), 180_000);
      await showTool(pg, 'Subagents');
      const back = pnl.getByRole('button', { name: '‹ Subagents' });
      if (await back.isVisible()) await back.click();
      await pnl.locator(`[data-agent-row="${agentId}"]`).click();
      await expect.poll(() => probe(pg, (p) => p.subagents().drillIn?.disabled ?? null), { timeout: 10_000 }).toBe('This agent has finished');
      const drill = await probe(pg, (p) => p.subagents().drillIn);
      await pnl.getByRole('button', { name: '‹ Subagents' }).click();
      return drill;
    };

    await step('vii', 'a "foreground" dispatch on the product launch: what the engine does and what the composer says', async () => {
      const fg = await foreground(page, s);
      ids.foreground = fg.agentId;
      note('vii.productLaunch', fg);
      if (fg.isBackground) expect(fg.drill.disabled, 'a backgrounded child’s composer is enabled').toBeNull();
      else expect(fg.drill.disabled).toBe(`${fg.session} is waiting on this agent and reads messages only after it returns`);
    });

    await step('viii', 'a finished agent’s composer reads This agent has finished', async () => {
      const agentId = ids.foreground || ids.first[0];
      note('viii', { agentId, drillIn: await finishedReads(page, s, agentId) });
      await s.idle();
    });

    await step('ix', 'the checklist reads the list TaskCreate writes', async () => {
      await showTool(page, 'Background work');
      const from = await s.send('Create three tasks with TaskCreate, one call each: "Survey docs", "Survey mockups", "Write the summary". Then mark "Survey docs" completed with TaskUpdate. Reply OK.');
      await s.idle(240_000);
      const st = await s.status();
      const tools = s.after(from).filter((e) => e.kind === 'tool.use' && e.agentId === null).map((e) => e.toolName);
      await expect.poll(() => probe(page, (p) => p.background().tasks.heading), { timeout: 15_000 }).toMatch(/^Tasks · \d+\/3/);
      const tasks = await probe(page, (p) => p.background().tasks);
      const dir = join(config, 'tasks', (st.taskListId ?? '').replace(/[^A-Za-z0-9_-]/g, '-'));
      note('ix.list', { taskListId: st.taskListId, tools, tasks, onDisk: existsSync(dir) ? readdirSync(dir) : null });
    });

    const status1 = await s.status();
    note('launch1', { cost: journalCost(status1.journalPath), stray: s.stray });
    await invoke('session.stop', { appSessionId: record.appId, reason: 'stop' });
    keepJournals();
    await maws.cleanup();
    maws = null;

    // ---- launch 2: the session from disk (x), then resumed under CLAUDE_CODE_TASK_LIST_ID (ix's override) -----------------
    if (STEPS.has('x') || STEPS.has('ix') || STEPS.has('vii')) {
      const second = await open({ CLAUDE_CODE_TASK_LIST_ID: TASK_LIST_OVERRIDE });
      maws = second.launch;
      const p2 = second.page;
      const panel2 = p2.locator('[data-region="panel"]');

      await step('x', 'a disk-only session: On disk, runs from disk, the shells sentence, the session list', async () => {
        await showTool(p2, 'Subagents');
        await expect.poll(() => probe(p2, (p) => p.subagents().headings.find((h) => h.startsWith('On disk')) ?? null), { timeout: 20_000 }).not.toBeNull();
        const lists = await probe(p2, (p) => p.subagents());
        if (lists.disk[0]) {
          await panel2.locator(`[data-agent-row="${lists.disk[0].agentId}"]`).click();
          await expect.poll(() => probe(p2, (p) => p.subagents().drillIn?.disabled ?? null), { timeout: 10_000 }).not.toBeNull();
        }
        const drill = await probe(p2, (p) => p.subagents().drillIn);
        await showTool(p2, 'Background work');
        await expect.poll(() => probe(p2, (p) => p.background().tasks.label), { timeout: 20_000 }).toBe('session list');
        // The runs step (v) leaves this session's two workflow runs on disk.
        if (STEPS.has('v')) await expect.poll(() => probe(p2, (p) => p.background().headings.join(' | ')), { timeout: 20_000 }).toMatch(/Workflow runs on disk · 2/);
        const bg = await probe(p2, (p) => p.background());
        note('x', { headings: lists.headings, notes: lists.notes, disk: lists.disk.map((r) => ({ agentId: r.agentId, title: r.title, line: r.line, depth: r.depth })), drillIn: drill, background: bg });
        expect(lists.disk.map((r) => r.line)).toEqual(lists.disk.map(() => 'status unavailable'));
        expect(bg.notes).toContain('Shells and monitors are known only while the session runs here');
        expect(bg.tasks.label).toBe('session list');
      });

      if (STEPS.has('ix') || STEPS.has('vii')) {
        // Resumed under the task-list override, with the fork gate off (see `foreground`).
        await launchSession(second.invoke, second.record, 1, { CLAUDE_CODE_FORK_SUBAGENT: 'false' });
        const s2 = new Session(p2, second.invoke, second.record.appId, second.record.title.text);
        journals.push((await s2.status()).journalPath);

        await step('ix', 'CLAUDE_CODE_TASK_LIST_ID shows that list instead', async () => {
          const st = await s2.status();
          expect(st.taskListId).toBe(TASK_LIST_OVERRIDE);
          await showTool(p2, 'Background work');
          const empty = await probe(p2, (p) => p.background().tasks);
          await s2.send('Create two tasks with TaskCreate, one call each: "Override one", "Override two". Reply OK.');
          await s2.idle(240_000);
          await expect.poll(() => probe(p2, (p) => p.background().tasks.heading), { timeout: 15_000 }).toMatch(/^Tasks · 0\/2/);
          const tasks = await probe(p2, (p) => p.background().tasks);
          const dir = join(config, 'tasks', TASK_LIST_OVERRIDE);
          note('ix.override', { taskListId: st.taskListId, before: empty, after: tasks, onDisk: existsSync(dir) ? readdirSync(dir) : null });
          await s2.idle();
        });

        await step('vii', 'a genuine foreground child (fork gate off): the composer is disabled with the reason, then finished', async () => {
          const fg = await foreground(p2, s2);
          note('vii.forkGateOff', fg);
          expect(fg.isBackground).toBe(false);
          expect(fg.drill.disabled).toBe(`${fg.session} is waiting on this agent and reads messages only after it returns`);
          note('viii.forkGateOff', await finishedReads(p2, s2, fg.agentId));
          await s2.idle();
        });

        note('launch2', { cost: journalCost((await s2.status()).journalPath), stray: s2.stray });
        await second.invoke('session.stop', { appSessionId: second.record.appId, reason: 'stop' });
      }
    }
  } finally {
    keepJournals();
    if (maws) await maws.cleanup().catch((error) => note('cleanupError', String(error)));
    const spend = created.total_cost_usd + journals.reduce((sum, path) => sum + journalCost(join(kept, basename(path))), 0);
    note('spendUsd', Number(spend.toFixed(4)));
    note('ownerHome', ownerHomeNames(created.session_id, scratch));
    note('failures', failures);
    if (process.env.MAWS_C8B_LIVE_KEEP !== '1') {
      rmSync(clone, { recursive: true, force: true });
      rmSync(config, { recursive: true, force: true });
    }
    for (const path of Object.values(TMP)) rmSync(path, { force: true });
    console.log(`[c8b-live] observations: ${join(scratch, 'observations.json')}`);
    // Read only, and here so a run that failed part-way is checked too.
    expect(ownerHomeNames(created.session_id, scratch)).toEqual([]);
  }
  expect(failures).toEqual([]);
});
