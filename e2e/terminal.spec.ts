// C9's end-to-end (acceptance items 2 to 8, 10's link and theme halves, 11's simulated loss and 12): the built app
// under MAWS_HARNESS=1 on the `#panel` harness page, with the real renderer, the real PTY host and real login shells.
// Commands are typed into a terminal through `pty.write` (the harness's `terminals.type`), exactly the bytes a
// keystroke would send; Playwright's keyboard is used only where the key path itself is under test. While a test
// neither types nor scrolls through Playwright, the page's input guard cancels and counts physical wheel and key events
// (the owner's trackpad reaches Playwright's window on this Mac), and the count is reported as an annotation.
import { expect, type ElectronApplication, type Page } from '@playwright/test';
import { test } from './support/launch';

// The parent-session variables a terminal must never inherit (§4.1) and two engine-launch ones (D-19), set to fake
// values in the app's own environment so the exclusion is proven wherever the suite runs.
const INHERITED = {
  CLAUDE_CODE_SESSION_ID: 'e2e-parent-session',
  CLAUDE_PID: '424242',
  CLAUDECODE: '1',
  ANTHROPIC_BASE_URL: 'http://127.0.0.1:9/e2e',
  ANTHROPIC_AUTH_TOKEN: 'e2e-token',
};
test.use({ mawsEnv: { MAWS_HARNESS: '1', ...INHERITED } });

const DIR_A = '/tmp/maws-harness/a';
const DIR_B = '/tmp/maws-harness/b';
const FOX = "yes 'the quick brown fox jumps over the lazy dog 0123456789' | head -c 50000000";
const W3 = "seq -f '%.0f' 1 20000000";
const W3_OUTPUT_BYTES = 168_888_897;
const W3_LINE_FEEDS = 20_000_000;
const SCROLLBACK = 10_000;

type TerminalId = string;
interface Info {
  id: TerminalId;
  appSessionId: string;
  label: string;
  cwd: string;
  ptyId: string | null;
  pid: number | null;
  status: 'starting' | 'running' | 'exited' | 'lost';
  title: string | null;
  acceleration: 'webgl' | 'dom';
  visible: boolean;
  reconnect: 'exact' | 'lossy' | null;
  error: string | null;
}
interface Modes {
  alternateScreen: boolean;
  bracketedPaste: boolean;
  applicationCursorKeys: boolean;
  mouseTracking: string;
}
interface Snap {
  count: number;
  rows: number;
  cols: number;
  first: string;
  screen: string[];
  modes: Modes;
}
interface Counters {
  bytes: number;
  lineFeeds: number;
  carriageReturns: number;
}
interface Tab {
  id: string;
  toolId: string;
  title: string;
  pinned: boolean;
  home: string;
  selected: boolean;
  terminalId: TerminalId | null;
}
type Api = Record<string, Record<string, (...args: unknown[]) => unknown>>;
type HarnessWindow = { __maws_harness?: Api & { page: string } };

// The `#panel` page driven through `window.__maws_harness`.
class Harness {
  constructor(
    readonly page: Page,
    readonly app: ElectronApplication,
  ) {}

  call<T>(namespace: 'panel' | 'terminals' | 'keys', method: string, ...args: unknown[]): Promise<T> {
    return this.page.evaluate(
      ([namespace, method, args]) => (window as unknown as HarnessWindow).__maws_harness![namespace]![method]!(...args),
      [namespace, method, args] as const,
    ) as Promise<T>;
  }

  // The window opens on the harness entry, C6's hash router, on its default page; `#panel` is a hash route. A mounted
  // page has assigned `window.__maws_harness`, which also means the router listens for `hashchange` (its effect runs
  // in the same commit). After a reload the page comes back on `#panel`.
  async load(): Promise<TerminalId[]> {
    await this.page.waitForFunction(() => (window as unknown as HarnessWindow).__maws_harness !== undefined, null, { timeout: 15_000 });
    await this.page.evaluate(() => (location.hash = '#panel'));
    await this.page.waitForFunction(() => (window as unknown as HarnessWindow).__maws_harness?.page === 'panel', null, { timeout: 15_000 });
    return this.call<TerminalId[]>('panel', 'ready');
  }

  sessions = () => this.page.evaluate(() => (window as unknown as HarnessWindow).__maws_harness!.panel!.sessions as unknown as { A: string; B: string });
  tabs = () => this.call<Tab[]>('panel', 'tabs');
  list = () => this.call<Info[]>('terminals', 'list');
  info = async (id: TerminalId) => (await this.list()).find((info) => info.id === id);
  type = (id: TerminalId, data: string) => this.call<void>('terminals', 'type', id, data);
  run = (id: TerminalId, command: string) => this.type(id, `${command}\r`);
  counters = (id: TerminalId) => this.call<Counters>('terminals', 'counters', id);

  async addTerminal(opts: Record<string, unknown> = {}): Promise<{ tabId: string; id: TerminalId }> {
    const tabId = await this.call<string>('panel', 'addTool', 'terminal', opts);
    const tab = (await this.tabs()).find((t) => t.id === tabId)!;
    return { tabId, id: tab.terminalId! };
  }

