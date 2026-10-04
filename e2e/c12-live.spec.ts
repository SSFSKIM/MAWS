// C12's measured run (C12 execution document, M3, Acceptance items 3 to 6 and Concrete Steps "M3 live"), through
// Playwright against the built app with the pinned engine behind ClaudeUsage's relay; no desktop automation. Nine
// sessions start through the product's "+" path in two scratch repositories, each tree carrying stdio MCP children
// (support/c12-live.ts): A1 and A2 in A hold the project server `c12-kernel`, which the Settings list names stateful; in
// B, B1 holds a session grant, B2 a background `sleep 900`, B3 a paused queue with one message, B4 a pending approval,
// and B5 to B7 are idle. The budget is then set below the sum through `settings.set`, and the run records what the
// engine host releases, the released surfaces, Send-to-resume on B1 (the grant re-applied, no `can_use_tool`), and,
// with the budget below the protected sessions' sum, the banner, the blocked sheet and the per-session stop. Every
// number goes to `docs/doperpowers/evidence/c12/budget-run.json`, the screenshots beside it. Run on purpose only; it
// spends usage (the M3 limit is US$5, read from the journals):
//   export C12=/private/tmp/maws-c12-m3-$(date +%s) && mkdir -p $C12/userData
//   export CLAUDE_CONFIG_DIR=$C12/config && mkdir -p $CLAUDE_CONFIG_DIR && printf '{}\n' > $CLAUDE_CONFIG_DIR/settings.json
//   export MAWS_USER_DATA=$C12/userData
//   pnpm build && MAWS_C12_LIVE=1 pnpm exec playwright test e2e/c12-live.spec.ts
// The support writes the MCP fixtures and the two repositories into $C12 on first use. MAWS_C12_LIVE_MAX_USD (default
// 5) stops the run before it starts another session once the journals show that much spent.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { BudgetState } from '@shared/ipc/schema/engine';
import type { JournalRow } from '@shared/wire/journal';
import { journal } from './support/c7-live';
import { invoke, value } from './support/c7-replay';
import { c12LiveSkipReason, c12Scratch, lsPin, ownerFileCheck, psRead, spend, treeOf, type C12Scratch } from './support/c12-live';
import { ENGINE_BIN } from '../test/support/engine-pin';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { newChatIn, sidebarRow } from './support/sidebar';

const skip = c12LiveSkipReason();
test.skip(skip !== null, skip ?? '');
test.describe.configure({ timeout: 2_400_000 });

const EVIDENCE = join(REPO_ROOT, 'docs/doperpowers/evidence/c12');
const MAX_USD = Number(process.env.MAWS_C12_LIVE_MAX_USD ?? '5');
const SAMPLE_MS = 10_000; // C3's sampler period
const LIVE_STATES: readonly EngineSessionStatus['process'][] = ['starting', 'initializing', 'ready'];
const GRANTED = 'touch c12-before.txt';
const GRANT_PROMPT = `Use the Bash tool to run exactly this command and nothing else: ${GRANTED}`;
const THEMES = ['light', 'dark'] as const;

let scratch: C12Scratch;
const run: Record<string, unknown> = {};
function record(key: string, v: unknown): void {
  run[key] = v;
  writeFileSync(join(scratch.root, 'budget-run.json'), `${JSON.stringify(run, null, 2)}\n`);
}

test.beforeAll(() => {
  scratch = c12Scratch();
  const before = ownerFileCheck(scratch.root);
  record('scratch', { root: scratch.root, config: scratch.config, userData: scratch.userData, repositories: { A: scratch.repoA, B: scratch.repoB } });
  record('ownerFileCheck', { before, after: null });
  record('pinLs', { before: lsPin(), after: null });
  expect(before, 'no scratch path in the owner’s ~/.claude.json before the run').toEqual([]);
});

test.afterAll(() => {
  if (!scratch) return;
  const after = ownerFileCheck(scratch.root);
  record('ownerFileCheck', { ...(run.ownerFileCheck as object), after });
  record('pinLs', { ...(run.pinLs as object), after: lsPin() });
  record('spend', spend(scratch.userData));
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(join(EVIDENCE, 'budget-run.json'), `${JSON.stringify(run, null, 2)}\n`);
  expect(after, 'no scratch path in the owner’s ~/.claude.json after the run').toEqual([]);
});

// ---- the app's reads -----------------------------------------------------------------------------------------------

