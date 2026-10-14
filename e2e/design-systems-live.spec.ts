// P3-D's live run (docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md, Acceptance 15; M7, Decision Log 28): "in a
// live run on the installed engine (scratch config home), the agent asked to 'make a design system from this project'
// over a fixture project with a CSS-variables file creates a Design System artifact whose token file validates and whose
// law has the nine sections". Its cap and scratch layout are P3-L's live run's (e2e/library-live.spec.ts): the product
// app (a plain build, as MAWS ships it) with the installed Claude Code (unmodified, D-1) under a scratch
// CLAUDE_CONFIG_DIR under /tmp (`settings.json` `{}`, a `.claude.json` trusting the scratch project), through
// ClaudeUsage's relay (GET /api/hello, one retry two minutes later, else the run is `blocked: relay`), on Haiku in default
// permission mode with the session's `--max-budget-usd`, every permission allowed once through the request card docked
// in the composer. The window is never shown (`launchMaws`'s quiet window).
// One session, one prompt over a small web project whose `src/styles/variables.css` holds its CSS custom properties. The
// system the agent made is then read as the store holds it, with no stand-in: moved into a Space linked to a scratch
// directory, the host's linked-directory mirror writes its file view (`readFiles`: the law, the token file, the canon,
// the generated files), and the token file must pass `validateTokenFile` and the law `parseLaw` with sections 0 to 8 and
// no problem. The library also opens it as the Design System page.
// The owner's ~/.claude.json is only read, for the A-15 delta before the launch and after the app closed. The run's lines
// go to stdout and to `live-run.txt` under the scratch root, which is kept for inspection (journals included).
// It spends money, within MAWS_LIVE_MAX_USD (US$0.75 when unset, at most US$1), the session's `--max-budget-usd`; run on
// purpose only (the script builds, the flag runs):
//   MAWS_LIVE=1 pnpm e2e:design-systems-live
// (`pnpm e2e:design-systems-live` alone builds and reports the case skipped.)
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { LibraryRow } from '@shared/ipc/schema/library';
import type { ArtifactCreateResult } from '@shared/maws/tools';
import { launchDefaults } from '../src/shared/composer/launch-defaults';
import { parseLaw } from '../src/artifacts/design-system/law';
import { validateTokenFile } from '../src/artifacts/design-system/tokens';
import { RELAY_URL } from '../src/engine-host/launch';
import { assertConfigHomeSafe } from '../test/live/support/live';
import { ownerPlugins } from '../test/support/claude-env';
import { isolatedGitEnv } from '../test/support/git-env';
import { compareA15 } from '../test/support/owner-file';
import { relaySkipReason } from '../test/support/relay-health';
import { journal, mainResults } from './support/c7-live';
import { invoke, value } from './support/c7-replay';
import { launchMaws, type MawsLaunch } from './support/launch';
import { liveMaxUsd } from './support/live-budget';
import { eventsOf, mcpCalls, mcpResultOf, ofKind, recordEvents, resultText, seedTranscripts } from './support/maws-tools';
import { a15Line, a15Reading, chargeOf, initPluginsOf, installedEngine } from './support/p1-live';
import { isAlive, ps } from './support/processes';
import { sidebarRow } from './support/sidebar';

test.skip(process.env.MAWS_LIVE !== '1', 'the P3-D live run runs only under MAWS_LIVE=1');
test.describe.configure({ timeout: 1_200_000 });

const CAP_USD = liveMaxUsd() ?? 0.75;
const TURN_MS = 900_000;