  snap(id: TerminalId): Promise<Snap> {
    return this.page.evaluate((id) => {
      const probe = (window as unknown as HarnessWindow).__maws_harness!.terminals!.probe!(id) as {
        rows: number;
        cols: number;
        line(row: number): string;
        lineCount(): number;
        modes(): Modes;
      };
      const count = probe.lineCount();
      const base = Math.max(0, count - probe.rows);
      return {
        count,
        rows: probe.rows,
        cols: probe.cols,
        first: probe.line(0),
        screen: Array.from({ length: probe.rows }, (_, i) => probe.line(base + i)),
        modes: probe.modes(),
      };
    }, id);
  }

  // Every buffer line (scrollback first), right-trimmed.
  lines(id: TerminalId): Promise<string[]> {
    return this.page.evaluate((id) => {
      const probe = (window as unknown as HarnessWindow).__maws_harness!.terminals!.probe!(id) as { line(row: number): string; lineCount(): number } | null;
      return probe ? Array.from({ length: probe.lineCount() }, (_, i) => probe.line(i)) : []; // null until the renderer exists
    }, id);
  }

  async hasLine(id: TerminalId, text: string): Promise<boolean> {
    return (await this.lines(id)).some((line) => line.trim() === text);
  }

  // The screen has not changed for `quiet` ms.
  async idle(id: TerminalId, quiet = 600): Promise<void> {
    let last = JSON.stringify((await this.snap(id)).screen);
    let since = Date.now();
    for (;;) {
      await sleep(150);
      const now = JSON.stringify((await this.snap(id)).screen);
      if (now !== last) [last, since] = [now, Date.now()];
      else if (Date.now() - since >= quiet) return;
    }
  }

  async prompt(id: TerminalId, timeout = 15_000): Promise<void> {
    await expect
      .poll(async () => (await this.info(id))?.status === 'running' && (await this.snap(id)).screen.some((line) => line.trim() !== ''), { timeout, message: 'a prompt' })
      .toBe(true);
    await this.idle(id);
  }

  // Runs a command and waits until a line equal to `text` is in the buffer.
  async expectLine(id: TerminalId, text: string, timeout = 5_000): Promise<void> {
    await expect.poll(() => this.hasLine(id, text), { timeout, message: `a line reading ${text}` }).toBe(true);
  }

  // The centre of a cell of the visible screen, in page coordinates.
  cellPoint(id: TerminalId, col: number, row: number): Promise<{ x: number; y: number }> {
    return this.page.evaluate(
      ([id, col, row]) => {
        const screen = document.querySelector(`[data-terminal-id="${id}"] .xterm-screen`)!.getBoundingClientRect();
        const probe = (window as unknown as HarnessWindow).__maws_harness!.terminals!.probe!(id) as { cols: number; rows: number };
        return { x: screen.left + ((col + 0.5) * screen.width) / probe.cols, y: screen.top + ((row + 0.5) * screen.height) / probe.rows };
      },
      [id, col, row] as const,
    );
  }

  tab = (tabId: string) => this.page.locator(`[role="tab"][data-tab-id="${tabId}"]`);
  bar = (name: string) => this.page.getByRole('status', { name });
}

const harnessOf = async (maws: { page: Page; app: ElectronApplication }) => {
  const harness = new Harness(maws.page, maws.app);
  await harness.load();
  return harness;
};

