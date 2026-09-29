// C8a's panel host end to end (C8a execution document, acceptance item 2), run by `pnpm e2e:panel` over the harness
// build. The first case runs the product app, not the harness (`MAWS_HARNESS=0`, since `pnpm e2e:panel` runs under
// MAWS_HARNESS=1 and a launch inherits the runner's environment); the harness cases (M3's persistence and pin cases
// below; M4 adds the summary, R7 and scenario cases) run the `#panel` page. Both run over the harness scenario's two
// sessions (ruling O1), so that main's read model knows A and B, accepts their panel keys, and a Terminal tab has a
// directory to start in.
import { mkdirSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import type { PanelHarnessApi, PanelHarnessTab } from '../src/renderer/src/harness/panel/api';
import { launchMaws, test, type MawsLaunch } from './support/launch';

const DIR_A = '/tmp/maws-harness/a'; // session A's directory in the harness scenario
const SCENARIO = 'stub:test/fixtures/panel/harness-sessions.json';
test.use({ mawsEnv: { MAWS_HARNESS: '0', MAWS_SESSION_SOURCE: SCENARIO, MAWS_SCENARIO_CLOCK: 'manual' } });
test.beforeAll(() => mkdirSync(DIR_A, { recursive: true }));

interface Pty {
  label: string;
  appSessionId: string;
  pid: number;
  alive: boolean;
  offset: number;
}

const ptys = (page: Page) =>
  page.evaluate(async () => {
    const result = await window.maws.invoke('pty.list', undefined);
    return (result.ok ? result.value.ptys : []) as unknown as Pty[];
  });

const panelA = (page: Page) =>
  page.evaluate(async () => {
    const result = await window.maws.invoke('layout.get', { key: 'panel.A' });
    return result.ok ? (result.value.value as { tabs: { id: string }[] } | null) : null;
  });

// C8a's ruling on the product's pty adoption (2026-09-29): after a renderer reload the restored Terminal tab reattaches
// to the shell that kept running in the PTY host, and no second shell is started under its label.
test('a restored Terminal tab reattaches to its running shell after a renderer reload', async ({ maws }) => {
  const { page } = maws;
  const panel = page.locator('[data-region="panel"]');
  await page.locator('[data-region="sidebar"]').getByRole('treeitem', { name: 'Harness A' }).click();
  await panel.getByRole('button', { name: 'Add a tool' }).click();
  await page.getByRole('menuitem', { name: 'Terminal' }).click();

  const shellsOfA = async () => (await ptys(page)).filter((pty) => pty.appSessionId === 'A' && pty.alive);
  await expect.poll(shellsOfA, { timeout: 15_000, message: 'a shell for session A' }).toHaveLength(1);
  const [{ label, pid }] = await shellsOfA();
  await expect(panel.locator(`[data-tab-id="${label}"]`)).toBeVisible();
  // The tab reaches layout.json (C5's 250 ms write), so the reload restores it.
  await expect.poll(async () => (await panelA(page))?.tabs.map((tab) => tab.id) ?? []).toContain(label);

  await page.reload();
  await expect(panel.locator(`[data-tab-id="${label}"]`)).toBeVisible({ timeout: 15_000 });
  const terminal = panel.locator('[data-terminal-id]');
  await expect(terminal).toBeVisible({ timeout: 15_000 });

  // Reattached, not failed: without the re-adoption the tab asks the PTY host for a new shell under its label, which
  // the host refuses (the old one still runs), and the tab shows the failure in its status bar.
  await expect(panel.getByRole('status', { name: 'terminal status' })).toHaveCount(0);
  // Keys typed into the restored tab reach the same shell: its pty echoes the command and prints its result.
  const command = 'echo PANEL-RELOAD-$((6*7))';
  const before = (await ptys(page)).find((pty) => pty.label === label)!.offset;
  await terminal.locator('.xterm-screen').click();
  await page.keyboard.type(command);
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => ((await ptys(page)).find((pty) => pty.label === label)?.offset ?? 0) - before, { message: 'the shell echoes and answers' })
    .toBeGreaterThanOrEqual(command.length + 'PANEL-RELOAD-42'.length);

  const after = (await ptys(page)).filter((pty) => pty.label === label);
  expect(after, 'one pty under the tab’s label').toHaveLength(1);
  expect(after[0]).toMatchObject({ pid, alive: true });
  expect((await ptys(page)).filter((pty) => pty.appSessionId === 'A'), 'no second shell for the session').toHaveLength(1);
  expect(maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
});

// ---- the #panel harness: persistence and pins under reload and session switch (M3) ----------------------------------------

const HARNESS_ENV = { MAWS_HARNESS: '1', MAWS_SESSION_SOURCE: SCENARIO };

type PanelWindow = { __maws_harness?: { page?: string; panel?: PanelHarnessApi } };
type Method = { [M in keyof PanelHarnessApi]: PanelHarnessApi[M] extends (...args: never[]) => unknown ? M : never }[keyof PanelHarnessApi];
type StubProbe = ReturnType<PanelHarnessApi['stub']>;
interface PanelSession {
  tabs: { id: string; toolId: string; pinned: boolean }[];
  activeTabId: string | null;
}

// The `#panel` page driven through `window.__maws_harness.panel`, and the profile's layout.json through `layout.get`.
class PanelPage {
  constructor(readonly maws: MawsLaunch) {}

  get page(): Page {
    return this.maws.page;
  }
  get region() {
    return this.page.locator('[data-region="panel"]');
  }
  get stubLine() {
    return this.region.getByTestId('stub-line'); // the selected stub tab's body line
  }

  // The window opens on the harness entry's default page; `#panel` is a hash route whose page assigns
  // `window.__maws_harness.panel` on mount. `ready()` resolves once the layout store has read layout.json.
  static async open(maws: MawsLaunch): Promise<PanelPage> {
    const panel = new PanelPage(maws);
    await panel.page.waitForFunction(() => (window as unknown as PanelWindow).__maws_harness !== undefined, null, { timeout: 15_000 });
    await panel.page.evaluate(() => (location.hash = '#panel'));
    await panel.page.waitForFunction(() => (window as unknown as PanelWindow).__maws_harness?.page === 'panel', null, { timeout: 15_000 });
    await panel.call('ready');
    await panel.call('hydrated');
    return panel;
  }

  call<M extends Method>(method: M, ...args: Parameters<PanelHarnessApi[M]>): Promise<Awaited<ReturnType<PanelHarnessApi[M]>>> {
    return this.page.evaluate(
      ([method, args]) => ((window as unknown as PanelWindow).__maws_harness!.panel![method] as (...a: unknown[]) => unknown)(...args),
      [method, args] as const,
    ) as Promise<Awaited<ReturnType<PanelHarnessApi[M]>>>;
  }

  stub<M extends keyof StubProbe>(toolId: string, method: M): Promise<ReturnType<StubProbe[M]>> {
    return this.page.evaluate(
      ([toolId, method]) => ((window as unknown as PanelWindow).__maws_harness!.panel!.stub(toolId)[method] as () => unknown)(),
      [toolId, method] as const,
    ) as Promise<ReturnType<StubProbe[M]>>;
  }

  tabs = (): Promise<PanelHarnessTab[]> => this.call('tabs');
  ids = async (): Promise<string[]> => (await this.tabs()).map((tab) => tab.id);
  active = async (): Promise<string | null> => (await this.tabs()).find((tab) => tab.active)?.id ?? null;

  // A key of the profile's layout.json as main holds it (every renderer key is written to the file at once).
  layout<T = unknown>(key: string): Promise<T | null> {
    return this.page.evaluate(async (key) => {
      const result = await window.maws.invoke('layout.get', { key: key as 'regions' });
      return result.ok ? (result.value.value as never) : null;
    }, key);
  }
  panelOf = (id: 'A' | 'B') => this.layout<PanelSession>(`panel.${id}`);
  // The session the relaunch will show: the focused pane's active tab in layout.json's main.tabs.
  async shownOnDisk(): Promise<string | null> {
    const main = await this.layout<{ panes: { activeTabId: string | null }[]; focusedPane: number }>('main.tabs');
    return main?.panes[main.focusedPane]?.activeTabId ?? null;
  }

  expectQuietConsole(): void {
    expect(this.maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
  }
}

// One profile across relaunches: `launch()` closes the previous launch, if any, and opens the harness over the same
// `userData`; every launch is cleaned up and the profile removed at the end.
async function withProfile(body: (launch: () => Promise<PanelPage>) => Promise<void>): Promise<void> {
  const launches: MawsLaunch[] = [];
  const launch = async () => {
    const previous = launches.at(-1);
    if (previous) await previous.app.close();
    const maws = await launchMaws({ env: HARNESS_ENV, userData: launches[0]?.userData });
    launches.push(maws);
    return PanelPage.open(maws);
  };
  try {
    await body(launch);
  } finally {
    for (const maws of launches.reverse()) await maws.cleanup(); // the first launch created the profile and removes it
  }
}

test.describe('the #panel harness: persistence and pins', () => {
  test.use({ mawsEnv: HARNESS_ENV });

  test('a pinned tab shows first for every session and unpins into the session’s list', async ({ maws }) => {
    const panel = await PanelPage.open(maws);
    expect(await panel.call('session')).toBe('A');
    const stub = await panel.call('addTool', 'harness-stub');
    await panel.call('pin', stub);
    expect(await panel.tabs()).toEqual([expect.objectContaining({ id: stub, pinned: true, active: true })]);
    await expect(panel.stubLine).toContainText(`${stub} · A · pinned · visible`);

    await panel.call('switchSession', 'B');
    // B holds no selection of its own yet (C5's rule), so its strip shows the pin first above the summary; selected in
    // B, the same instance's context reads B.
    expect(await panel.tabs()).toEqual([expect.objectContaining({ id: stub, pinned: true, active: false })]);
    await panel.call('selectTab', stub);
    await expect(panel.stubLine).toContainText(`${stub} · B · pinned · visible`);

    await panel.call('pin', stub); // unpinned in B: the tab moves into B's own list
    expect(await panel.tabs()).toEqual([expect.objectContaining({ id: stub, pinned: false, active: true })]);
    await expect(panel.stubLine).toContainText(`${stub} · B · unpinned · visible`);
    await panel.call('switchSession', 'A');
    expect(await panel.ids()).toEqual([]);
    expect(await panel.stub('harness-stub', 'instances'), 'one instance throughout').toEqual([stub]);

    await expect.poll(() => panel.layout('panel.pinned')).toEqual([]);
    await expect.poll(() => panel.panelOf('B')).toEqual({ tabs: [{ id: stub, toolId: 'harness-stub', pinned: false }], activeTabId: stub });
    panel.expectQuietConsole();
  });

  test('addTool targets a session that is not shown', async ({ maws }) => {
    const panel = await PanelPage.open(maws);
    await panel.call('switchSession', 'B');
    const before = await panel.tabs();
    const quiet = await panel.call('addTool', 'harness-stub', { appSessionId: 'A', activate: false });
    expect(await panel.call('session'), 'nothing switched').toBe('B');
    expect(await panel.tabs(), 'B’s strip is unchanged').toEqual(before);
    await panel.call('switchSession', 'A');
    expect(await panel.tabs()).toEqual([expect.objectContaining({ id: quiet, active: false })]);

    await panel.call('switchSession', 'B');
    const loud = await panel.call('addTool', 'harness-stub', { appSessionId: 'A' });
    expect(await panel.call('session'), 'the main area switched to A').toBe('A');
    expect(await panel.active()).toBe(loud);
    await expect(panel.stubLine).toContainText(`${loud} · A · unpinned · visible`);
    await expect.poll(() => panel.panelOf('A')).toEqual({
      tabs: [quiet, loud].map((id) => ({ id, toolId: 'harness-stub', pinned: false })),
      activeTabId: loud,
    });
    expect(await panel.panelOf('B'), 'B gained no list').toBeNull();
    panel.expectQuietConsole();
  });

  test('a restored singleton never shown is instantiated before it is re-targeted', async () => {
    await withProfile(async (launch) => {
      let panel = await launch();
      const info = await panel.call('addTool', 'session-info'); // in A, shown
      await panel.call('switchSession', 'B'); // so B is what the relaunch shows
      await expect.poll(() => panel.panelOf('A')).toEqual({ tabs: [{ id: info, toolId: 'session-info', pinned: false }], activeTabId: info });
      await expect.poll(() => panel.shownOnDisk()).toBe('session:B');
      panel.expectQuietConsole();

      for (const activate of [false, undefined]) {
        panel = await launch();
        expect(await panel.call('session')).toBe('B');
        const strip = await panel.tabs();
        expect(await panel.stub('session-info', 'instances'), 'A was never shown: its tab has no instance').toEqual([]);
        const opts = activate === false ? { appSessionId: 'A' as const, activate } : { appSessionId: 'A' as const };
        expect(await panel.call('addTool', 'session-info', opts), 'the restored tab is re-targeted').toBe(info);
        expect(await panel.stub('session-info', 'instances')).toEqual([info]);
        expect(await panel.stub('session-info', 'opens')).toBe(1);
        if (activate === false) {
          expect(await panel.call('session')).toBe('B');
          expect(await panel.tabs(), 'B’s strip is unchanged').toEqual(strip);
          expect((await panel.panelOf('A'))?.tabs.filter((tab) => tab.toolId === 'session-info')).toHaveLength(1);
        } else {
          expect(await panel.call('session'), 'the main area switched to A').toBe('A');
          expect(await panel.active()).toBe(info);
          await expect(panel.stubLine).toContainText(`${info} · A · unpinned · visible`);
          expect(await panel.stub('session-info', 'instances'), 'showing A created no second instance').toEqual([info]);
        }
        panel.expectQuietConsole();
      }
    });
  });

  test('closing, unregistering or unpinning a selected pin repairs every session’s selection', async ({ maws }) => {
    const panel = await PanelPage.open(maws);
    // A pin selected in A (shown) and in B, with A shown again.
    const selectedInBoth = async (id: string) => {
      await panel.call('selectTab', id);
      await panel.call('switchSession', 'B');
      await panel.call('selectTab', id);
      await panel.call('switchSession', 'A');
    };
    // B's selection after the pin left, in the harness and in layout.json.
    const expectB = async (expected: string | null) => {
      await panel.call('switchSession', 'B');
      const tabs = await panel.tabs();
      expect(await panel.active()).toBe(expected);
      if (expected === null) await expect(panel.region.getByRole('tabpanel', { name: 'Session overview' })).toBeVisible();
      else expect(tabs.map((tab) => tab.id), 'never a missing id').toContain(expected);
      await expect.poll(async () => (await panel.panelOf('B'))?.activeTabId).toBe(expected);
      await panel.call('switchSession', 'A');
    };

    const first = await panel.call('addTool', 'harness-stub', { pin: true });
    const info = await panel.call('addTool', 'session-info', { pin: true });
    await selectedInBoth(first);
    await test.step('close: B falls to the next pin to the right', async () => {
      expect(await panel.call('closeTab', first)).toBe(true);
      await expectB(info);
    });

    const second = await panel.call('addTool', 'harness-stub', { pin: true }); // the pins: Session info, second
    await selectedInBoth(second);
    await test.step('unpin in A: B falls to the last pin', async () => {
      await panel.call('pin', second);
      expect((await panel.tabs()).find((tab) => tab.id === second)).toMatchObject({ pinned: false }); // A's own tab now
      await expectB(info);
    });

    const third = await panel.call('addTool', 'harness-stub', { pin: true });
    await selectedInBoth(third);
    expect(await panel.call('closeTab', info)).toBe(true); // B is on the third pin, so its selection stays
    await test.step('unregister: with no pin left, B falls to the summary', async () => {
      await panel.stub('harness-stub', 'unregister');
      await expect.poll(() => panel.layout('panel.pinned')).toEqual([]);
      expect(await panel.ids(), 'A’s own stub tab closed too').toEqual([]);
      await expectB(null);
    });
    panel.expectQuietConsole();
  });

  test('pins and session tabs round-trip a relaunch and log tabs do not', async () => {
    // Home and back, a switch to B and back, collapse and reopen: the log tabs and their instances stay.
    const roundTrip = async (panel: PanelPage, logs: string[]) => {
      const instances = await panel.stub('log', 'instances');
      await panel.call('showSummary');
      await panel.call('selectTab', logs[0]);
      await panel.call('switchSession', 'B');
      await panel.call('switchSession', 'A');
      await panel.call('collapse', true);
      await panel.call('collapse', false);
      expect(await panel.ids()).toEqual(expect.arrayContaining(logs));
      expect(await panel.stub('log', 'instances')).toEqual(instances);
      expect(instances).toEqual(expect.arrayContaining(logs));
    };

    await withProfile(async (launch) => {
      let panel = await launch();
      const pin = await panel.call('addTool', 'harness-stub', { pin: true });
      const info = await panel.call('addTool', 'session-info');
      const logs = [await panel.call('addTool', 'log'), await panel.call('addTool', 'log')];
      await roundTrip(panel, logs);
      // layout.json holds the log refs, so the relaunch has restored ones to drop.
      await expect.poll(async () => (await panel.panelOf('A'))?.tabs.map((tab) => tab.id)).toEqual([info, ...logs]);
      await expect.poll(() => panel.layout('panel.pinned')).toEqual([{ id: pin, toolId: 'harness-stub', pinned: true }]);
      await expect.poll(() => panel.shownOnDisk()).toBe('session:A');
      panel.expectQuietConsole();

      panel = await launch();
      expect(await panel.call('session')).toBe('A');
      expect(await panel.ids(), 'the pin first, A’s Session info back, no log tab').toEqual([pin, info]);
      await expect.poll(async () => (await panel.panelOf('A'))?.tabs.map((tab) => tab.id), 'no log ref left in layout.json').toEqual([info]);
      expect(await panel.layout('panel.pinned')).toEqual([{ id: pin, toolId: 'harness-stub', pinned: true }]);
      const keys = await panel.page.evaluate(async () => {
        const result = await window.maws.invoke('layout.list', undefined);
        return result.ok ? result.value.keys : [];
      });
      test.info().annotations.push({ type: 'layout.json keys after the relaunch', description: [...keys].sort().join(', ') });
      expect(keys).toEqual(expect.arrayContaining(['regions', 'main.tabs', 'panel.pinned', 'panel.A', 'window.main']));
      await panel.call('switchSession', 'B');
      expect((await panel.ids())[0], 'the pin is first in B too, under the same id').toBe(pin);
      await panel.call('switchSession', 'A');

      const fresh = await panel.call('addTool', 'log'); // opened after the relaunch: an ordinary tab until closed
      await roundTrip(panel, [fresh]);
      expect(await panel.ids()).toEqual([pin, info, fresh]);
      panel.expectQuietConsole();
    });
  });

  test('Overview keeps the pin selection', async ({ maws }) => {
    const panel = await PanelPage.open(maws);
    const first = await panel.call('addTool', 'harness-stub', { pin: true });
    const second = await panel.call('addTool', 'session-info', { pin: true });
    await panel.call('switchSession', null);
    expect(await panel.call('session')).toBeNull();
    await expect(panel.region.getByRole('button', { name: 'Open a session to add a tool' })).toBeDisabled();

    await panel.call('showSummary'); // the summary with no session: the footer alone, the pins still in the strip
    await expect(panel.region.getByText('Tools stay with this session. Pin a tab to keep it with you as you switch.')).toBeVisible();
    expect(await panel.ids()).toEqual([first, second]);
    expect(await panel.active()).toBeNull();

    await panel.call('selectTab', second);
    await expect(panel.stubLine).toContainText(`${second} · no session · pinned · visible`);
    await panel.call('switchSession', 'A');
    await panel.call('switchSession', null);
    expect(await panel.active()).toBe(second);
    await expect(panel.region.locator(`[data-tab-id="${second}"] [role="tab"]`)).toHaveAttribute('aria-selected', 'true');
    await expect(panel.stubLine).toContainText(`${second} · no session · pinned · visible`);
    panel.expectQuietConsole();
  });
});