const main = (page: Page) => page.locator('[data-region="main"]');
const rowOf = (page: Page, id: string) => sidebarRow(page, { appSessionId: id }); // W11: its project expanded first
const statusOf = async (page: Page, id: string) => value(await invoke(page, 'session.status', { appSessionId: id as AppSessionId }));
const sessions = async (page: Page) => value(await invoke(page, 'engine.sessions', undefined));
const budget = async (page: Page) => value(await invoke(page, 'engine.budget', undefined));
const titleOf = async (page: Page, id: string) => value(await invoke(page, 'session.get', { appSessionId: id as AppSessionId }))!.title.text;
const live = (s: EngineSessionStatus) => LIVE_STATES.includes(s.process);
const mib = (kib: number) => Math.round((kib / 1024) * 10) / 10;

async function statusOrNull(page: Page, id: string): Promise<EngineSessionStatus | null> {
  const r = await invoke(page, 'session.status', { appSessionId: id as AppSessionId });
  return r.ok ? r.value : null;
}

// Every `engine.budget` event and every `attention.notified` (C5's notifier log) the page receives, from the start.
type C12Window = Window & { __c12: { budget: (BudgetState & { receivedAt: string })[]; notified: unknown[] } };
async function collect(page: Page): Promise<void> {
  await page.evaluate(() => {
    const log = { budget: [] as unknown[], notified: [] as unknown[] };
    (window as unknown as { __c12: typeof log }).__c12 = log;
    window.maws.on('engine.budget', (s) => log.budget.push({ ...s, receivedAt: new Date().toISOString() }));
    window.maws.on('attention.notified', (n) => log.notified.push(n));
  });
}
const budgetEvents = (page: Page) => page.evaluate(() => (window as unknown as C12Window).__c12.budget);
const notified = (page: Page) => page.evaluate(() => (window as unknown as C12Window).__c12.notified);