// The fixture project: a tutoring site whose look lives in one CSS-variables file.
const PROJECT: Record<string, string> = {
  'README.md': '# Harbor Tutoring\n\nThe website of an after-school tutoring centre for high-school students in Portland, Maine: course pages, a schedule and a sign-up form. Calm, plain and readable; parents read it on phones.\n',
  'package.json': `${JSON.stringify({ name: 'harbor-tutoring', private: true, version: '1.0.0', scripts: { dev: 'vite' } }, null, 2)}\n`,
  'src/styles/variables.css': `:root {
  /* colour */
  --color-paper: #fbfaf7;
  --color-surface: #f1eee6;
  --color-ink: #1f2933;
  --color-ink-muted: #56616c;
  --color-harbor: #1d5f8a;
  --color-on-harbor: #ffffff;
  --color-rule: #d8d2c4;
  --color-success: #2e7d4f;
  --color-warning: #9a6200;
  --color-danger: #b3261e;
  --color-info: #2b6cb0;
  /* type */
  --font-heading: "Charter", "Georgia", serif;
  --font-body: "Avenir Next", "Helvetica Neue", Arial, sans-serif;
  --font-code: "Menlo", monospace;
  --text-title: 40px;
  --text-h1: 32px;
  --text-h2: 24px;
  --text-h3: 20px;
  --text-body: 17px;
  --text-small: 14px;
  --leading-tight: 1.2;
  --leading-body: 1.6;
  /* space, radius, shadow */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --space-8: 64px;
  --radius-sm: 3px;
  --radius-md: 6px;
  --radius-lg: 12px;
  --radius-pill: 999px;
  --shadow-sm: 0 1px 2px rgba(31, 41, 51, 0.08);
  --shadow-md: 0 4px 12px rgba(31, 41, 51, 0.12);
  --shadow-lg: 0 12px 32px rgba(31, 41, 51, 0.16);
}
`,
  'src/styles/site.css': `@import "./variables.css";
body { margin: 0; background: var(--color-paper); color: var(--color-ink); font: var(--text-body)/var(--leading-body) var(--font-body); }
h1, h2, h3 { font-family: var(--font-heading); line-height: var(--leading-tight); }
a, .button { color: var(--color-harbor); }
.button { background: var(--color-harbor); color: var(--color-on-harbor); border-radius: var(--radius-md); padding: var(--space-2) var(--space-4); }
.card { background: var(--color-surface); border: 1px solid var(--color-rule); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: var(--space-5); }
`,
  'src/index.html': '<!doctype html><html><head><meta charset="utf-8"><title>Harbor Tutoring</title><link rel="stylesheet" href="styles/site.css"></head><body><main><h1>Harbor Tutoring</h1><p>Algebra, chemistry and essay writing, after school on weekdays.</p><a class="button" href="#signup">Sign up</a><section class="card"><h2>This term</h2><p>Courses start September 8.</p></section></main></body></html>\n',
};
const PROMPT =
  'Make a design system from this project. ' +
  'Make it as a MAWS Design System artifact: read the kind’s guide and format reference with mcp__maws__artifact_describe_type (kind "design_system"), read the project’s files, then create it with mcp__maws__artifact_create. ' +
  'Do every step yourself, one after another, never through an agent. When the artifact is created, reply with exactly one word: DONE.';

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };

test('an agent asked to make a design system from a project creates a Design System artifact whose token file validates and whose law has the nine sections', async () => {
  // the run's scratch: the config home, the trusted fixture project, the app's profile, the mirror's directory, the log
  const root = realpathSync(mkdtempSync('/tmp/maws-p3d-live-'));
  const config = join(root, 'claude-config');
  const repo = join(root, 'repo');
  const userData = join(root, 'user-data');
  const mirror = join(root, 'mirror');
  for (const dir of [config, repo, userData, mirror]) mkdirSync(dir, { recursive: true });
  const logFile = join(root, 'live-run.txt');
  const note = (line: string) => {
    appendFileSync(logFile, `${line}\n`);
    console.log(line);
  };

  let relay = relaySkipReason(RELAY_URL);
  if (relay !== null) {
    note(`relay not ready (${relay}); waiting two minutes and retrying once`);
    await new Promise((resolve) => setTimeout(resolve, 120_000));
    relay = relaySkipReason(RELAY_URL);
  }
  if (relay !== null) {
    note(`blocked: relay (${relay}) at ${new Date().toISOString()}`);
    test.skip(true, `blocked: relay: ${relay}`);
  }
  let engine: { bin: string; version: string };
  try {
    engine = installedEngine();
    if (!/^\d+\.\d+\.\d+$/.test(engine.version)) throw new Error(`no version from ${engine.bin} --version`);
  } catch (error) {
    note(`blocked: engine (${String(error)})`);
    test.skip(true, `blocked: engine: ${String(error)}`);
    return;
  }

  writeFileSync(join(config, 'settings.json'), '{}\n');
  writeFileSync(join(config, '.claude.json'), `${JSON.stringify({ hasCompletedOnboarding: true, theme: 'light', projects: { [repo]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } }, null, 2)}\n`);
  assertConfigHomeSafe({ configHome: config, controls: [] });
  for (const [path, text] of Object.entries(PROJECT)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  }
  const git = (...args: string[]) => execFileSync('/usr/bin/git', ['-c', 'user.name=P3-D', '-c', 'user.email=p3d@localhost', '-c', 'commit.gpgsign=false', ...args], { env: isolatedGitEnv(), cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'seed');
  const [engineId] = seedTranscripts(config, repo, ['P3-D live: a design system from a project']);

  const a15First = a15Reading();
  const ours = [root];
  note(`==== P3-D live run (M7, Acceptance 15), ${new Date().toISOString()}`);
  note(`engine: ${engine.bin.replace(homedir(), '~')} (${engine.version}), unmodified, through ClaudeUsage's relay ${RELAY_URL} (GET /api/hello 200), Haiku, default permission mode, --max-budget-usd ${CAP_USD} (MAWS_LIVE_MAX_USD)`);
  note(`scratch: ${root} (claude-config/ settings.json {} and .claude.json trusting repo/; repo/ the fixture project with src/styles/variables.css; user-data/ the app's profile, show: false; mirror/ the Space's linked directory); the app: the product build (out/main/index.js), every CLAUDE* variable of the runner dropped (launchEnvironment)`);
  note(a15Line('before the launch', a15First, a15First, ours));

  let maws: MawsLaunch | null = null;
  let id = '' as AppSessionId;
  let journalPath: string | null = null;
  let enginePid: number | null = null;
  let prompted = false; // a paid turn was asked for: from here an absent receipt is spend at the whole cap
  const allowed: string[] = [];
  let failure: unknown = null;
  try {
    maws = await launchMaws({ userData, env: { MAWS_E2E_ENGINE_BIN: engine.bin, MAWS_HARNESS: '0', CLAUDE_CONFIG_DIR: config } });
    const { page } = maws;
    const pane = page.locator('[data-region="main"] [data-pane="0"]');
    await recordEvents(page);
    await expect
      .poll(async () => {
        const { sessions } = value(await invoke(page, 'session.list', {}));
        id = (sessions.find((r) => r.engineSessionId === engineId)?.appId ?? '') as AppSessionId;
        return id !== '';
      }, { timeout: 30_000 })
      .toBe(true);
    const statusOf = async () => value(await invoke(page, 'session.status', { appSessionId: id }));
    const events = (): Promise<SessionEvent[]> => eventsOf(page, id);
    const mainTurnsEnded = (all: SessionEvent[]) => ofKind(all, 'turn.ended').filter((e) => e.parentToolUseId === null && !e.isEchoReceipt);
    const ipc = async <T,>(name: string, input: unknown): Promise<T> => {
      const result = (await page.evaluate(([n, i]) => window.maws.invoke(n as never, i as never), [name, input] as const)) as Result<T>;
      if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
      return result.value;
    };
    const seeded = (await ipc<{ artifacts: { id: string; title: string }[] }>('artifacts.list', { filter: { kind: 'design_system' } })).artifacts;
    note(`the store's design systems before the turn: ${JSON.stringify(seeded.map((s) => s.title))}`);

    // the session shown, launched fresh as the app launches (Haiku, default mode, the run's cap), the prompt sent from
    // the real composer
    await (await sidebarRow(page, { appSessionId: id })).click();
    await page.mouse.move(700, 20);
    await expect(pane.locator(`[data-composer="${id}"]`)).toBeVisible();
    const spec = { ...launchDefaults(id, repo), model: 'haiku', permissionMode: 'default' as const, subagentModel: 'haiku', maxBudgetUsd: CAP_USD };
    expect(value(await invoke(page, 'session.launch', { spec }))).toMatchObject({ status: 'launching' });
    journalPath = (await statusOf()).journalPath;
    await expect.poll(async () => (await statusOf()).process, { timeout: 120_000 }).toBe('ready');
    enginePid = (await statusOf()).pid;
    const message = pane.getByRole('textbox', { name: 'Message', exact: true });
    await message.click();
    await page.keyboard.insertText(PROMPT);
    prompted = true;
    await page.keyboard.press('Enter');

    // the turn, every permission it asks allowed once through the card docked in the composer
    const idleNow = async () => {
      const status = await statusOf();
      return status.turn === null && status.pendingRequests === 0;
    };
    const deadline = Date.now() + TURN_MS;
    for (;;) {
      if (mainTurnsEnded(await events()).length > 0 && (await idleNow())) break;
      if (Date.now() > deadline) throw new Error('timed out waiting for the turn to end');
      const all = await events();
      const resolved = new Set(ofKind(all, 'permission.resolved').map((e) => e.requestId));
      const open = ofKind(all, 'permission.requested').filter((e) => !resolved.has(e.requestId));
      if (open.length > 0) {
        const frame = pane.getByRole('group', { name: 'Approval needed' });
        const allow = frame.getByRole('button', { name: 'Allow', exact: true });
        if ((await allow.isVisible().catch(() => false)) && (await allow.isEnabled().catch(() => false))) {
          const once = frame.getByRole('radio', { name: 'Allow once' });
          if ((await once.count()) > 0) await once.click();
          await allow.click();
          allowed.push(open[0]!.toolName);
          await expect.poll(async () => ofKind(await events(), 'permission.resolved').some((e) => e.requestId === open[0]!.requestId), { timeout: 30_000 }).toBe(true);
          continue;
        }
      }
      await page.waitForTimeout(400);
    }

    // the turn's tool calls and the maws calls' answers, from the journal
    const rows = journal(journalPath);
    const calls = mcpCalls(rows);
    const reply = mainTurnsEnded(await events()).at(-1)?.resultText ?? '';
    const tools = ofKind(await events(), 'tool.use').filter((e) => e.parentToolUseId === null).map((e) => e.toolName);
    note(`the turn: tools in order ${JSON.stringify(tools)}; permissions allowed once through the card ${JSON.stringify(allowed)}; reply ${JSON.stringify(reply)}`);
    const [init] = ofKind(await events(), 'session.init');
    expect(ownerPlugins(init?.plugins ?? [], [root]), 'none of the owner plugins').toEqual([]);
    note(`init plugins ${JSON.stringify(initPluginsOf(rows))} (none of the owner's)`);
    for (const c of calls) {
      const answer = mcpResultOf(rows, c.requestId);
      const files = c.args.files && typeof c.args.files === 'object' ? Object.fromEntries(Object.entries(c.args.files as Record<string, string>).map(([path, text]) => [path, `${text.length} chars`])) : undefined;
      note(`maws ${c.name} ${JSON.stringify({ ...c.args, ...(files ? { files } : {}) })} -> ${answer ? `${answer.isError ? 'ERROR ' : ''}${resultText(answer).slice(0, 600)}` : 'no answer'}`);
    }
    const creates = calls.filter((c) => c.name === 'artifact_create' && c.args.kind === 'design_system').map((c) => ({ call: c, answer: mcpResultOf(rows, c.requestId) }));
    const made = creates.filter(({ answer }) => answer !== null && answer.isError === undefined);
    expect(made.length, `a design_system artifact_create succeeded (${creates.length} tried)`).toBeGreaterThan(0);
    const created = JSON.parse(resultText(made.at(-1)!.answer!)) as ArtifactCreateResult;
    expect(created).toMatchObject({ status: 'created', kind: 'design_system' });
    const systemId = created.artifactId;

    // main's library: the system, linked `created` to the session
    const row = (await ipc<{ row: LibraryRow | null }>('library.get', { artifactId: systemId })).row;
    expect(row?.kind).toBe('design_system');
    expect(row?.sessions.find((s) => s.appSessionId === id)?.roles).toContain('created');
    note(`library.get: ${JSON.stringify({ id: row!.id, kind: row!.kind, title: row!.title, revision: row!.revision, lastEditor: row!.lastEditor, sessions: row!.sessions.map((s) => ({ appSessionId: s.appSessionId, roles: s.roles })) })}`);

    // the system as the store holds it: moved into a Space linked to the mirror's directory, whose mirror writes its
    // file view, read here and validated with the kind's own checks
    const { space } = await ipc<{ space: { id: string } }>('spaces.create', { name: 'Harbor Tutoring', linkedDir: mirror });
    await ipc('artifacts.update', { artifactId: systemId, spaceId: space.id });
    const manifestFile = join(mirror, 'artifacts', '.maws-mirror.json');
    let mirrored: string[] = [];
    await expect
      .poll(() => {
        if (!existsSync(manifestFile)) return false;
        mirrored = (JSON.parse(readFileSync(manifestFile, 'utf8')) as { artifacts: Record<string, { files: string[] }> }).artifacts[systemId]?.files ?? [];
        return mirrored.some((file) => file.endsWith('/tokens.tokens.json')) && mirrored.some((file) => file.endsWith('/DESIGN.md'));
      }, { timeout: 30_000, message: 'the mirror wrote the system’s file view' })
      .toBe(true);
    note(`mirrored files: ${JSON.stringify(mirrored)}`);
    const fileOf = (name: string) => readFileSync(join(mirror, 'artifacts', mirrored.find((file) => file.endsWith(`/${name}`))!), 'utf8');
    const tokens = validateTokenFile(JSON.parse(fileOf('tokens.tokens.json')));
    note(`validateTokenFile: ok ${tokens.ok}, ${tokens.tokens?.tokens.size ?? 0} tokens, problems ${JSON.stringify(tokens.problems)}`);
    const law = parseLaw(fileOf('DESIGN.md'));
    note(`parseLaw: title ${JSON.stringify(law.title)}, persona ${JSON.stringify(law.persona)}, sections ${JSON.stringify(law.sections.map((s) => `${s.number} ${s.title}`))}, ${law.donts.length} hard don'ts (${law.donts.filter((d) => d.tags.length > 0).length} tagged), problems ${JSON.stringify(law.problems)}`);
    expect(tokens.problems, 'the token file validates').toEqual([]);
    expect(tokens.ok).toBe(true);
    expect(law.sections.map((s) => s.number), 'the law has the nine sections in order').toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(law.problems).toEqual([]);

    // the library opens it as the Design System page
    await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
    await page.locator('[data-library]').getByRole('article', { name: row!.title, exact: true }).click();
    const tab = page.locator(`[data-artifact-tab="${systemId}"]`);
    await expect(tab.locator(`[data-ds-page="${systemId}"]`)).toBeVisible({ timeout: 15_000 });
    await expect(tab.getByLabel('--ds-color-accent hex')).toBeVisible();
    note(`the page: accent ${await tab.getByLabel('--ds-color-accent hex').inputValue()}, law sections shown ${await tab.locator('[data-ds-section="law"] h2, [data-ds-section="law"] h3').count()}`);

    const errors = maws.consoleErrors();
    note(`the window's console errors: ${JSON.stringify(errors)}`);
    expect.soft(errors).toEqual([]);
    note('PASS: the agent made a Design System artifact from the project; its token file validates, its law has sections 0 to 8 with no problem, and it opens as the Design System page');
  } catch (error) {
    failure = error;
    note(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // The session stopped, the app closed, the engine process gone (a detached host can outlive the app, so the app's
    // close proves nothing about the engine), the spend from the journal's receipts, the owner file read again. Every
    // step runs whatever an earlier one threw; the first error fails the test after the bookkeeping.
    const failed = (what: string) => (error: unknown) => {
      note(`${what}: ${error instanceof Error ? error.message : String(error)}`);
      failure ??= error;
    };
    if (maws !== null && id !== '') {
      const page = maws.page;
      await (async () => {
        const status = value(await invoke(page, 'session.status', { appSessionId: id }));
        enginePid ??= status.pid;
        if (status.process !== 'exited') {
          value(await invoke(page, 'session.stop', { appSessionId: id, reason: 'stop' }));
          await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId: id })).process, { timeout: 30_000 }).toBe('exited');
        }
      })().catch(failed('the session could not be stopped'));
    }
    await maws?.cleanup().catch(failed('the app’s cleanup failed'));
    if (enginePid !== null && isAlive(enginePid)) {
      const command = ps(enginePid, 'command');
      if (/claude/.test(command)) {
        failed('the engine outlived the app')(new Error(`pid ${enginePid} (${command}) still runs after the app closed; killed`));
        try {
          process.kill(enginePid, 'SIGKILL');
        } catch {
          // gone since the check
        }
      }
    }
    note(`engine process: ${enginePid === null ? 'none recorded (no launch reached ready)' : `pid ${enginePid} ${isAlive(enginePid) ? 'STILL ALIVE' : 'gone'}`}`);
    // The receipt is the engine's own `total_cost_usd`; a prompt with no receipt after it (a failed, stopped or
    // unjournalled turn) is accounted at the whole cap, the session's --max-budget-usd (p1-live.ts's chargeOf), since
    // an absent receipt must never read as no spend.
    const rows = journalPath !== null && existsSync(journalPath) ? journal(journalPath) : [];
    const charge = chargeOf(rows, CAP_USD);
    const receipts = mainResults(rows).map((r) => r.frame.total_cost_usd).filter((usd): usd is number => typeof usd === 'number' && Number.isFinite(usd));
    const accounted = prompted && rows.length === 0 ? CAP_USD : charge.usd;
    note(`spend: receipt ${receipts.length > 0 ? `total_cost_usd ${charge.receipted.toFixed(4)}` : 'none'}; accounted exposure US$${accounted.toFixed(4)} (${!prompted ? 'no prompt sent' : rows.length === 0 ? 'no journal: the whole cap' : charge.settled ? 'settled by its receipt' : 'unreceipted turn: the whole cap'}); cap US$${CAP_USD}; journal ${journalPath ?? 'none (no launch)'}`);
    const a15After = a15Reading();
    note(a15Line('after the app closed', a15First, a15After, ours));
    note(`scratch kept for inspection: ${root}`);
    expect(compareA15(a15First.keys, a15After.keys, ours).breach, 'no project of the run’s scratch in the owner file (A-15)').toEqual([]);
    expect(accounted, 'within the cap').toBeLessThanOrEqual(CAP_USD);
    if (failure === null) {
      expect(receipts.length, 'a passing run has the engine’s receipt for its turn').toBeGreaterThan(0);
      expect(charge.settled, 'the receipt came after the prompt').toBe(true);
    }
  }
  if (failure !== null) throw failure;
});