// The input guard around a stretch of the test that sends no Playwright keys or wheel; the count is reported.
async function guarded<T>(harness: Harness, body: () => Promise<T>): Promise<T> {
  await harness.page.evaluate(() => ((window as unknown as HarnessWindow).__maws_harness!.panel!.inputGuard as unknown as { arm(): void }).arm());
  try {
    return await body();
  } finally {
    const blocked = await harness.page
      .evaluate(() => ((window as unknown as HarnessWindow).__maws_harness?.panel?.inputGuard as unknown as { disarm(): number } | undefined)?.disarm() ?? 0)
      .catch(() => -1);
    test.info().annotations.push({ type: 'blockedInputEvents', description: String(blocked) });
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Waits, frame by frame, until a buffer line reads `text` (trimmed), or with `null` until any line is non-empty (the
// terminal may have no renderer yet). The page's CSP allows no eval, so the matcher travels as data.
async function untilLine(h: Harness, id: TerminalId, text: string | null, timeout = 10_000): Promise<void> {
  await h.page.waitForFunction(
    ([id, text]) => {
      const probe = (window as unknown as HarnessWindow).__maws_harness!.terminals!.probe!(id) as { line(row: number): string; lineCount(): number } | null;
      if (!probe) return false;
      return Array.from({ length: probe.lineCount() }, (_, i) => probe.line(i).trim()).some((line) => (text === null ? line !== '' : line === text));
    },
    [id, text] as const,
    { polling: 'raf', timeout },
  );
}

// The debug strip's PTY host state reads `ready`.
async function hostReady(h: Harness): Promise<void> {
  await expect(h.page.getByLabel('pty host state')).toHaveText(/^host ready pid \d+/, { timeout: 15_000 });
}

// `kill(pid, 0)` sends nothing; it throws ESRCH once the process is gone.
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

test('opens a login shell in the session directory with the terminal environment', async ({ maws }) => {
  const h = await harnessOf(maws);
  const { page } = maws;
  const A = (await h.sessions()).A;
  // "+", Terminal, and the time from the click to the first visible line of the new terminal.
  const openFromMenu = async (): Promise<{ id: TerminalId; ms: number }> => {
    const before = new Set((await h.tabs()).map((t) => t.id));
    await page.getByRole('button', { name: 'add tool' }).click();
    const clicked = Date.now();
    await page.getByRole('menuitem', { name: 'Terminal' }).click();
    const tab = (await h.tabs()).find((t) => !before.has(t.id))!;
    expect(tab).toMatchObject({ toolId: 'terminal', selected: true, home: A });
    await untilLine(h, tab.terminalId!, null);
    return { id: tab.terminalId!, ms: Date.now() - clicked };
  };

  // Acceptance item 2: the first terminal after launch, opened as soon as the host reads ready, also waits for what is
  // left of the host's one-time login-shell environment capture; it is held to three seconds and its number logged.
  await hostReady(h);
  const cold = await openFromMenu();
  test.info().annotations.push({ type: 'coldPromptMs', description: String(cold.ms) });
  expect(cold.ms, 'the first terminal after launch shows a prompt within three seconds').toBeLessThanOrEqual(3_000);
  await h.prompt(cold.id);
  // A terminal opened in the running app: two seconds from the click.
  const warm = await openFromMenu();
  test.info().annotations.push({ type: 'promptMs', description: String(warm.ms) });
  expect(warm.ms, 'a prompt appears within two seconds').toBeLessThanOrEqual(2_000);
  const id = warm.id;
  await h.prompt(id);

  await guarded(h, async () => {
    await h.run(id, 'pwd');
    await h.expectLine(id, DIR_A);
    await h.run(id, `printf '%s\\n' "T:$TERM" "P:$TERM_PROGRAM" "S:$CLAUDE_CODE_FORCE_SYNC_OUTPUT" "L:$LANG$LC_ALL$LC_CTYPE"`);
    await h.expectLine(id, 'T:xterm-256color');
    await h.expectLine(id, 'P:MAWS');
    await h.expectLine(id, 'S:1');
    expect((await h.lines(id)).some((line) => /^L:.+/.test(line.trim())), 'a non-empty locale').toBe(true);
    await h.run(id, `echo "N:$(env | grep -c -E '^(CLAUDE_CODE_SESSION_ID|CLAUDE_PID|CLAUDECODE|ANTHROPIC_BASE_URL|ANTHROPIC_AUTH_TOKEN|MAWS_USER_DATA)=')"`);
    await h.expectLine(id, 'N:0');
    const shell = process.env.SHELL ?? '/bin/zsh';
    await h.run(id, 'echo "0:$0"');
    await h.expectLine(id, `0:${shell}`);
    if (shell.endsWith('zsh')) {
      await h.run(id, `[[ -o login ]] && echo "LOGIN:yes"`);
      await h.expectLine(id, 'LOGIN:yes');
    }
  });
  expect(maws.consoleErrors()).toEqual([]);
});

test('keeps its buffer and process across tab switches', async ({ maws }) => {
  const h = await harnessOf(maws);
  const { tabId, id } = await h.addTerminal();
  await h.prompt(id);
  const pid = (await h.info(id))!.pid!;
  const lastNumber = async () => Math.max(0, ...(await h.lines(id)).map((line) => Number(/^line (\d+)$/.exec(line.trim())?.[1] ?? 0)));

  await guarded(h, async () => {
    await h.run(id, 'for i in $(seq 1 100000); do echo line $i; sleep 0.001; done');
    await expect.poll(lastNumber, { timeout: 5_000 }).toBeGreaterThan(50);
    const before = await lastNumber();

    await h.page.getByRole('tab', { name: 'Review' }).getByRole('button').click();
    await expect(h.page.locator(`[data-terminal-id="${id}"]`), 'the unselected tool is unmounted').toHaveCount(0);
    expect(await h.info(id)).toMatchObject({ visible: false, status: 'running' });
    await sleep(5_000);

    await h.tab(tabId).getByRole('button').first().click();
    await expect(h.page.locator(`[data-terminal-id="${id}"]`)).toHaveCount(1);
    const lines = await h.lines(id);
    expect(lines.some((line) => line.trim() === 'line 1') || lines.length >= SCROLLBACK, 'the buffer was not restarted').toBe(true);
    expect(lines.some((line) => line.trim() === `line ${before}`), 'the lines printed before the switch are still there').toBe(true);
    const shown = await lastNumber();
    expect(shown, 'the loop kept printing while hidden').toBeGreaterThan(before);
    await expect.poll(lastNumber, { timeout: 3_000, message: 'still printing' }).toBeGreaterThan(shown);
    expect(await h.info(id)).toMatchObject({ visible: true, status: 'running', pid });
    const ptys = await h.call<{ pid: number; label: string }[]>('terminals', 'ptys');
    expect(ptys.find((pty) => pty.label === tabId)?.pid, 'pty.list shows the same pid').toBe(pid);
  });
  await h.type(id, '\x03');
});

test('pinned tab keeps its shell across sessions and warns about the worktree', async ({ maws }) => {
  const h = await harnessOf(maws);
  const { page } = maws;
  const { tabId, id } = await h.addTerminal();
  await h.prompt(id);
  const pid = (await h.info(id))!.pid!;

  await h.tab(tabId).getByRole('button', { name: 'pin tab' }).click();
  await page.getByRole('group', { name: 'session' }).getByRole('button', { name: 'Session B' }).click();
  await expect(h.tab(tabId)).toHaveAttribute('aria-selected', 'true');
  expect(await h.info(id)).toMatchObject({ pid, status: 'running', visible: true });
  const warning = h.bar('worktree warning');
  await expect(warning).toContainText(`This terminal is in ${DIR_A}; the session now runs in ${DIR_B}.`);

  await warning.getByRole('button', { name: 'New terminal here' }).click();
  const second = (await h.tabs()).find((tab) => tab.id !== tabId)!;
  expect(second).toMatchObject({ selected: true, pinned: false, title: expect.stringMatching(/^Terminal 2/) });
  await h.prompt(second.terminalId!);
  await guarded(h, async () => {
    await h.run(second.terminalId!, 'pwd');
    await h.expectLine(second.terminalId!, DIR_B);
  });
  await expect(h.bar('worktree warning')).toHaveCount(0);

  await page.getByRole('group', { name: 'session' }).getByRole('button', { name: 'Session A' }).click();
  await expect(h.tab(tabId)).toHaveAttribute('aria-selected', 'true');
  await expect(h.tab(second.id), 'the unpinned tab belongs to session B').toHaveCount(0);
  await expect(h.bar('worktree warning')).toHaveCount(0);
  expect(await h.info(id)).toMatchObject({ pid, status: 'running' });
});

test('asks before closing a busy terminal', async ({ maws }) => {
  const h = await harnessOf(maws);
  const { tabId, id } = await h.addTerminal();
  await h.prompt(id);
  const pid = (await h.info(id))!.pid!;

  await h.run(id, 'sleep 1000');
  await expect.poll(async () => (await h.page.evaluate(async (ptyId) => window.maws.invoke('pty.foreground', { ptyId: ptyId as never }), (await h.info(id))!.ptyId))).toMatchObject({ ok: true, value: { busy: true } });
  await h.tab(tabId).getByRole('button', { name: 'close tab' }).click();
  const confirm = h.page.getByRole('alert', { name: 'close confirmation' });
  await expect(confirm).toHaveText(/^A command is running: sleep\. Close anyway\?/);

  await confirm.getByRole('button', { name: 'Keep' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(h.tab(tabId)).toHaveCount(1);
  expect(isAlive(pid), 'Keep leaves the shell running').toBe(true);
  expect(await h.info(id)).toMatchObject({ status: 'running' });

  await h.tab(tabId).getByRole('button', { name: 'close tab' }).click();
  await confirm.getByRole('button', { name: 'Close' }).click();
  await expect(h.tab(tabId)).toHaveCount(0);
  await expect.poll(() => isAlive(pid), { timeout: 5_000, message: 'the shell ends' }).toBe(false);

  const idle = await h.addTerminal();
  await h.prompt(idle.id);
  await h.tab(idle.tabId).getByRole('button', { name: 'close tab' }).click();
  await expect(h.tab(idle.tabId), 'an idle terminal closes without a question').toHaveCount(0);
  await expect(confirm).toHaveCount(0);
});

test('shows terminal lost on host crash and respawns after restart', async ({ maws }) => {
  const h = await harnessOf(maws);
  const { app, page } = maws;
  const { id } = await h.addTerminal();
  await h.prompt(id);
  const oldPid = (await h.info(id))!.pid!;
  const host = await page.evaluate(() => window.maws.invoke('pty.hostState', undefined));
  if (!host.ok || host.value.pid === null) throw new Error(`pty.hostState: ${JSON.stringify(host)}`);

  // Watch every frame for the lost bar with "New terminal" disabled: the host is back within about a second.
  const sawDisabled = page.waitForFunction(
    () => {
      const bar = document.querySelector('[role="status"][aria-label="terminal status"]');
      const button = Array.from(bar?.querySelectorAll('button') ?? []).find((b) => b.textContent === 'New terminal');
      return !!bar?.textContent?.includes('Terminal lost, the terminal service restarted') && !!button?.disabled;
    },
    null,
    { polling: 'raf', timeout: 5_000 },
  );
  const killedAt = Date.now();
  await app.evaluate((_electron, pid) => process.kill(pid, 'SIGKILL'), host.value.pid);
  await sawDisabled;
  const lostMs = Date.now() - killedAt;
  test.info().annotations.push({ type: 'lostMs', description: String(lostMs) });
  expect(lostMs, 'the tab shows the lost bar within two seconds').toBeLessThan(2_000);
  expect((await h.info(id))!.status).toBe('lost');

  const status = h.bar('terminal status');
  const again = status.getByRole('button', { name: 'New terminal' });
  await expect(again, 'enabled once the host is ready').toBeEnabled({ timeout: 10_000 });
  await again.click();
  await expect(status).toHaveCount(0);
  await h.prompt(id);
  const info = (await h.info(id))!;
  expect(info.status).toBe('running');
  expect(info.pid).not.toBe(oldPid);
  await guarded(h, async () => {
    await h.run(id, 'pwd');
    await h.expectLine(id, DIR_A);
  });
});

// Terminal 1 at a zsh prompt after `seq 1 20000`; Terminal 2 running `top` after a marker line.
async function reloadScene(h: Harness) {
  const t1 = await h.addTerminal();
  await h.prompt(t1.id);
  await h.run(t1.id, 'seq 1 20000');
  await h.expectLine(t1.id, '20000');
  await h.idle(t1.id, 1_000);
  const t2 = await h.addTerminal();
  await h.prompt(t2.id);
  await h.run(t2.id, 'echo BEFORE-TOP-$((6*7))');
  await h.expectLine(t2.id, 'BEFORE-TOP-42');
  await h.run(t2.id, 'top -s 1');
  await expect.poll(async () => (await h.snap(t2.id)).modes.alternateScreen, { timeout: 10_000 }).toBe(true);
  await sleep(1_500);
  return { t1, t2 };
}

async function reloadAndFind(h: Harness, pids: number[]): Promise<Info[]> {
  await h.page.reload();
  await h.load();
  const infos = await h.list();
  return pids.map((pid) => {
    const info = infos.find((i) => i.pid === pid);
    if (!info) throw new Error(`no terminal with pid ${pid} after the reload: ${JSON.stringify(infos)}`);
    return info;
  });
}

test('re-adopts a live pty after reload exactly', async ({ maws }) => {
  test.setTimeout(120_000);
  const h = await harnessOf(maws);
  await guarded(h, async () => {
    const { t1, t2 } = await reloadScene(h);
    await h.call('panel', 'selectTab', t1.tabId);
    await h.idle(t1.id);
    const before1 = await h.snap(t1.id);
    const before2 = await h.snap(t2.id);
    const pids = [(await h.info(t1.id))!.pid!, (await h.info(t2.id))!.pid!];

    const [a1, a2] = await reloadAndFind(h, pids);
    expect(a1).toMatchObject({ reconnect: 'exact', status: 'running', label: t1.tabId });
    expect(a2).toMatchObject({ reconnect: 'exact', status: 'running', label: t2.tabId });
    expect((await h.tabs()).map((tab) => tab.id).sort(), 'one tab per re-adopted shell, under its label').toEqual([t1.tabId, t2.tabId].sort());

    await h.call('panel', 'selectTab', t1.tabId);
    const after1 = await h.snap(a1!.id);
    expect(after1.count, 'the same lines, and no new prompt drawn').toBe(before1.count);
    expect(after1.first).toBe(before1.first);
    expect(after1.modes).toEqual(before1.modes);
    expect(after1.modes.bracketedPaste).toBe(true);

    await h.call('panel', 'selectTab', t2.tabId);
    const frame = await h.snap(a2!.id);
    expect(frame.modes).toEqual(before2.modes);
    expect(frame.modes.alternateScreen).toBe(true);
    await expect.poll(async () => JSON.stringify((await h.snap(a2!.id)).screen), { timeout: 3_000, message: 'top keeps updating' }).not.toBe(JSON.stringify(frame.screen));

    await h.type(a2!.id, 'q');
    await expect.poll(async () => (await h.snap(a2!.id)).modes.alternateScreen).toBe(false);
    await h.idle(a2!.id);
    expect((await h.snap(a2!.id)).screen.some((line) => line.trim() === 'BEFORE-TOP-42'), 'the pre-top screen is back').toBe(true);
  });
});

test('reconnects lossily with a notice when no checkpoint reaches the ring', async ({ maws }) => {
  test.setTimeout(120_000);
  const h = await harnessOf(maws);
  await guarded(h, async () => {
    const { t1, t2 } = await reloadScene(h);
    const pids = [(await h.info(t1.id))!.pid!, (await h.info(t2.id))!.pid!];
    await h.call('terminals', 'setCheckpoints', false);
    await h.call('panel', 'selectTab', t1.tabId);
    await h.run(t1.id, 'yes | head -c 5000000');
    await h.idle(t1.id, 1_000);

    const [l1, l2] = await reloadAndFind(h, pids);
    expect(l1!.reconnect).toBe('lossy');
    await h.call('panel', 'selectTab', t1.tabId);
    await expect(h.bar('reconnect notice')).toHaveText('Reconnected; earlier output was not kept');
    expect((await h.snap(l1!.id)).first, 'the buffer starts on a whole line').toBe('y');

    await h.call('panel', 'selectTab', t2.tabId);
    test.info().annotations.push({ type: 'topReconnect', description: String(l2!.reconnect) });
    const frame = JSON.stringify((await h.snap(l2!.id)).screen);
    const shownAt = Date.now();
    // Within top's own period (one second, plus its sampling time, which exceeds half a second under load).
    await expect.poll(async () => JSON.stringify((await h.snap(l2!.id)).screen), { timeout: 3_000, intervals: [100], message: 'top repaints' }).not.toBe(frame);
    test.info().annotations.push({ type: 'topRepaintMs', description: String(Date.now() - shownAt) });
    await h.type(l2!.id, 'q');
  });
});

test('floods without loss while the page stays responsive', async ({ maws }) => {
  test.setTimeout(600_000);
  const h = await harnessOf(maws);
  const { tabId, id } = await h.addTerminal();
  await h.prompt(id);
  // A prompt without a clock or a duration, so `true` and the workload differ only by the workload's output.
  await h.run(id, 'exec /bin/bash --norc --noprofile');
  await sleep(800);
  await h.run(id, "PS1='$ '; clear");
  await h.idle(id, 800);

  await guarded(h, async () => {
    // `head -c` cuts the last fox line short, so each run's marker ends that line.
    const ends = (marker: string) =>
      expect
        .poll(async () => (await h.snap(id)).screen.some((line) => line.trimEnd().endsWith(marker) && !line.includes('echo')), { timeout: 120_000, message: `${marker} ends W1` })
        .toBe(true);
    const pausedSeen = () => h.call<boolean>('terminals', 'pausedSeen', id);

    // W1 with its tab shown. The renderer mostly keeps up, and the pty pauses in one to a few episodes of 10 to 35 ms
    // per run, which a sampler on a loaded machine can miss: recorded, not asserted.
    await h.run(id, `${FOX}; echo W1-$((6*7))`);
    await ends('W1-42');
    test.info().annotations.push({ type: 'pausedSeenVisible', description: String(await pausedSeen()) });
    await h.idle(id, 500);

    // W1 again with its tab hidden from its first byte: the Review tab is selected before the command is written to
    // the pty (through `pty.write`, which needs no focus), and a hidden terminal acknowledges at most 256 KiB per
    // 250 ms, so the host must pause the pty at the high watermark and hold it paused between ticks. Asserted after a
    // full second hidden.
    await h.call('terminals', 'resetPausedSeen', id); // this phase proves its own pause, not the visible run's
    expect(await pausedSeen()).toBe(false);
    await h.call('panel', 'selectTab', 'review');
    await expect.poll(async () => (await h.info(id))!.visible, { message: 'the terminal is hidden' }).toBe(false);
    await h.run(id, `${FOX}; echo W1-HIDDEN-$((6*7))`);
    await sleep(1_000);
    expect(await pausedSeen(), "W1's fox line pauses the pty at the high watermark").toBe(true);
    await h.call('panel', 'selectTab', tabId);
    await ends('W1-HIDDEN-42');
    await h.idle(id, 500);

    // The command is typed and its echo counted before Enter, so the delta is the output, the Enter's CR LF and the
    // next prompt.
    const measure = async (command: string, done: () => Promise<void>) => {
      await h.type(id, command);
      await h.idle(id, 500);
      const before = await h.counters(id);
      await h.type(id, '\r');
      await done();
      await h.idle(id, 1_000);
      const after = await h.counters(id);
      return { bytes: after.bytes - before.bytes, lineFeeds: after.lineFeeds - before.lineFeeds, carriageReturns: after.carriageReturns - before.carriageReturns };
    };
    const dTrue = await measure('true', async () => {});

    const ping = h.page.getByRole('button', { name: 'ping' });
    let clicks = 0;
    let pinging = true;
    const pinger = (async () => {
      while (pinging) {
        await ping.click();
        clicks++;
        await sleep(1_500);
      }
    })();
    const started = Date.now();
    const dW3 = await measure(W3, () =>
      expect
        .poll(
          async () => {
            const screen = (await h.snap(id)).screen.filter((line) => line.trim());
            return screen.includes('20000000') && screen.at(-1)!.startsWith('$');
          },
          { timeout: 540_000, intervals: [1_000], message: 'W3 ends' },
        )
        .toBe(true),
    );
    const seconds = (Date.now() - started) / 1000;
    pinging = false;
    await pinger;

    const outputBytes = dW3.bytes - dW3.carriageReturns - (dTrue.bytes - dTrue.carriageReturns);
    const lineFeeds = dW3.lineFeeds - dTrue.lineFeeds;
    const surplusCarriageReturns = dW3.carriageReturns - dTrue.carriageReturns - lineFeeds;
    const pings = await h.call<{ count: number; maxMs: number }>('terminals', 'pings');
    test.info().annotations.push(
      { type: 'W3', description: JSON.stringify({ seconds, mbps: Math.round((W3_OUTPUT_BYTES / seconds / 1e6) * 10) / 10, outputBytes, lineFeeds, surplusCarriageReturns, dTrue, dW3 }) },
      { type: 'pings', description: JSON.stringify({ clicks, ...pings }) },
    );
    expect(outputBytes, 'output bytes over `true`').toBe(W3_OUTPUT_BYTES);
    expect(lineFeeds, 'line feeds over `true`').toBe(W3_LINE_FEEDS);
    expect(surplusCarriageReturns).toBeGreaterThanOrEqual(0);

    const end = await h.snap(id);
    const output = end.screen.filter((line) => line.trim());
    expect(output.at(-2), 'the last line').toBe('20000000');
    expect(end.count).toBe(SCROLLBACK + end.rows);
    expect(pings.count, 'every Ping click registered').toBe(clicks);
    expect(clicks).toBeGreaterThan(0);
    expect(pings.maxMs, 'a click waits under 100 ms').toBeLessThan(100);
  });
});

test.skip("keeps Enter and Escape from the app's request handlers", { annotation: { type: 'skip', description: 'runs after the rebase over C5' } }, async ({ maws }) => {
  const h = await harnessOf(maws);
  const { page } = maws;
  const counts = () => h.call<{ accept: number; decline: number; tabNext: number }>('keys', 'counts');
  const { id } = await h.addTerminal();
  await h.prompt(id);

  await page.getByLabel('fake request card').focus();
  await page.keyboard.press('Enter');
  expect(await counts()).toMatchObject({ accept: 1, decline: 0 });

  await h.run(id, 'cat -v');
  await sleep(300);
  await page.locator(`[data-terminal-id="${id}"] textarea`).focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await h.lines(id)).filter((line) => line.trim() === '^[').length, { message: 'the echo and cat’s line' }).toBe(2);
  expect(await counts()).toMatchObject({ accept: 1, decline: 0 });

  await page.keyboard.press('Control+Tab');
  expect((await counts()).tabNext).toBe(1);
  await h.type(id, '\x03');
});

test('copies a selection and opens links externally', async ({ maws }) => {
  const h = await harnessOf(maws);
  const { app, page } = maws;
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as { __opened?: string[] }).__opened = opened;
    shell.openExternal = async (url: string) => void opened.push(url);
  });
  const opened = () => app.evaluate(() => [...((globalThis as { __opened?: string[] }).__opened ?? [])]);
  const { id } = await h.addTerminal();
  await h.prompt(id);

  // Two wrapped rows, selected by a drag, copied with ⌘C, pasted into the page's text field.
  await h.run(id, `clear; printf '%s\\n' "$(printf 'wrap%.0s' $(seq 1 60))"`);
  await h.idle(id);
  const wrapped = await h.snap(id);
  const row = wrapped.screen.findIndex((line) => line.startsWith('wrapwrap'));
  expect(row).toBeGreaterThanOrEqual(0);
  const from = await h.cellPoint(id, 2, row);
  const to = await h.cellPoint(id, 20, row + 1);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  const selection = await h.call<string>('terminals', 'selection', id);
  expect(selection.length, 'the selection spans two rows').toBeGreaterThan(wrapped.cols);
  await page.keyboard.press('Meta+KeyC');
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(selection);
  await page.getByLabel('paste target').click();
  await page.keyboard.press('Meta+KeyV');
  await expect(page.getByLabel('paste target')).toHaveValue(selection);

  // ⌘V into the shell pastes (bracketed, as zsh asks), and Enter runs it.
  await app.evaluate(({ clipboard }) => clipboard.writeText('echo PASTED-$((6*7))'));
  await page.locator(`[data-terminal-id="${id}"] .xterm-screen`).click();
  await page.keyboard.press('Meta+KeyV');
  await expect.poll(async () => (await h.snap(id)).screen.some((line) => line.includes('echo PASTED-$((6*7))'))).toBe(true);
  await h.type(id, '\r');
  await h.expectLine(id, 'PASTED-42');

  // An OSC 8 link and a bare URL: a plain click opens nothing, a ⌘-click opens each through main.
  await h.run(id, `clear; printf '\\e]8;;https://example.com\\e\\\\example\\e]8;;\\e\\\\\\n'; printf 'https://example.org\\n'`);
  await h.idle(id);
  const screen = (await h.snap(id)).screen;
  const osc8Row = screen.findIndex((line) => line.trim() === 'example');
  const bareRow = screen.findIndex((line) => line.trim() === 'https://example.org');
  expect([osc8Row, bareRow].every((r) => r >= 0)).toBe(true);
  const click = async (row: number, col: number, meta: boolean) => {
    const point = await h.cellPoint(id, col, row);
    await page.mouse.move(point.x - 3, point.y);
    await page.mouse.move(point.x, point.y); // the link provider needs a hover before the click
    await sleep(200);
    if (meta) await page.keyboard.down('Meta');
    await page.mouse.click(point.x, point.y);
    if (meta) await page.keyboard.up('Meta');
    await sleep(300);
  };
  await click(osc8Row, 2, false);
  await click(bareRow, 4, false);
  expect(await opened(), 'a plain click opens nothing').toEqual([]);
  await click(osc8Row, 2, true);
  await expect.poll(opened).toEqual(['https://example.com']);
  await click(bareRow, 4, true);
  await expect.poll(opened).toEqual(['https://example.com', 'https://example.org']);
});

