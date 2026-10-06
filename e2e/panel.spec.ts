// C8a's panel host end to end (C8a execution document, acceptance item 2), run by `pnpm e2e:panel` over the harness
// build. The first case runs the product app, not the harness (`MAWS_HARNESS=0`, since `pnpm e2e:panel` runs under
// MAWS_HARNESS=1 and a launch inherits the runner's environment); the harness cases (M3's persistence and pin cases,
// M4's strip, summary, R7, theme and side-column Terminal cases) run the `#panel` page, over the harness scenario's two
// sessions (ruling O1), so that main's read model knows A and B, accepts their panel keys, and a Terminal tab has a
// directory to start in. The last two cases run the product over a scenario derived from C5's nine-sessions.json.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import type { PanelChildMetrics, PanelHarnessApi, PanelHarnessTab } from '../src/renderer/src/harness/panel/api';
import { PANEL_CHILD_TAIL } from '../test/support/panel-child-tail';
import { withNativeClipboard } from './support/clipboard';
import { launchMaws, test, type MawsLaunch } from './support/launch';
import { sidebarRow } from './support/sidebar';
import { CHARTER, otherThemeColours, panelScenario, scratchRepository, SIDEBAR_DRAG } from './support/panel-support';

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
  await (await sidebarRow(page, 'Harness A')).click();
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

  // M4: the R7 probes, `window.__maws_harness.panel.child`.
  child<M extends keyof PanelHarnessApi['child']>(method: M, ...args: Parameters<PanelHarnessApi['child'][M]>): Promise<Awaited<ReturnType<PanelHarnessApi['child'][M]>>> {
    return this.page.evaluate(
      ([method, args]) => ((window as unknown as PanelWindow).__maws_harness!.panel!.child[method] as (...a: unknown[]) => unknown)(...args),
      [method, args] as const,
    ) as Promise<Awaited<ReturnType<PanelHarnessApi['child'][M]>>>;
  }
  metrics = (): Promise<PanelChildMetrics> => this.child('metrics');

  // M4: the strip and the summary as a reader finds them.
  tab = (id: string) => this.region.locator(`[data-tab-id="${id}"]`);
  get summary() {
    return this.region.getByRole('tabpanel', { name: 'Session overview' });
  }
  section = (name: 'Environment' | 'Push state' | 'Subagents' | 'Background work' | 'Sources') => this.summary.getByRole('region', { name });
  get changeLine() {
    return this.summary.getByTestId('change-line');
  }
  // The Sources rows, top to bottom: a file row by its path, a web row by its URL, an MCP row by its text.
  sources = (): Promise<string[]> =>
    this.section('Sources')
      .locator('li')
      .evaluateAll((items) => items.map((li) => li.querySelector('button')?.title ?? `mcp: ${li.textContent ?? ''}`));
  // The Subagents glyph line (its label names the agents, its text is the glyphs), or null when none is drawn.
  glyphLine = async (): Promise<string | null> => {
    const line = this.section('Subagents').getByTestId('agent-glyphs');
    return (await line.count()) === 0 ? null : `${await line.getAttribute('aria-label')} ${await line.textContent()}`;
  };

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
  // The session the relaunch will show: the focused pane's active tab in layout.json's main.tabs (W12: in the strip's
  // tab set, `current`).
  async shownOnDisk(): Promise<string | null> {
    const main = await this.layout<{ current: string; sets: Record<string, { panes: { activeTabId: string | null }[]; focusedPane: number }> }>('main.tabs');
    const shown = main?.sets[main.current];
    return shown?.panes[shown.focusedPane]?.activeTabId ?? null;
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
    // B's own tab, opened before the pin exists, so the pin comes first in B's strip only by the pin rule.
    const own = await panel.call('addTool', 'harness-stub', { appSessionId: 'B', activate: false });
    const stub = await panel.call('addTool', 'harness-stub');
    await panel.call('pin', stub);
    expect(await panel.tabs()).toEqual([expect.objectContaining({ id: stub, pinned: true, active: true })]);
    await expect(panel.stubLine).toContainText(`${stub} · A · pinned · visible`);

    await panel.call('switchSession', 'B');
    // B holds no selection of its own yet (C5's rule), so its strip shows the pin first, then B's own tab, above the
    // summary; selected in B, the same instance's context reads B.
    expect(await panel.ids()).toEqual([stub, own]);
    expect(await panel.tabs()).toEqual([
      expect.objectContaining({ id: stub, pinned: true, active: false }),
      expect.objectContaining({ id: own, pinned: false, active: false }),
    ]);
    await panel.call('selectTab', stub);
    await expect(panel.stubLine).toContainText(`${stub} · B · pinned · visible`);

    await panel.call('pin', stub); // unpinned in B: the tab moves into B's own list, after B's tab
    expect(await panel.tabs()).toEqual([
      expect.objectContaining({ id: own, pinned: false, active: false }),
      expect.objectContaining({ id: stub, pinned: false, active: true }),
    ]);
    await expect(panel.stubLine).toContainText(`${stub} · B · unpinned · visible`);
    await panel.call('switchSession', 'A');
    expect(await panel.ids()).toEqual([]);
    expect(await panel.stub('harness-stub', 'instances'), 'one instance per tab throughout').toEqual([own, stub]);

    await expect.poll(() => panel.layout('panel.pinned')).toEqual([]);
    await expect.poll(() => panel.panelOf('B')).toEqual({
      tabs: [own, stub].map((id) => ({ id, toolId: 'harness-stub', pinned: false })),
      activeTabId: stub,
    });
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

  // C11: the single-instance stand-in is `harness-single` now that Session info is C11's real tool on this page
  test('a restored singleton never shown is instantiated before it is re-targeted', async () => {
    await withProfile(async (launch) => {
      let panel = await launch();
      const info = await panel.call('addTool', 'harness-single'); // in A, shown
      await panel.call('switchSession', 'B'); // so B is what the relaunch shows
      await expect.poll(() => panel.panelOf('A')).toEqual({ tabs: [{ id: info, toolId: 'harness-single', pinned: false }], activeTabId: info });
      await expect.poll(() => panel.shownOnDisk()).toBe('session:B');
      panel.expectQuietConsole();

      for (const activate of [false, undefined]) {
        panel = await launch();
        expect(await panel.call('session')).toBe('B');
        const strip = await panel.tabs();
        expect(await panel.stub('harness-single', 'instances'), 'A was never shown: its tab has no instance').toEqual([]);
        const opts = activate === false ? { appSessionId: 'A' as const, activate } : { appSessionId: 'A' as const };
        expect(await panel.call('addTool', 'harness-single', opts), 'the restored tab is re-targeted').toBe(info);
        expect(await panel.stub('harness-single', 'instances')).toEqual([info]);
        expect(await panel.stub('harness-single', 'opens')).toBe(1);
        if (activate === false) {
          expect(await panel.call('session')).toBe('B');
          expect(await panel.tabs(), 'B’s strip is unchanged').toEqual(strip);
          expect((await panel.panelOf('A'))?.tabs.filter((tab) => tab.toolId === 'harness-single')).toHaveLength(1);
        } else {
          expect(await panel.call('session'), 'the main area switched to A').toBe('A');
          expect(await panel.active()).toBe(info);
          await expect(panel.stubLine).toContainText(`${info} · A · unpinned · visible`);
          expect(await panel.stub('harness-single', 'instances'), 'showing A created no second instance').toEqual([info]);
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
      // On disk before anything else changes B: persistence's 250 ms debounce would otherwise replace this write
      // with the next one, and a later check of panel.B could pass on an older value.
      await expect.poll(async () => (await panel.panelOf('B'))?.activeTabId).toBe(id);
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
    // C8b start (a C8a test amended by C8b, ruling O2): the page's `log` stub yields to C8b's real Log, so the instances
    // are read through `agents.instances('log')` and a Log opens in its no-file state (it reads nothing).
    const NO_FILE_LOG = { params: { path: null, title: 'Log' } };
    const logInstances = (panel: PanelPage) =>
      panel.page.evaluate(() => (window as unknown as { __maws_harness: { agents: { instances(toolId: string): string[] } } }).__maws_harness.agents.instances('log'));
    // C8b end
    // Home and back, a switch to B and back, collapse and reopen: the log tabs and their instances stay.
    const roundTrip = async (panel: PanelPage, logs: string[]) => {
      const instances = await logInstances(panel); // C8b: the real Log's instances (O2)
      await panel.call('showSummary');
      await panel.call('selectTab', logs[0]);
      await panel.call('switchSession', 'B');
      await panel.call('switchSession', 'A');
      await panel.call('collapse', true);
      await panel.call('collapse', false);
      expect(await panel.ids()).toEqual(expect.arrayContaining(logs));
      expect(await logInstances(panel)).toEqual(instances); // C8b (O2)
      expect(instances).toEqual(expect.arrayContaining(logs));
    };

    await withProfile(async (launch) => {
      let panel = await launch();
      const pin = await panel.call('addTool', 'harness-stub', { pin: true });
      const info = await panel.call('addTool', 'session-info');
      const logs = [await panel.call('addTool', 'log', NO_FILE_LOG), await panel.call('addTool', 'log', NO_FILE_LOG)]; // C8b (O2)
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

      const fresh = await panel.call('addTool', 'log', NO_FILE_LOG); // opened after the relaunch: an ordinary tab until closed (C8b, O2)
      await roundTrip(panel, [fresh]);
      expect(await panel.ids()).toEqual([pin, info, fresh]);
      panel.expectQuietConsole();
    });
  });

  test('with no session shown (W5: a tab of none, the Overview being no tab), the pins keep their selection', async ({ maws }) => {
    const panel = await PanelPage.open(maws);
    const first = await panel.call('addTool', 'harness-stub', { pin: true });
    const second = await panel.call('addTool', 'harness-single', { pin: true }); // C11: a stand-in, not Session info (C11's real tool)
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

// ---- the #panel harness: the strip, the summary, R7 and both themes (M4) --------------------------------------------------

// A scratch repository for the test's body, removed after it.
async function withRepository(body: (repo: ReturnType<typeof scratchRepository>) => Promise<void>): Promise<void> {
  const repo = scratchRepository();
  try {
    await body(repo);
  } finally {
    repo.cleanup();
  }
}

const EXPLORATION_SOURCES = [
  'mcp: docs · searchSource only',
  'https://tanstack.com/virtual/latest/docs/api/virtualizer',
  ...['time', 'copy', 'keys', 'rows', 'reduce', 'derive'].map((name) => `/tmp/maws-synth-exploration-and-web/src/model/${name}.ts`),
]; // the Grep's search scope `src` is no source: C6 lists only file reads
const EDIT_SOURCES = ['src/util/rows.ts', 'src/store.ts', 'src/app.ts'].map((path) => `/tmp/maws-synth-edit-and-receipt/${path}`);

test.describe('the #panel harness: strip, summary, R7 and themes', () => {
  test.use({ mawsEnv: HARNESS_ENV });

  test('plus lists registered tools and opens a tab', async ({ maws }) => {
    const panel = await PanelPage.open(maws);
    const pin = await panel.call('addTool', 'harness-stub', { pin: true });
    await panel.call('showSummary');

    await panel.region.getByRole('button', { name: 'Add a tool' }).click();
    // §5.6's order for the registered menu tools (Log and the harness's child transcript are `menu: false`).
    // C8c (a C8a test amended by C8c): the page registers C8c's Review and Files, as App.tsx does.
    // C8b (a C8a test amended by C8b): and C8b's Subagents and Background work (its Log is `menu: false`).
    await expect(panel.page.getByRole('menuitem')).toHaveText(['Subagents', 'Review', 'Terminal', 'Files', 'Background work', 'Session info', 'Stub']);
    await panel.page.getByRole('menuitem', { name: 'Terminal' }).click();
    const terminal = (await panel.tabs()).find((tab) => tab.toolId === 'terminal');
    expect(terminal?.id).toMatch(/^terminal:[0-9a-z]{8}$/);
    expect(terminal).toMatchObject({ pinned: false, active: true });
    await expect.poll(() => panel.panelOf('A')).toEqual({ tabs: [{ id: terminal!.id, toolId: 'terminal', pinned: false }], activeTabId: terminal!.id });

    // With no session shown, "+" is disabled and says why, and the pins stay selectable (ruling O3).
    await panel.call('switchSession', null);
    await expect(panel.region.getByRole('button', { name: 'Open a session to add a tool' })).toBeDisabled();
    expect(await panel.ids()).toEqual([pin]);
    await panel.tab(pin).getByRole('tab').click();
    expect(await panel.active()).toBe(pin);
    await expect(panel.stubLine).toContainText(`${pin} · no session · pinned · visible`);
    panel.expectQuietConsole();
  });

  // C11 start: Session info on the #panel page (C11 execution document, M4 refresh task "Session info on C8a's host").
  // Main holds no engine process for the harness's sessions, so its reads fail quietly and the stores' values show.
  test('Session info renders its six sections for the shown session, and asks for a session when none is shown', async ({ maws }) => {
    const panel = await PanelPage.open(maws);
    const info = await panel.call('addTool', 'session-info', { pin: true });
    const body = panel.region.locator('[data-session-info="A"]');
    for (const title of ['Engine', 'Model', 'Gateway', 'Permissions', 'Context, usage, cost', 'Hooks and MCP']) await expect(body.getByRole('region', { name: title })).toBeVisible();
    const route = body.getByRole('term').filter({ hasText: /^Route$/ }).locator('xpath=following-sibling::dd[1]');
    // W2 (C3): the Direct⇄gateway switch is the Route row's action, its button text part of the row's.
    await expect(route, 'A runs direct in the harness scenario').toHaveText("Direct · engine's own loginSwitch to gateway…");
    await expect(route.getByRole('button', { name: 'Switch to gateway…' })).toBeVisible();
    await panel.call('switchSession', null);
    await panel.call('selectTab', info);
    await expect(panel.region.getByText('Open a session to see its details')).toBeVisible();
    panel.expectQuietConsole();
  });
  // C11 end

  test('state lives outside React across visibility, session switches and pins', async ({ maws }) => {
    const panel = await PanelPage.open(maws);
    const stub = await panel.call('addTool', 'harness-stub');
    const counter = panel.region.getByTestId('stub-counter');
    for (let i = 0; i < 3; i += 1) await panel.region.getByRole('button', { name: '+1' }).click();
    await expect(counter).toHaveText('3');

    await test.step('collapse with the region’s hide button, reopen', async () => {
      await panel.region.getByRole('button', { name: 'Hide right panel' }).click();
      await expect(panel.stubLine).toContainText('hidden');
      await panel.page.getByRole('button', { name: 'Show panel' }).click();
      await expect(panel.stubLine).toContainText('visible');
      await expect(counter).toHaveText('3');
    });
    await test.step('switch to B and back', async () => {
      await panel.call('switchSession', 'B');
      await expect(counter).toHaveCount(0); // B shows its summary: the tool is unmounted
      await panel.call('switchSession', 'A');
      await expect(counter).toHaveText('3');
    });
    await test.step('pin and unpin', async () => {
      await panel.call('pin', stub);
      await expect(panel.stubLine).toContainText('· pinned ·');
      await expect(counter).toHaveText('3');
      await panel.call('pin', stub);
      await expect(panel.stubLine).toContainText('· unpinned ·');
      await expect(counter).toHaveText('3');
    });
    expect(await panel.stub('harness-stub', 'counter')).toBe(3);
    expect(await panel.stub('harness-stub', 'instances'), 'one instance throughout').toEqual([stub]);
    panel.expectQuietConsole();
  });

  test('home glyph shows the summary with the tabs kept and a tab click returns with its scroll intact', async ({ maws }) => {
    const panel = await PanelPage.open(maws);
    const stub = await panel.call('addTool', 'harness-stub');
    const scroller = panel.region.getByTestId('stub-scroller');
    await scroller.evaluate((el) => el.scrollTo({ top: 400 }));
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(400);

    await panel.region.getByRole('button', { name: 'Session overview' }).click();
    await expect(panel.summary).toBeVisible();
    await expect(scroller, 'the unselected tool is unmounted').toHaveCount(0);
    expect(await panel.ids(), 'the tabs are kept').toEqual([stub]);
    expect(await panel.active()).toBeNull();

    await panel.tab(stub).getByRole('tab').click();
    await expect(scroller).toBeVisible();
    const top = await scroller.evaluate((el) => el.scrollTop);
    expect(Math.abs(top - 400), `scrollTop ${top}`).toBeLessThanOrEqual(1);
    panel.expectQuietConsole();
  });

  test('the summary shows when the last tab closes', async ({ maws }) => {
    const panel = await PanelPage.open(maws);
    const first = await panel.call('addTool', 'harness-stub');
    const second = await panel.call('addTool', 'harness-stub');
    await panel.tab(second).getByRole('button', { name: 'Close Stub' }).click();
    await expect.poll(() => panel.active(), 'closing the active tab selects the survivor').toBe(first);
    await expect(panel.summary).toHaveCount(0);
    await panel.tab(first).getByRole('button', { name: 'Close Stub' }).click();
    await expect.poll(() => panel.ids()).toEqual([]);
    await expect(panel.summary).toBeVisible();
    await expect(panel.section('Environment')).toBeVisible();
    panel.expectQuietConsole();
  });

  test('a beforeClose veto keeps the tab until the tool confirms', async ({ maws }) => {
    const panel = await PanelPage.open(maws);
    const stub = await panel.call('addTool', 'harness-stub');
    await panel.stub('harness-stub', 'vetoNextClose');
    await panel.tab(stub).getByRole('button', { name: 'Close Stub' }).click();
    const veto = panel.region.getByRole('status').filter({ hasText: 'This tab asked to stay open.' });
    await expect(veto).toBeVisible();
    expect(await panel.ids(), 'the veto keeps the tab').toEqual([stub]);
    expect(await panel.stub('harness-stub', 'instances')).toEqual([stub]);

    await veto.getByRole('button', { name: 'Close anyway' }).click();
    await expect.poll(() => panel.ids()).toEqual([]);
    expect(await panel.stub('harness-stub', 'instances'), 'disposed').toEqual([]);
    await expect(panel.summary).toBeVisible();
    panel.expectQuietConsole();
  });

  test('the summary renders from git, the status, the digest and the transcript projection and every row opens its tool', async ({ maws }) => {
    await withRepository(async (repo) => {
      const panel = await PanelPage.open(maws);
      await panel.call('setSession', 'A', { directory: repo.dir });

      await test.step('git, the status and the digest', async () => {
        await expect(panel.section('Environment')).toContainText('⎇ main');
        await expect(panel.changeLine).toHaveText('+1 −0 across 2 files · 1 untracked');
        await expect(panel.section('Push state')).toContainText('1 ahead of origin/main');
        await expect(panel.section('Push state').getByRole('button', { name: 'Open on GitHub' }), 'a local remote has no GitHub page').toHaveCount(0);
        await expect(panel.section('Subagents')).toContainText('2 working · 1 done');
        await expect(panel.section('Background work')).toContainText('1 shell · 1 workflow');
        await expect(panel.section('Sources')).toContainText('Open the session to list its sources');
      });

      await test.step('the transcript projection: exploration-and-web', async () => {
        await panel.call('loadTranscript', 'A', 'transcript/exploration-and-web');
        await expect.poll(() => panel.sources(), 'file rows newest first, a web row and an MCP row marked Source only').toEqual(EXPLORATION_SOURCES);
        // A web row opens its URL through layout.openExternal; main's browser call is intercepted, nothing opens.
        await maws.app.evaluate(({ shell }) => {
          const opened: string[] = [];
          (globalThis as { __opened?: string[] }).__opened = opened;
          shell.openExternal = async (url: string) => void opened.push(url);
        });
        await panel.section('Sources').getByRole('button', { name: /tanstack\.com/ }).click();
        await expect.poll(() => maws.app.evaluate(() => (globalThis as { __opened?: string[] }).__opened)).toEqual([EXPLORATION_SOURCES[1]]);
      });

      await test.step('the transcript projection: edit-and-receipt', async () => {
        await panel.call('loadTranscript', 'A', 'transcript/edit-and-receipt');
        await expect.poll(() => panel.sources(), 'the edited paths are file rows').toEqual(EDIT_SOURCES);
      });

      await test.step('every row opens its tool or names the child that brings it', async () => {
        const environment = panel.section('Environment');
        // C8c (a C8a test amended by C8c): Review is registered now, so its row opens it.
        await expect(environment.getByRole('button', { name: 'Review', exact: true }), 'Review is C8c’s').toBeEnabled();
        // C8b start (a C8a test amended by C8b): the page registers C8b's tools, whose sections fill themselves with Open.
        await expect(panel.section('Subagents').getByRole('button', { name: 'Open' })).toBeEnabled();
        await expect(panel.section('Background work').getByRole('button', { name: 'Open' })).toBeEnabled();
        // C8b end

        await environment.getByRole('button', { name: 'Session info' }).click(); // the model row
        const info = (await panel.tabs()).find((tab) => tab.toolId === 'session-info');
        expect(info, 'the model row opens Session info in A').toMatchObject({ active: true, pinned: false });
        await panel.call('showSummary');

        await panel.section('Sources').getByRole('button', { name: /src\/util\/rows\.ts/ }).click();
        await expect
          .poll(async () => Object.values((await panel.layout<{ sets: Record<string, { panes: { tabs: Record<string, unknown>[] }[] }> }>('main.tabs'))?.sets ?? {}).flatMap((set) => set.panes.flatMap((pane) => pane.tabs)), {
            message: 'a file row opens a file tab for A through C5’s openTab',
          })
          .toContainEqual(expect.objectContaining({ kind: 'file', path: EDIT_SOURCES[0], appSessionId: 'A' }));
      });
      panel.expectQuietConsole();
    });
  });

  test('the summary’s Sources and Subagents do not change with disclosure', async ({ maws }) => {
    const panel = await PanelPage.open(maws);
    const read = async () => ({ sources: await panel.sources(), glyphs: await panel.glyphLine() });
    const disclose = (how: 'collapseAll' | 'expandAll') =>
      panel.page.evaluate((how) => (window as unknown as PanelWindow).__maws_harness!.panel!.transcript('A')[how](), how);
    const cases = [
      ['transcript/exploration-and-web', { sources: EXPLORATION_SOURCES, glyphs: null }],
      // C8b (a C8a test amended by C8b): the glyphs are the task graph's, running agents first and then the finished ones
      // newest end first (C8b M2), so the agent that ended last leads.
      ['transcript/agents-and-messages', { sources: [], glyphs: expect.stringMatching(/^List the tests, Survey src for TODOs /) }],
    ] as const;
    for (const [fixture, expected] of cases) {
      await test.step(fixture, async () => {
        await panel.call('loadTranscript', 'A', fixture);
        // C8b start (a C8a test amended by C8b): the Subagents section is C8b's, drawn from the task graph, which reads the
        // loaded transcript's events once the fake agent-work client's wire is bound to it.
        await panel.page.evaluate((fixture) => (window as unknown as { __maws_harness: { agents: { feed(id: 'A', fixture: string): Promise<void> } } }).__maws_harness.agents.feed('A', fixture), fixture);
        // C8b end
        await expect.poll(read).toEqual(expected);
        const before = await read();
        await disclose('collapseAll');
        const collapsed = await read();
        await disclose('expandAll');
        const expanded = await read();
        expect(collapsed, 'every turn collapsed').toEqual(before);
        expect(expanded, 'every turn expanded').toEqual(collapsed);
      });
    }
    await expect(panel.section('Sources')).toContainText('No sources yet'); // agents-and-messages: the parent has none of its own
    panel.expectQuietConsole();
  });

  test('a second edit to an already-dirty file updates the change line', async ({ maws }) => {
    await withRepository(async (repo) => {
      const panel = await PanelPage.open(maws);
      await panel.call('setSession', 'A', { directory: repo.dir });
      await expect(panel.changeLine).toHaveText('+1 −0 across 2 files · 1 untracked');
      // Two more writes to the same dirty tracked file: its status is unchanged, so only the watcher's size and mtime
      // comparison (the Ask of C4) makes each one a git.changed.
      const latencies: number[] = [];
      for (const lines of [2, 3]) {
        const written = Date.now();
        repo.append(`edit ${lines}`);
        await expect(panel.changeLine).toHaveText(`+${lines} −0 across 2 files · 1 untracked`, { timeout: 1_000 });
        latencies.push(Date.now() - written);
      }
      test.info().annotations.push({ type: 'change line latency (ms)', description: latencies.join(', ') });
      panel.expectQuietConsole();
    });
  });

  test('a disk-only session marks shells unavailable', async ({ maws }) => {
    const panel = await PanelPage.open(maws);
    await expect(panel.section('Background work')).toContainText('1 shell · 1 workflow'); // A: live
    await panel.call('switchSession', 'B');
    await expect(panel.summary.getByRole('heading', { level: 2 })).toContainText('Harness B');
    await expect(panel.section('Background work')).toContainText('Shells and monitors are known only while the session runs here');
    await expect(panel.section('Background work')).not.toContainText('shell ·');
    panel.expectQuietConsole();
  });

  test('section expansion persists', async ({ maws }) => {
    const panel = await PanelPage.open(maws);
    const heading = panel.section('Sources').getByRole('button', { name: 'Sources' });
    await expect(heading).toHaveAttribute('aria-expanded', 'true');
    await heading.click();
    await expect(heading).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(() => panel.layout('summary.sections')).toEqual({ version: 1, collapsed: ['sources'] });

    await panel.page.reload();
    const reloaded = await PanelPage.open(maws);
    await expect(reloaded.section('Sources').getByRole('button', { name: 'Sources' })).toHaveAttribute('aria-expanded', 'false');
    await expect(reloaded.section('Environment').getByRole('button', { name: 'Environment' })).toHaveAttribute('aria-expanded', 'true');
    reloaded.expectQuietConsole();
  });

  // R7 (C8 spec *Delegated unknowns*): C6's child transcript, virtualised and following, inside the region at the
  // panel's three widths and maximized, over the derived fixture's first child.
  test('child transcript renders inside the region at 280, 380, 640 and maximized', async ({ maws }) => {
    const panel = await PanelPage.open(maws);
    // C5's clamp keeps the main column at 480 px and lets the panel yield first, so with the page's 300 px sidebar a
    // window under 1420 px (this Mac's e2e window is 1280) renders 640 as less; with the sidebar collapsed every width
    // renders as set in any window of at least 1120 px, and the case asserts the rendered width rather than assume it.
    await panel.call('collapseSidebar', true);
    const verdict: Record<string, unknown>[] = [];
    let open: string | null = null;
    for (const width of [280, 380, 640, 'maximized'] as const) {
      await test.step(`${width}`, async () => {
        if (open) expect(await panel.call('closeTab', open)).toBe(true); // a fresh child over a fresh player
        if (width === 'maximized') await panel.call('maximize', true);
        else await panel.call('setWidth', width);
        await panel.call('loadTranscript', 'A', 'events/panel-child', { releaseTo: PANEL_CHILD_TAIL.first });
        open = await panel.call('addTool', 'child');
        await expect.poll(async () => (await panel.metrics()).rows, 'the child’s history').toBeGreaterThan(0);
        const region = await panel.metrics();
        if (width === 'maximized') expect(region.regionWidth, 'maximized: wider than the widest side width').toBeGreaterThan(640);
        else expect(region.regionWidth, 'rendered as set').toBe(width);

        let last: PanelChildMetrics | null = null;
        for (const [i, count] of PANEL_CHILD_TAIL.batches.entries()) {
          expect(await panel.child('release', count), `rows after batch ${i + 1}`).toBe(PANEL_CHILD_TAIL.rows[i]);
          await expect.poll(async () => (await panel.metrics()).lastRowInView, `the end stays in view after batch ${i + 1}`).toBe(true);
          last = await panel.metrics();
          expect(last.following, `following through batch ${i + 1}`).toBe(true);
          expect(last.domRows, 'virtualised: fewer row elements than rows').toBeLessThan(last.rows);
          expect(last.domRows, 'within the visible rows plus twice the overscan').toBeLessThanOrEqual(last.visibleRows + 2 * last.overscan);
          expect(last.scrollWidth, 'no horizontal overflow in the slot').toBe(last.clientWidth);
          expect(last.overflowX, 'nor in the tab panel or the list').toBe(0);
        }
        expect(last!.pendingRequests).toBe(1);
        await expect(panel.region.locator('.transcript-slot-placeholder[role="status"]'), 'C6’s placeholder, since C7 is not on master').toBeVisible();

        await panel.child('expandAll');
        await expect.poll(async () => (await panel.metrics()).lastRowInView, 'expandAll leaves the end in view').toBe(true);
        const settled = await panel.metrics();
        expect(settled.overflowX).toBe(0);
        verdict.push({ width, ...settled });
        if (width === 'maximized') await panel.call('maximize', false);
      });
    }
    const windowWidth = await panel.page.evaluate(() => window.innerWidth);
    test.info().annotations.push({ type: 'R7 metrics', description: JSON.stringify({ windowWidth, verdict }) });
    panel.expectQuietConsole();
  });

  test('both themes use tokens only', async ({ maws }) => {
    await withRepository(async (repo) => {
      const { page } = maws;
      // A placeholder tab (a ref whose tool is not registered) in B's list, written before the page hydrates it.
      // C8c (a C8a test amended by C8c): C8b's Subagents, since Review is registered now.
      // C8b (a C8a test amended by C8b): the page registers every P0 tool now, so the placeholder is a tool outside the
      // P0 table (§16's topology view), which the host names as not available.
      await page.waitForFunction(() => (window as unknown as { maws?: unknown }).maws !== undefined);
      await page.evaluate(async () => {
        const value = { tabs: [{ id: 'topology:placeholder', toolId: 'topology', pinned: false }], activeTabId: null }; // C8b
        const result = await window.maws.invoke('layout.set', { key: 'panel.B', value });
        if (!result.ok) throw new Error(result.error.message);
      });
      await page.reload();
      const panel = await PanelPage.open(maws);
      await panel.call('setSession', 'A', { directory: repo.dir });
      await panel.call('loadTranscript', 'A', 'transcript/exploration-and-web');
      const pin = await panel.call('addTool', 'harness-stub', { pin: true });
      const own = await panel.call('addTool', 'harness-stub');
      expect(await panel.ids()).toEqual([pin, own]);

      const scan = async (theme: 'light' | 'dark') => {
        await panel.call('setTheme', theme);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        const views: [string, () => Promise<void>][] = [
          [
            'the summary at rest under a pinned and an unpinned tab',
            async () => {
              await panel.call('switchSession', 'A');
              await panel.call('showSummary');
              await expect(panel.changeLine).toHaveText('+1 −0 across 2 files · 1 untracked');
              await expect.poll(() => panel.sources()).toEqual(EXPLORATION_SOURCES);
            },
          ],
          [
            'the "+" menu',
            async () => {
              await panel.region.getByRole('button', { name: 'Add a tool' }).click();
              await expect(page.getByRole('menuitem', { name: 'Terminal' })).toBeVisible();
            },
          ],
          [
            'a veto line',
            async () => {
              await page.keyboard.press('Escape');
              await expect(page.getByRole('menu')).toHaveCount(0);
              await panel.call('selectTab', own);
              await panel.stub('harness-stub', 'vetoNextClose');
              expect(await panel.call('closeTab', own)).toBe(false);
              await expect(panel.region.getByRole('status').filter({ hasText: 'This tab asked to stay open.' })).toBeVisible();
            },
          ],
          [
            'a placeholder tab',
            async () => {
              await panel.call('switchSession', 'B');
              await panel.tab('topology:placeholder').getByRole('tab').click(); // C8b
              await expect(panel.region.getByRole('tabpanel')).toHaveText('topology is not available'); // C8b
            },
          ],
        ];
        for (const [view, show] of views) {
          await show();
          expect(await otherThemeColours(page), `${theme}: ${view}`).toEqual([]);
        }
      };
      await scan('dark');
      await scan('light');
      panel.expectQuietConsole();
    });
  });

  // M1's review: since the stand-in fold the terminal e2e runs maximized (its line assertions assume the window's
  // width), so this case runs a Terminal at the product's default side-column width.
  test('a Terminal tab works at the default side-column width', async ({ maws }) => {
    const panel = await PanelPage.open(maws);
    const { page, app } = maws;
    // As in R7: with the page's sidebar collapsed, C5's clamp cannot narrow the panel in a small window, so the default
    // width and the 640 px refit below render as set.
    await panel.call('collapseSidebar', true);
    expect((await panel.region.boundingBox())!.width, 'the product default, C5’s --panel-w').toBe(380);
    await panel.region.getByRole('button', { name: 'Add a tool' }).click();
    await page.getByRole('menuitem', { name: 'Terminal' }).click();
    await expect.poll(async () => (await panel.tabs()).find((t) => t.toolId === 'terminal')?.terminalId ?? null).not.toBeNull();
    const id = (await panel.tabs()).find((t) => t.toolId === 'terminal')!.terminalId!;

    type Probe = { cols: number; rows: number; line(row: number): string; lineCount(): number };
    type Terminals = { probe(id: string): Probe | null; type(id: string, data: string): Promise<void> };
    type TerminalWindow = { __maws_harness: { terminals: Terminals } };
    const type = (data: string) => page.evaluate(([id, data]) => (window as unknown as TerminalWindow).__maws_harness.terminals.type(id, data), [id, data] as const);
    const lines = () =>
      page.evaluate((id) => {
        const probe = (window as unknown as TerminalWindow).__maws_harness.terminals.probe(id);
        return probe ? Array.from({ length: probe.lineCount() }, (_, i) => probe.line(i).trimEnd()) : [];
      }, id);
    const cols = () => page.evaluate((id) => (window as unknown as TerminalWindow).__maws_harness.terminals.probe(id)?.cols ?? 0, id);
    const hasLine = async (text: string) => (await lines()).some((line) => line.trim() === text);
    await expect.poll(async () => (await lines()).some((line) => line.trim() !== ''), { timeout: 15_000, message: 'a prompt' }).toBe(true);

    const side = await cols();
    const screen = page.locator(`[data-terminal-id="${id}"] .xterm-screen`);
    expect((await screen.boundingBox())!.width, 'the terminal fits the side column').toBeLessThanOrEqual(380);
    expect(side, 'fitted to the side column, not the window').toBeLessThan(80);
    expect(side).toBeGreaterThan(20);
    test.info().annotations.push({ type: 'columns at 380 px', description: String(side) });

    // A command typed through the pty runs; a line wider than the column wraps onto the next row.
    await type(`printf '%s\\n' "SIDE-$((6*7))"\r`);
    await expect.poll(() => hasLine('SIDE-42')).toBe(true);
    await type(`printf '%s\\n' "$(printf 'w%.0s' $(seq 1 ${side + 5}))"\r`);
    await expect
      .poll(async () => {
        const all = await lines();
        const at = all.findIndex((line) => line === 'w'.repeat(side));
        return at >= 0 && all[at + 1]?.trim() === 'w'.repeat(5);
      }, { message: 'the wide line wraps at the column’s width' })
      .toBe(true);

    // ⌘V at this width: the pasted command runs. The prompt and the command may wrap across rows here (the reason the
    // terminal e2e maximizes), so the echo is looked for in the rows joined. The paste goes through the Mac's one
    // pasteboard, which nothing else may write meanwhile; what it held before is written back unless something else has
    // copied since (support/clipboard.ts).
    const joined = () =>
      page.evaluate((id) => {
        const probe = (window as unknown as TerminalWindow).__maws_harness.terminals.probe(id);
        return probe ? Array.from({ length: probe.lineCount() }, (_, i) => probe.line(i).padEnd(probe.cols)).join('') : '';
      }, id);
    await withNativeClipboard(app, ['echo PASTED-$((6*7))'], async () => {
      await app.evaluate(({ clipboard }) => clipboard.writeText('echo PASTED-$((6*7))'));
      await screen.click();
      await page.keyboard.press('Meta+KeyV');
      await expect.poll(async () => (await joined()).includes('echo PASTED-$((6*7))')).toBe(true);
    });
    await type('\r');
    await expect.poll(() => hasLine('PASTED-42')).toBe(true);

    // Wider and back: the terminal refits each time, and nothing in the region scrolls sideways.
    await panel.call('setWidth', 640);
    await expect.poll(cols, 'refits wider').toBeGreaterThan(side);
    await panel.call('setWidth', 380);
    await expect.poll(cols, 'and back').toBe(side);
    const sideways = await panel.region.evaluate((region) =>
      Array.from(region.querySelectorAll<HTMLElement>('*'))
        .filter((el) => el.scrollWidth > el.clientWidth + 1 && ['auto', 'scroll'].includes(getComputedStyle(el).overflowX) && !el.closest('[role="tablist"]'))
        .map((el) => el.className),
    );
    expect(sideways, 'nothing in the region scrolls sideways').toEqual([]);
    panel.expectQuietConsole();
  });
});

// ---- the product host over a scenario derived from C5's records (M4) --------------------------------------------------------

// The app's menu item by id, as C5's smoke clicks it.
async function menu(app: ElectronApplication, id: string): Promise<void> {
  const clicked = await app.evaluate(({ Menu }, id) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id);
    if (!item?.enabled) return false;
    item.click();
    return true;
  }, id);
  expect(clicked, `menu item ${id} exists and is enabled`).toBe(true);
}

// The product app over nine-sessions.json copied with *Charter + research* pointed at a scratch repository.
async function withScenario(body: (maws: MawsLaunch, panel: Locator) => Promise<void>): Promise<void> {
  const repo = scratchRepository();
  const dir = mkdtempSync(join(tmpdir(), 'maws-panel-scenario-'));
  let maws: MawsLaunch | null = null;
  try {
    const scenario = panelScenario(dir, repo.dir);
    maws = await launchMaws({ env: { MAWS_SESSION_SOURCE: `stub:${scenario}`, MAWS_SCENARIO_CLOCK: 'manual', MAWS_HARNESS: '0' } });
    await body(maws, maws.page.locator('[data-region="panel"]'));
  } finally {
    await maws?.cleanup();
    repo.cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
}

const tabNamed = (title: string) => new RegExp(`^${title.replace(/[+]/g, '\\+')}`);

test.describe('the product host over a scenario derived from C5’s records', () => {
  test('the product host rests on the summary and follows the focused session', async () => {
    await withScenario(async (maws, panel) => {
      const { page, app } = maws;
      const summary = panel.getByRole('tabpanel', { name: 'Session overview' });
      const title = summary.getByRole('heading', { level: 2 });

      await (await sidebarRow(page, CHARTER)).click();
      await expect(title).toContainText(CHARTER);
      await expect(summary.getByRole('region', { name: 'Environment' })).toContainText('⎇ main');
      await expect(summary.getByRole('region', { name: 'Push state' })).toContainText('1 ahead of origin/main');
      // E6 (a C8a test amended by E6): the push text opens Source control, and the row's PR line asks for trust, since the
      // launch's config home trusts nothing.
      await expect(summary.getByRole('region', { name: 'Push state' }).getByRole('button', { name: 'Open Source control' })).toHaveText('1 ahead of origin/main');
      await expect(summary.getByRole('region', { name: 'Push state' })).toContainText('Trust this folder to see PR state');
      await expect(summary.getByRole('region', { name: 'Subagents' })).toContainText('2 working · 1 done'); // the fixture's digest

      // Fix sidebar drag in a split, focused: the summary follows; its probe directory does not exist on this machine.
      // I2: ⌘-click opens it in a tab of its own (a plain click would replace Charter's).
      await (await sidebarRow(page, SIDEBAR_DRAG)).click({ modifiers: ['Meta'] });
      await menu(app, 'pane.split');
      await expect(page.getByRole('tablist', { name: 'Right pane tabs' }).getByRole('tab', { name: tabNamed(SIDEBAR_DRAG) })).toBeVisible();
      await expect(title).toContainText(SIDEBAR_DRAG);
      const environment = summary.getByRole('region', { name: 'Environment' });
      await expect(environment).toContainText(/Not a git repository|Git unavailable/);
      await expect(environment).not.toContainText('⎇');
      await expect(summary.getByRole('region', { name: 'Push state' })).toHaveCount(0);

      // Back to the left pane's Charter tab, then a tab of no session (W5: the Overview is no tab; Help › Diagnostics
      // is one): the footer, no sections, no tabs, "+" disabled.
      const left = page.getByRole('tablist', { name: 'Left pane tabs' });
      await left.getByRole('tab', { name: tabNamed(CHARTER) }).click();
      await expect(title).toContainText(CHARTER);
      await menu(app, 'diagnostics.open');
      await expect(summary.getByText('Tools stay with this session. Pin a tab to keep it with you as you switch.')).toBeVisible();
      await expect(summary.getByRole('region')).toHaveCount(0);
      await expect(panel.getByRole('tablist', { name: 'Panel tools' }).getByRole('tab')).toHaveCount(0);
      await expect(panel.getByRole('button', { name: 'Open a session to add a tool' })).toBeDisabled();
      expect(maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
    });
  });

  test('unregistered tools are named', async () => {
    await withScenario(async (maws, panel) => {
      const { page } = maws;
      await (await sidebarRow(page, CHARTER)).click();
      const summary = panel.getByRole('tabpanel', { name: 'Session overview' });
      const environment = summary.getByRole('region', { name: 'Environment' });
      await expect(environment).toContainText('⎇ main');
      // C9's Terminal is registered from App.tsx (C8a's block, since C9 merged); every other P0 tool arrives with its child.
      // C8c (a C8a test amended by C8c): C8c's Review and Files are registered from App.tsx too.
      await expect(environment.getByRole('button', { name: 'Review', exact: true }), 'Review').toBeEnabled();
      // C11 (a C8a test amended by C11): Session info is registered from App.tsx, so the model row opens it.
      await expect(environment.getByRole('button', { name: 'Session info' }), 'the model row').toBeEnabled();
      // C8b start: Subagents (M2) and Background work (M3) register from C8b's block and fill their own sections, each
      // with its Open enabled; the Log registers too but is never offered from "+" (menu: false).
      await expect(summary.getByRole('region', { name: 'Subagents' }).getByRole('button', { name: 'Open' })).toBeEnabled();
      await expect(summary.getByRole('region', { name: 'Background work' }).getByRole('button', { name: 'Open' })).toBeEnabled();
      // C8b end
      const disabled = await summary.locator('button:disabled').allTextContents();
      expect(disabled).toHaveLength(0); // C8b, C8c and C11: every summary row's tool is registered

      await panel.getByRole('button', { name: 'Add a tool' }).click();
      await expect(page.getByRole('menuitem'), '"+" offers the registered tools only').toHaveText(['Subagents', 'Review', 'Terminal', 'Files', 'Background work', 'Session info']); // by MENU_ORDER; Log is menu: false
      await page.keyboard.press('Escape');
      expect(maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
    });
  });
});