// One labelled tree per live row, beside the independent `ps` read of the same pids.
async function trees(page: Page, labels: Map<string, string>) {
  const rows = await sessions(page);
  const ps = psRead();
  const perTree = rows
    .filter((s) => labels.has(s.appSessionId))
    .map((s) => {
      const tree = s.pid === null || !live(s) ? null : treeOf(ps, s.pid);
      return {
        label: labels.get(s.appSessionId)!, appSessionId: s.appSessionId, process: s.process, exitReason: s.exit?.reason ?? null, pid: s.pid,
        treeRssKiB: live(s) ? s.memory.treeRssKiB : null, sampledAt: s.memory.sampledAt, keepAlive: s.keepAlive,
        ps: tree === null ? null : { treeRssKiB: tree.rssKiB, processes: tree.pids.length, commands: tree.commands, mcpServers: tree.mcpServers },
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  const sumKiB = perTree.reduce((s, t) => s + (t.treeRssKiB ?? 0), 0);
  const psSumKiB = perTree.reduce((s, t) => s + (t.ps?.treeRssKiB ?? 0), 0);
  return { at: new Date().toISOString(), liveTrees: perTree.filter((t) => t.treeRssKiB !== null).length, sumKiB, sumMiB: mib(sumKiB), psSumKiB, psSumMiB: mib(psSumKiB), perTree };
}

// The host's figures against the independent `ps` read: every live tree measured on both sides and within
// PS_TOLERANCE of each other (the host's sample is up to one period older than the read), the sums likewise, and each
// tree carrying the stdio MCP children its repository gives it (A: c12-plain and c12-kernel; B: c12-plain).
const PS_TOLERANCE = 0.05;
function checkTrees(t: Awaited<ReturnType<typeof trees>>): void {
  const near = (a: number, b: number) => Math.abs(a - b) <= PS_TOLERANCE * Math.max(a, b);
  for (const tree of t.perTree.filter((p) => p.treeRssKiB !== null)) {
    expect(tree.treeRssKiB!, `${tree.label}'s tree measured by the host`).toBeGreaterThan(0);
    expect(tree.ps?.treeRssKiB ?? 0, `${tree.label}'s tree measured by ps`).toBeGreaterThan(0);
    expect(near(tree.treeRssKiB!, tree.ps!.treeRssKiB), `${tree.label}: host ${tree.treeRssKiB} KiB against ps ${tree.ps!.treeRssKiB} KiB`).toBe(true);
    expect(tree.ps!.mcpServers, `${tree.label}'s stdio MCP children`).toBe(tree.label.startsWith('A') ? 2 : 1);
  }
  expect(t.sumKiB).toBeGreaterThan(0);
  expect(near(t.sumKiB, t.psSumKiB), `the sum: host ${t.sumKiB} KiB against ps ${t.psSumKiB} KiB`).toBe(true);
}

async function shoot(page: Page, name: string): Promise<string[]> {
  mkdirSync(EVIDENCE, { recursive: true });
  const files: string[] = [];
  for (const theme of THEMES) {
    value(await invoke(page, 'settings.set', { theme }));
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const file = `c12-live-${name}-${theme}.png`;
    await page.screenshot({ path: join(EVIDENCE, file) });
    files.push(`docs/doperpowers/evidence/c12/${file}`);
  }
  value(await invoke(page, 'settings.set', { theme: 'light' }));
  return files;
}

// One release per evaluation (at the policy change and at each sample) and none while another is exiting: each release
// comes after the previous released process exited (read before any of them launches again).
async function oneAtATime(page: Page, releases: readonly { appSessionId: string; at: string }[]): Promise<void> {
  const distinct = [...new Map(releases.map((r) => [`${r.appSessionId}@${r.at}`, r])).values()];
  for (let i = 1; i < distinct.length; i++) {
    const previous = (await statusOf(page, distinct[i - 1]!.appSessionId)).exit;
    expect(previous?.reason, `release ${i - 1} exited`).toBe('budget');
    expect(Date.parse(previous!.at), `release ${i} came after release ${i - 1} exited`).toBeLessThanOrEqual(Date.parse(distinct[i]!.at));
  }
}

// ---- the composer and the cards ------------------------------------------------------------------------------------

async function send(page: Page, text: string): Promise<void> {
  await main(page).getByRole('textbox', { name: 'Message' }).click();
  await page.keyboard.insertText(text);
  await page.keyboard.press('Enter');
}

async function open(page: Page, id: string): Promise<void> {
  await (await rowOf(page, id)).click();
  await expect(main(page).locator(`[data-composer="${id}"]`)).toBeVisible();
}

// Answers the approval the active tab shows with the scope named.
async function approve(page: Page, scope: 'Allow once' | 'Allow for this session'): Promise<void> {
  const frame = main(page).getByRole('group', { name: 'Approval needed' });
  await expect(frame).toBeVisible({ timeout: 120_000 });
  await frame.getByRole('radio', { name: scope }).click();
  await frame.getByRole('button', { name: 'Allow', exact: true }).click();
  await expect(frame).toBeHidden({ timeout: 15_000 });
}

async function approveIfAsked(page: Page): Promise<void> {
  if (await main(page).getByRole('group', { name: 'Approval needed' }).isVisible()) await approve(page, 'Allow once');
}

async function idle(page: Page, id: string, timeout = 240_000): Promise<void> {
  await expect
    .poll(async () => {
      const s = await statusOf(page, id);
      return s.process === 'ready' && s.turn === null && !s.busy && s.pendingRequests === 0;
    }, { timeout, intervals: [500] })
    .toBe(true);
}

// "+" on the project, the unstarted tab's intent on Sonnet in default mode (what the model and mode widgets write),
// the first message sent from its composer, the trust card answered where the folder is not yet trusted, and the
// session waited to `ready`.
async function plus(page: Page, repo: string, first: string): Promise<string> {
  const name = repo.split('/').at(-1)!;
  const spent = spend(scratch.userData).upperBoundUsd;
  if (spent >= MAX_USD) throw new Error(`spend limit: the journals show US$${spent} of US$${MAX_USD}`);
  const known = new Set(value(await invoke(page, 'session.intent.list', undefined)).intents.map((i) => i.appSessionId));
  await newChatIn(page, name); // W11: the "+" on the project's row, on hover
  await expect(page.getByRole('heading', { name: `New chat in ${name}` })).toBeVisible();
  let id: AppSessionId | undefined;
  await expect.poll(async () => (id = value(await invoke(page, 'session.intent.list', undefined)).intents.find((i) => !known.has(i.appSessionId))?.appSessionId)).toBeDefined();
  value(await invoke(page, 'session.intent.patch', { appSessionId: id!, patch: { model: 'sonnet', permissionMode: 'default' } }));
  await send(page, first);
  const card = page.getByRole('group', { name: 'Trust this folder?' });
  await expect.poll(async () => (await card.isVisible()) || (await statusOrNull(page, id!)) !== null, { timeout: 30_000 }).toBe(true);
  if (await card.isVisible()) await card.getByRole('button', { name: 'Trust and start' }).click();
  await expect.poll(async () => (await statusOrNull(page, id!))?.process ?? null, { timeout: 120_000 }).toBe('ready');
  return id!;
}

// ---- journals ------------------------------------------------------------------------------------------------------

type Frame = Record<string, unknown> & { type?: string; subtype?: string; event?: string; request?: { subtype?: string }; message?: { content?: unknown } };
const frames = (rows: JournalRow[], direction: JournalRow['direction']) => rows.filter((r) => r.direction === direction).map((r) => r.frame as Frame);
const toolUses = (rows: JournalRow[]) =>
  frames(rows, 'in')
    .filter((f) => f.type === 'assistant' && Array.isArray(f.message?.content))
    .flatMap((f) => (f.message!.content as { type: string; name?: string; input?: Record<string, unknown> }[]).filter((b) => b.type === 'tool_use'));

// ---- the run -------------------------------------------------------------------------------------------------------

test('nine sessions under a memory budget: releases, the released surfaces, Send-to-resume with the grant, and the banner with the per-session stop', async () => {
  const maws: MawsLaunch = await launchMaws({ userData: scratch.userData, env: { MAWS_E2E_ENGINE_BIN: ENGINE_BIN, MAWS_HARNESS: '0', CLAUDE_CONFIG_DIR: scratch.config } });
  const { page, app } = maws;
  const labels = new Map<string, string>(); // appSessionId → A1 … B7
  const ids: Record<string, string> = {};
  const name = (label: string, id: string) => {
    labels.set(id, label);
    ids[label] = id;
    record('sessions', ids);
  };
  try {
    await expect(main(page)).toBeVisible();
    await collect(page);
    value(await invoke(page, 'settings.set', { engine: { statefulMcpServers: ['c12-kernel'] } }));
    for (const repo of [scratch.repoA, scratch.repoB]) value(await invoke(page, 'session.projects.add', { directory: repo }));

    // ---- the nine sessions and their states ----
    await test.step('A1 and A2 in A, trusted through the card, with c12-kernel and c12-plain connected', async () => {
      for (const label of ['A1', 'A2']) {
        name(label, await plus(page, scratch.repoA, `${label}: reply with exactly the words ${label} READY and nothing else.`));
        await idle(page, ids[label]!);
      }
      const servers = Object.fromEntries(await Promise.all(['A1', 'A2'].map(async (l) => [l, (await statusOf(page, ids[l]!)).mcpServers] as const)));
      record('mcpServersA', servers);
      for (const l of ['A1', 'A2']) expect(servers[l]!.filter((s) => s.status === 'connected').map((s) => s.name).sort(), `${l}'s servers`).toEqual(['c12-kernel', 'c12-plain']);
    });

    await test.step('B1: Allow for this session on the touch; the grant’s rule string from status.grants', async () => {
      name('B1', await plus(page, scratch.repoB, GRANT_PROMPT));
      await approve(page, 'Allow for this session');
      await idle(page, ids.B1!);
      const s = await statusOf(page, ids.B1!);
      record('grant', { ruleStrings: s.grants, mcpServers: s.mcpServers });
      expect(s.grants).toContain(`Bash(${GRANTED})`);
      expect(s.mcpServers.find((m) => m.name === 'c12-plain')?.status).toBe('connected');
    });

    await test.step('B3: a queued message behind a running turn, then an interrupt pauses the queue', async () => {
      name('B3', await plus(page, scratch.repoB, 'B3: use the Bash tool to run exactly this command in the foreground and nothing else: sleep 20. Then reply with exactly the word SLEPT.'));
      // `sleep` is read-only to the engine, so it may run without asking (it did on 2.1.283); an approval, if one
      // comes, is answered once.
      await expect
        .poll(async () => {
          await approveIfAsked(page);
          const s = await statusOf(page, ids.B3!);
          return s.pendingRequests === 0 && toolUses(journal(s.journalPath)).length >= 1;
        }, { timeout: 90_000, intervals: [500] })
        .toBe(true);
      await send(page, 'B3 queued: reply with exactly the word QUEUED.');
      const list = main(page).getByRole('region', { name: 'Queued messages' });
      await expect(list).toContainText('1 queued');
      await main(page).getByRole('textbox', { name: 'Message' }).click();
      await page.keyboard.press('Meta+.');
      await expect(list.locator('header')).toHaveText(/Queue paused because you interrupted/, { timeout: 30_000 });
      await idle(page, ids.B3!);
      const s = await statusOf(page, ids.B3!);
      record('queueB3', s.queue);
      expect(s.queue).toEqual({ length: 1, paused: true });
    });

    await test.step('B4: default mode, the touch left pending', async () => {
      name('B4', await plus(page, scratch.repoB, 'B4: use the Bash tool to run exactly this command and nothing else: touch c12-b4.txt'));
      await expect(main(page).getByRole('group', { name: 'Approval needed' })).toBeVisible({ timeout: 120_000 });
      await expect.poll(async () => (await statusOf(page, ids.B4!)).pendingRequests, { timeout: 30_000 }).toBe(1);
    });

    await test.step('B5, B6 and B7: one short turn each, in that order, so B1 is the least recently used eligible session', async () => {
      for (const label of ['B5', 'B6', 'B7']) {
        name(label, await plus(page, scratch.repoB, `${label}: reply with exactly the words ${label} READY and nothing else.`));
        await idle(page, ids[label]!);
      }
    });

    let sleepPids: number[] = [];
    await test.step('B2: a background sleep 900', async () => {
      name('B2', await plus(page, scratch.repoB, 'B2: use the Bash tool with run_in_background set to true to run exactly this command and nothing else: sleep 900. Do not wait for it; reply with exactly the word STARTED.'));
      await expect
        .poll(async () => {
          await approveIfAsked(page);
          const s = await statusOf(page, ids.B2!);
          return s.turn === null && s.backgroundTasks.some((t) => !t.ambient);
        }, { timeout: 180_000, intervals: [1_000] })
        .toBe(true);
      await idle(page, ids.B2!);
      const s = await statusOf(page, ids.B2!);
      const tree = treeOf(psRead(), s.pid!);
      const ps = psRead();
      sleepPids = ps.filter((r) => tree.pids.includes(r.pid) && /(^|\/)sleep 900$/.test(r.command)).map((r) => r.pid);
      record('backgroundB2', { tasks: s.backgroundTasks, sleepPids, inTree: sleepPids.length > 0, anywhere: ps.filter((r) => /(^|\/)sleep 900$/.test(r.command)).map((r) => ({ pid: r.pid, ppid: r.ppid })) });
      expect(sleepPids.length, 'the sleep runs inside B2’s tree').toBeGreaterThan(0);
    });

    // ---- the budget below the sum ----
    const protectedLabels = ['A1', 'A2', 'B2', 'B3', 'B4'];
    const identity = async () =>
      Object.fromEntries(await Promise.all(Object.entries(ids).map(async ([l, id]) => {
        const s = await statusOf(page, id);
        // what the process is and what work it holds; memory, sample times and event counters move on their own
        return [l, {
          process: s.process, pid: s.pid, launchId: s.launchId, exitReason: s.exit?.reason ?? null,
          turn: s.turn?.id ?? null, busy: s.busy, pendingRequests: s.pendingRequests, pendingPlan: s.pendingPlan, queue: s.queue,
          backgroundTasks: s.backgroundTasks.map((t) => t.taskId), heldPeerMessages: s.heldPeerMessages.length, keepAlive: s.keepAlive,
        }] as const;
      })));

    await test.step('quiet for a sample period, then the trees, the sum and the independent ps read', async () => {
      await page.waitForTimeout(2 * SAMPLE_MS + 2_000);
      const b = await budget(page);
      record('budgetBefore', b);
      const t = await trees(page, labels);
      record('treesBefore', t);
      expect(t.liveTrees).toBe(9);
      checkTrees(t);
      expect(b.candidates, 'B1 and B5 to B7 are candidates').toBe(4);
    });

    const attentionBefore = value(await invoke(page, 'attention.list', undefined));
    const notifiedBefore = (await notified(page)).length;
    const protectedBefore = await identity();
    const sumMiB = Math.floor((run.treesBefore as { sumKiB: number }).sumKiB / 1024);
    const limitMiB = sumMiB - 300;
    const setAt = Date.now();

    await test.step('the budget set to floor(sum) − 300 MiB: B1 goes first, within one sample period', async () => {
      value(await invoke(page, 'settings.set', { engine: { memoryBudgetMiB: limitMiB } }));
      await expect.poll(async () => (await statusOf(page, ids.B1!)).exit?.reason ?? null, { timeout: 12_000, intervals: [250] }).toBe('budget');
      const s = await statusOf(page, ids.B1!);
      record('firstRelease', { limitMiB, sumMiB, setAt: new Date(setAt).toISOString(), exitAt: s.exit!.at, secondsAfterSet: (Date.parse(s.exit!.at) - setAt) / 1000, release: s.exit!.release });
    });

    await test.step('releases follow one per sample until under the budget or out of candidates; the protected sessions untouched', async () => {
      await expect
        .poll(async () => {
          const b = await budget(page);
          return b.releasing === null && b.sampledAt !== null && Date.parse(b.sampledAt) > setAt + SAMPLE_MS && (!b.over || b.candidates === 0);
        }, { timeout: 150_000, intervals: [1_000] })
        .toBe(true);
      const releasesNow = async () =>
        [...new Map((await budgetEvents(page)).filter((e) => e.lastRelease !== null).map((e) => [`${e.lastRelease!.appSessionId}@${e.lastRelease!.at}`, e.lastRelease!])).values()].map((r) => ({ label: labels.get(r.appSessionId), ...r, totalMiB: mib(r.totalKiB) }));
      const settled = await releasesNow();
      const sampledBefore = (await budget(page)).sampledAt;
      await page.waitForTimeout(SAMPLE_MS + 1_000); // one more sample: nothing else goes
      const after = await trees(page, labels);
      const releases = await releasesNow();
      const final = await budget(page);
      record('budgetAfter', final);
      expect(final.sampledAt, 'a sample came and went').not.toBe(sampledBefore);
      expect(releases, 'no release at the extra sample').toEqual(settled);
      expect(final.releasing).toBeNull();
      expect(!final.over || final.candidates === 0, 'under the budget, or no candidate left').toBe(true);
      for (const r of releases) expect(r.totalKiB, `${r.label} released while over the budget`).toBeGreaterThan(limitMiB * 1024);
      record('treesAfter', after);
      checkTrees(after);
      record('releases', releases);
      expect(releases[0]?.label).toBe('B1');
      await oneAtATime(page, releases);
      const protectedAfter = await identity();
      for (const l of protectedLabels) expect(protectedAfter[l], `${l} untouched`).toEqual(protectedBefore[l]);
    });

    await test.step('the released rows read idle with the mark; attention and the notifier log unchanged; Session info says when and why', async () => {
      const released = (run.releases as { label: string }[]).map((r) => r.label);
      for (const l of released) {
        const row = await rowOf(page, ids[l]!);
        await expect(row.getByText('released', { exact: true }), `${l}'s mark`).toBeVisible();
        await expect(row.getByRole('img', { name: 'Idle' })).toBeVisible();
      }
      const attentionAfter = value(await invoke(page, 'attention.list', undefined));
      const notifiedAfter = (await notified(page)).length;
      const markTitle = await (await rowOf(page, ids.B1!)).getByText('released', { exact: true }).getAttribute('title');
      await open(page, ids.B1!);
      const panel = page.locator('[data-region="panel"]');
      await panel.getByRole('button', { name: 'Add a tool' }).click();
      await page.getByRole('menuitem', { name: 'Session info' }).click();
      const info = page.locator(`[data-session-info="${ids.B1}"]`);
      const dd = (term: string) => info.getByRole('term').filter({ hasText: new RegExp(`^${term}$`) }).locator('xpath=following-sibling::dd[1]');
      await expect(dd('Process')).toHaveText(/^Released at \d\d:\d\d to stay under [\d.]+ GB$/);
      record('releasedSurfaces', {
        released, markTitle, sessionInfo: { process: await dd('Process').innerText(), memoryBudget: await dd('Memory budget').innerText() },
        attention: { before: attentionBefore.map((a) => a.id), after: attentionAfter.map((a) => a.id) }, notified: { before: notifiedBefore, after: notifiedAfter },
        screenshots: await shoot(page, 'released'),
      });
      expect(attentionAfter).toEqual(attentionBefore);
      expect(notifiedAfter).toBe(notifiedBefore);
    });

    // ---- Send-to-resume ----
    await test.step('Send in the released B1 resumes it: process_exit reconnect, a --resume spawn, one user frame, the grant re-applied with no can_use_tool', async () => {
      const before = await statusOf(page, ids.B1!);
      await expect(main(page).locator('[data-submit-state]')).toHaveAttribute('aria-description', 'Resumes this session');
      await main(page).getByRole('textbox', { name: 'Message' }).click();
      await page.keyboard.insertText(GRANT_PROMPT);
      const t0 = Date.now();
      await page.keyboard.press('Enter');
      let readyAt = 0;
      await expect
        .poll(async () => {
          const s = await statusOf(page, ids.B1!);
          if (s.launchId !== before.launchId && s.process === 'ready' && readyAt === 0) readyAt = Date.now();
          return readyAt;
        }, { timeout: 60_000, intervals: [100] })
        .toBeGreaterThan(0);
      const s = await statusOf(page, ids.B1!);
      let userAt = 0;
      await expect
        .poll(() => {
          const row = journal(s.journalPath).find((r) => r.direction === 'out' && (r.frame as Frame).type === 'user');
          if (row) userAt = Date.parse(row.at);
          return userAt;
        }, { timeout: 30_000, intervals: [100] })
        .toBeGreaterThan(0);
      await idle(page, ids.B1!);
      const rows = journal(s.journalPath);
      const reconnect = frames(rows, 'meta').filter((f) => f.event === 'reconnect');
      const spawn = frames(rows, 'meta').find((f) => f.event === 'spawn') as (Frame & { args?: string[] }) | undefined;
      const users = frames(rows, 'out').filter((f) => f.type === 'user');
      const asks = frames(rows, 'in').filter((f) => f.type === 'control_request' && f.request?.subtype === 'can_use_tool');
      const bash = toolUses(rows).filter((b) => b.name === 'Bash').map((b) => b.input?.command);
      const after = await statusOf(page, ids.B1!);
      record('resume', {
        sendAt: new Date(t0).toISOString(), readySeconds: (readyAt - t0) / 1000, userFrameSeconds: (userAt - t0) / 1000,
        journalPath: s.journalPath.replace(scratch.root, '$C12'), reconnect, spawnResume: spawn?.args?.includes('--resume') ?? false,
        userFrames: users.length, canUseTool: asks.length, bashCommands: bash, grantsAfter: after.grants,
        screenshots: await shoot(page, 'resumed'),
      });
      expect(reconnect.map((r) => r.trigger)).toContain('process_exit');
      expect(spawn?.args).toContain('--resume');
      expect(users).toHaveLength(1);
      expect(bash).toContain(GRANTED);
      expect(asks).toHaveLength(0);
      expect(after.grants).toContain(`Bash(${GRANTED})`);
    });

    // ---- over budget with no candidate ----
    const titles: Record<string, string> = {};
    await test.step('the budget below the protected sessions’ sum: every other session released, then one banner', async () => {
      const rows = await sessions(page);
      const protectedKiB = rows.filter((s) => protectedLabels.includes(labels.get(s.appSessionId) ?? '') && live(s)).reduce((sum, s) => sum + (s.memory.treeRssKiB ?? 0), 0);
      // Half the protected sum: idle trees shrink as macOS compresses their pages (a run saw the five fall 170 MiB in a
      // minute), so a margin of a few percent can leave the sum under the budget before the banner's second sample.
      const lowMiB = Math.max(512, Math.floor(protectedKiB / 1024 / 2));
      const baseline = await identity();
      const at = Date.now();
      value(await invoke(page, 'settings.set', { engine: { memoryBudgetMiB: lowMiB } }));
      const others = ['B1', 'B5', 'B6', 'B7'];
      await expect
        .poll(async () => (await Promise.all(others.map(async (l) => (await statusOf(page, ids[l]!)).process))).every((p) => p === 'exited'), { timeout: 240_000, intervals: [1_000] })
        .toBe(true);
      for (const l of others) expect((await statusOf(page, ids[l]!)).exit?.reason, `${l} exited as a release`).toBe('budget');
      const banner = page.locator('[data-banner-host]').getByRole('status').filter({ hasText: 'Memory budget exceeded' });
      await expect(banner).toHaveCount(1, { timeout: 60_000 });
      const bannerAt = Date.now();
      await page.waitForTimeout(SAMPLE_MS + 1_000);
      await expect(banner, 'once per crossing').toHaveCount(1);
      for (const l of protectedLabels) titles[l] = await titleOf(page, ids[l]!);
      const events = await budgetEvents(page);
      await oneAtATime(page, events.filter((e) => e.lastRelease !== null && Date.parse(e.lastRelease.at) >= at).map((e) => e.lastRelease!));
      for (const e of events.filter((e) => e.lastRelease !== null && Date.parse(e.lastRelease.at) >= at)) {
        expect(e.lastRelease!.totalKiB, `${labels.get(e.lastRelease!.appSessionId)} released while over the budget`).toBeGreaterThan(lowMiB * 1024);
      }
      const wave = await identity();
      for (const l of protectedLabels) expect(wave[l], `${l} untouched by the second wave`).toEqual(baseline[l]);
      const lowTrees = await trees(page, labels);
      record('noCandidate', {
        limitMiB: lowMiB, protectedMiB: mib(protectedKiB), setAt: new Date(at).toISOString(), bannerSeconds: (bannerAt - at) / 1000,
        banner: await banner.locator('span').first().innerText(), budget: await budget(page),
        releases: [...new Map(events.filter((e) => e.lastRelease !== null && Date.parse(e.lastRelease.at) >= at).map((e) => [`${e.lastRelease!.appSessionId}@${e.lastRelease!.at}`, e.lastRelease!])).values()].map((r) => ({ label: labels.get(r.appSessionId), ...r })),
        trees: lowTrees, screenshots: await shoot(page, 'banner'),
      });
      expect(lowTrees.liveTrees, 'the five protected trees stay live').toBe(5);
      checkTrees(lowTrees);
    });

    await test.step('Review… lists the five with their reasons; Stop… on B2 discloses its task; Cancel stops nothing', async () => {
      const banner = page.locator('[data-banner-host]').getByRole('status').filter({ hasText: 'Memory budget exceeded' });
      await banner.getByRole('button', { name: 'Review…' }).click();
      const blocked = page.getByRole('dialog', { name: 'Sessions holding work' });
      await expect(blocked.getByRole('listitem')).toHaveCount(5);
      const listed = await blocked.getByRole('listitem').allInnerTexts();
      const sheetShots = await shoot(page, 'blocked-sheet');
      const item = (l: string) => blocked.getByRole('listitem', { name: titles[l], exact: true });
      const reasons: Record<string, RegExp> = { A1: /stateful server c12-kernel/, A2: /stateful server c12-kernel/, B2: /1 background task/, B3: /1 queued message/, B4: /waiting for you/ };
      for (const l of protectedLabels) await expect(item(l), `${l} listed with its reason`).toContainText(reasons[l]!);
      await item('B2').getByRole('button', { name: 'Stop…' }).click();
      const stop = page.getByRole('dialog', { name: `Stop “${titles.B2}”?` });
      const disclosure = await stop.getByRole('note').innerText();
      const stopShots = await shoot(page, 'stop-sheet');
      const before = await identity();
      await stop.getByRole('button', { name: 'Cancel' }).click();
      await expect(blocked.getByRole('listitem')).toHaveCount(5);
      await page.waitForTimeout(2_000);
      const afterCancel = await identity();
      record('blockedSheet', { listed, disclosure, unchangedAfterCancel: JSON.stringify(afterCancel) === JSON.stringify(before), screenshots: [...sheetShots, ...stopShots] });
      expect(disclosure).toContain('1 background task is still running and will be stopped');
      expect(afterCancel).toEqual(before);
    });

    await test.step('Stop… confirmed ends B2 alone: exited with reason stop, its sleep gone from ps, every other status unchanged', async () => {
      const blocked = page.getByRole('dialog', { name: 'Sessions holding work' });
      const before = await identity();
      await blocked.getByRole('listitem', { name: titles.B2, exact: true }).getByRole('button', { name: 'Stop…' }).click();
      await page.getByRole('dialog', { name: `Stop “${titles.B2}”?` }).getByRole('button', { name: 'Stop', exact: true }).click();
      await expect.poll(async () => (await statusOf(page, ids.B2!)).exit?.reason ?? null, { timeout: 30_000 }).toBe('stop');
      await expect.poll(() => psRead().filter((r) => sleepPids.includes(r.pid)).length, { timeout: 15_000 }).toBe(0);
      const after = await identity();
      const others = Object.keys(ids).filter((l) => l !== 'B2');
      record('stopB2', { exit: (await statusOf(page, ids.B2!)).exit, sleepPidsGone: sleepPids, othersUnchanged: others.every((l) => JSON.stringify(after[l]) === JSON.stringify(before[l])) });
      for (const l of others) expect(after[l], `${l} unchanged`).toEqual(before[l]);
    });

    await test.step('a stopped session’s Send still reads Session ended', async () => {
      await page.keyboard.press('Escape').catch(() => undefined);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await open(page, ids.B2!);
      await main(page).getByRole('textbox', { name: 'Message' }).click();
      await page.keyboard.insertText('anything');
      const control = main(page).locator('[data-submit-state]');
      await expect(control).toBeDisabled();
      await expect(control).toHaveAttribute('title', 'Session ended'); // a disabled control's reason is its title
      record('stoppedSend', { disabled: true, title: await control.getAttribute('title') });
    });

    await test.step('Settings › Engine’s Memory budget takes a GB value with one decimal', async () => {
      await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('settings.open')?.click());
      const field = main(page).getByRole('textbox', { name: 'Memory budget' });
      await field.fill('12.5');
      await field.press('Enter');
      await expect.poll(async () => value(await invoke(page, 'settings.get', undefined)).settings.engine.memoryBudgetMiB).toBe(12_800);
      record('settingsField', { typed: '12.5', memoryBudgetMiB: 12_800 });
    });
  } finally {
    // What the host and the page showed last, for a run that stopped early: the budget events and the banner host.
    const events = await budgetEvents(page).catch(() => []);
    record('budgetEvents', events.map((e) => ({ at: e.receivedAt, limitKiB: e.limitKiB, totalKiB: e.totalKiB, over: e.over, overWithoutCandidate: e.overWithoutCandidate, candidates: e.candidates, settling: e.settling, releasing: e.releasing, blocked: e.blocked.length })));
    record('bannerHost', await page.locator('[data-banner-host]').innerText().catch(() => null));
    await page.screenshot({ path: join(scratch.root, 'last.png') }).catch(() => undefined);
    // The budget back to its default and every session stopped, whatever happened above.
    await invoke(page, 'settings.set', { engine: { memoryBudgetMiB: null } }).catch(() => undefined);
    for (const id of Object.values(ids)) {
      const s = await statusOrNull(page, id).catch(() => null);
      if (s && live(s)) await invoke(page, 'session.stop', { appSessionId: id as AppSessionId, reason: 'stop' }).catch(() => undefined);
    }
    record('consoleErrors', maws.consoleErrors());
    await maws.cleanup();
    record('journalsDir', join(scratch.userData, 'engine-host', 'journal').replace(scratch.root, '$C12'));
  }
  // after the cleanup, which runs whatever happened
  expect(run.consoleErrors, 'no console error in the page').toEqual([]);
});