test('recolours on theme change without literals', async ({ maws }) => {
  const h = await harnessOf(maws);
  const { app, page } = maws;
  const { id } = await h.addTerminal();
  await h.prompt(id);
  await guarded(h, async () => {
    await h.run(id, `clear; printf 'RB\\e[41m    \\e[44m    \\e[0m\\n'`);
    await h.idle(id);
  });
  const row = (await h.snap(id)).screen.findIndex((line) => line.trimEnd() === 'RB');
  expect(row).toBeGreaterThanOrEqual(0);

  // The pixels the terminal drew in a red-background cell, a blue-background cell and an empty cell, against the
  // current theme's `--term-*` tokens.
  const sample = async () => {
    const points = { red: await h.cellPoint(id, 3, row), blue: await h.cellPoint(id, 7, row), background: await h.cellPoint(id, 20, row + 2) };
    const drawn: Record<string, number[]> = {};
    for (const [name, point] of Object.entries(points)) {
      drawn[name] = await app.evaluate(async ({ BrowserWindow }, { x, y }) => {
        const image = await BrowserWindow.getAllWindows()[0]!.webContents.capturePage({ x: Math.round(x), y: Math.round(y), width: 1, height: 1 });
        const bgra = image.toBitmap();
        return [bgra[2]!, bgra[1]!, bgra[0]!];
      }, point);
    }
    // Each token resolved by the page's own CSS (a probe element coloured `var(--token)`).
    const tokens = await page.evaluate(() => {
      const rgb = (name: string) => {
        const probe = document.createElement('span');
        probe.style.color = `var(${name})`;
        document.body.append(probe);
        const channels = getComputedStyle(probe).color.match(/\d+/g)!.slice(0, 3).map(Number);
        probe.remove();
        return channels;
      };
      return { theme: document.documentElement.dataset.theme, red: rgb('--term-ansi-red'), blue: rgb('--term-ansi-blue'), background: rgb('--term-bg') };
    });
    return { drawn, tokens };
  };
  const close = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]!) <= 3);
  const matches = (s: Awaited<ReturnType<typeof sample>>) => ['red', 'blue', 'background'].every((name) => close(s.drawn[name]!, s.tokens[name as 'red']));

  const light = await sample();
  expect(light.tokens.theme).toBe('light');
  expect(matches(light), `light: ${JSON.stringify(light)}`).toBe(true);

  await page.getByRole('button', { name: /^theme:/ }).click();
  await expect.poll(async () => matches(await sample()), { timeout: 5_000, message: 'recoloured to the dark tokens' }).toBe(true);
  const dark = await sample();
  expect(dark.tokens.theme).toBe('dark');
  expect(close(dark.drawn.background!, light.drawn.background!), 'the background changed').toBe(false);
  expect(close(dark.drawn.red!, light.drawn.red!), 'ANSI red changed').toBe(false);

  await page.getByRole('button', { name: /^theme:/ }).click();
  await expect.poll(async () => matches(await sample()), { timeout: 5_000, message: 'back to the light tokens' }).toBe(true);
  expect(await h.info(id), 'no reload: the same terminal').toMatchObject({ status: 'running' });
  expect(maws.consoleErrors(), 'no CSP refusal or other console error').toEqual([]);
});

test('falls back to the DOM renderer on context loss and returns to WebGL on next show', async ({ maws }) => {
  const h = await harnessOf(maws);
  const { tabId, id } = await h.addTerminal();
  await h.prompt(id);
  await guarded(h, async () => {
    await h.run(id, 'echo BEFORE-LOSS-$((6*7))');
    await h.expectLine(id, 'BEFORE-LOSS-42');
    expect((await h.info(id))!.acceleration).toBe('webgl');

    const lostAt = Date.now();
    await h.call('terminals', 'simulateContextLoss', id);
    await expect.poll(async () => (await h.info(id))!.acceleration, { timeout: 4_000, intervals: [50] }).toBe('dom');
    test.info().annotations.push({ type: 'domAfterMs', description: String(Date.now() - lostAt) });
    expect(await h.hasLine(id, 'BEFORE-LOSS-42'), 'the buffer is intact').toBe(true);
    await h.run(id, 'echo AFTER-LOSS-$((6*7))');
    await h.expectLine(id, 'AFTER-LOSS-42');

    await h.call('panel', 'selectTab', 'review');
    await h.call('panel', 'selectTab', tabId);
    await expect.poll(async () => (await h.info(id))!.acceleration, { timeout: 3_000 }).toBe('webgl');
  });
});

test('openTerminal runs the attach command', async ({ maws }) => {
  const h = await harnessOf(maws);
  const { page } = maws;
  const { A, B } = await h.sessions();
  const openTerminal = (appSessionId: string, cwd: string, command: string) =>
    page.evaluate(
      ([appSessionId, cwd, command]) =>
        (window as unknown as { openTerminal(init: { appSessionId: string; cwd: string; command: string }): string }).openTerminal({ appSessionId, cwd, command }),
      [appSessionId, cwd, command] as const,
    );
  // Quoted: unquoted, the shell reads `\n` as `n` and the line would end `MAWS_ATTACH_OKn` with no newline.
  const attach = async (marker: string): Promise<{ id: TerminalId; ms: number }> => {
    const opened = Date.now();
    const tabId = await openTerminal(A, DIR_A, `printf '${marker}\\n'`);
    const tab = (await h.tabs()).find((t) => t.id === tabId)!;
    expect(tab).toMatchObject({ toolId: 'terminal', selected: true });
    await untilLine(h, tab.terminalId!, marker);
    const ms = Date.now() - opened;
    await expect
      .poll(async () => {
        const lines = await h.lines(tab.terminalId!);
        const at = lines.findIndex((line) => line.trim() === marker);
        return lines.slice(at + 1).some((line) => line.trim() !== '');
      }, { message: 'a prompt after it' })
      .toBe(true);
    return { id: tab.terminalId!, ms };
  };
  // As in the first test: the first attach after launch within three seconds (logged), one in the running app within two.
  await hostReady(h);
  const cold = await attach('MAWS_ATTACH_OK');
  test.info().annotations.push({ type: 'coldAttachMs', description: String(cold.ms) });
  expect(cold.ms, 'the first attach after launch runs within three seconds').toBeLessThanOrEqual(3_000);
  const warm = await attach('MAWS_ATTACH_AGAIN');
  test.info().annotations.push({ type: 'attachMs', description: String(warm.ms) });
  expect(warm.ms, 'the attach command runs within two seconds').toBeLessThanOrEqual(2_000);

  // For a session other than the one shown: the panel shows that session, with the new tab selected and visible.
  expect(await h.call<string>('panel', 'session')).toBe(A);
  const otherTabId = await openTerminal(B, DIR_B, "printf 'MAWS_ATTACH_B\\n'");
  expect(await h.call<string>('panel', 'session'), 'the panel switched to the tab’s session').toBe(B);
  await expect(page.getByRole('group', { name: 'session' }).getByRole('button', { name: 'Session B' })).toHaveAttribute('aria-pressed', 'true');
  await expect(h.tab(otherTabId)).toBeVisible();
  await expect(h.tab(otherTabId)).toHaveAttribute('aria-selected', 'true');
  const other = (await h.tabs()).find((t) => t.id === otherTabId)!;
  await expect(page.locator(`[data-terminal-id="${other.terminalId}"]`), 'its terminal is mounted on screen').toBeVisible();
  await h.expectLine(other.terminalId!, 'MAWS_ATTACH_B', 5_000);
  expect(await h.info(other.terminalId!)).toMatchObject({ cwd: DIR_B, visible: true });
});
