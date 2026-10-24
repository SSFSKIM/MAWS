// C8a's panel host end to end (C8a execution document, acceptance item 2), run by `pnpm e2e:panel` over the harness
// build. The first case runs the product app, not the harness (`MAWS_HARNESS=0`, since `pnpm e2e:panel` runs under
// MAWS_HARNESS=1 and a launch inherits the runner's environment); the harness cases (M3's persistence and pin cases,
// M4's strip, summary, R7, theme and side-column Terminal cases) run the `#panel` page, over the harness scenario's two
// sessions (ruling O1), so that main's read model knows A and B, accepts their panel keys, and a Terminal tab has a
// directory to start in. The last two cases run the product over a scenario derived from C5's nine-sessions.json.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import type { PanelChildMetrics, PanelHarnessApi, PanelHarnessTab } from '../src/renderer/src/harness/panel/api';
import { PANEL_CHILD_TAIL } from '../test/support/panel-child-tail';
import { withNativeClipboard } from './support/clipboard';
import { launchMaws, test, type MawsLaunch } from './support/launch';
import { latencyWait } from './support/latency';
import { sidebarRow } from './support/sidebar';
import { CHARTER, otherThemeColours, panelScenario, scratchRepository, SIDEBAR_DRAG } from './support/panel-support';
import type { AppSessionId } from '@shared/graph/ids'; // P4-B3
import { closeScene, launchScene, scratchProject, show, type Scene } from './support/maws-tools'; // P4-B3: the split's float
import { seedTranscript, transcript } from './support/side-replay'; // P4-B3
import { closeSurface, mainTabs, openSurface, sessionCards, showSessionCards, surface, surfaceRow, unfoldSessionCard } from './support/shell';

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
  // UX2: tools open from the chrome icon row, not a cross-tool tab strip.
  await openSurface(page, 'Terminal');

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
    return sessionCards(this.page);
  }
  // UX2: push state lives inside Environment; Sources is embedded in Context rather than a separate panel section.
  section = (name: 'Environment' | 'Context' | 'Connectors' | 'Artifacts' | 'Sources') => name === 'Sources'
    ? this.summary.locator('[aria-label="Sources"]')
    : this.summary.getByRole('region', { name, exact: true });
  async unfold(...names: ('Environment' | 'Context' | 'Connectors' | 'Artifacts')[]): Promise<void> {
    for (const name of names) await unfoldSessionCard(this.page, name);
  }
  get changeLine() {
    return this.summary.getByTestId('change-line');
  }
  // The Sources rows, top to bottom: a file row by its path, a web row by its URL, an MCP row by its text.
  sources = (): Promise<string[]> =>
    this.section('Sources')
      .locator('li')
      .evaluateAll((items) => items.map((li) => li.querySelector('button')?.title ?? `mcp: ${li.textContent ?? ''}`));
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
      if (expected === null) await expect(panel.summary, 'UX2 resting cards replace the dedicated summary column').toBeVisible();
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
    await expect(surfaceRow(panel.page).getByRole('button', { name: 'Terminal', exact: true })).toBeDisabled();
    await expect(surfaceRow(panel.page).getByRole('button', { name: 'Session cards', exact: true })).toBeDisabled();

    await panel.call('showSummary'); // UX2: no session means no cards or reserved column; held pins remain selectable.
    await expect(panel.summary).toHaveCount(0);
    await expect.poll(async () => (await panel.region.boundingBox())?.width ?? 0).toBe(0);
    expect(await panel.ids()).toEqual([first, second]);
    expect(await panel.active()).toBeNull();

    await panel.call('selectTab', second);
    await expect(panel.stubLine).toContainText(`${second} · no session · pinned · visible`);
    await panel.call('switchSession', 'A');
    await panel.call('switchSession', null);
    expect(await panel.active()).toBe(second);
    await expect(surface(panel.page, 'harness-single')).toBeVisible();
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

  test('the icon row and overflow list registered tools and open their surfaces', async ({ maws }) => {
    const panel = await PanelPage.open(maws);
    const pin = await panel.call('addTool', 'harness-stub', { pin: true });
    await panel.call('showSummary');

    // UX2: the primary tools are icons; non-primary registered tools remain reachable through overflow.
    await surfaceRow(panel.page).getByRole('button', { name: 'More surfaces', exact: true }).click();
    await expect(panel.page.getByRole('menuitem')).toHaveText(['Subagents', 'Background work', 'Tasks', 'Session info', 'Stub']);
    await panel.page.keyboard.press('Escape');
    await openSurface(panel.page, 'Terminal');
    const terminal = (await panel.tabs()).find((tab) => tab.toolId === 'terminal');
    expect(terminal?.id).toMatch(/^terminal:[0-9a-z]{8}$/);
    expect(terminal).toMatchObject({ pinned: false, active: true });
    await expect.poll(() => panel.panelOf('A')).toEqual({ tabs: [{ id: terminal!.id, toolId: 'terminal', pinned: false }], activeTabId: terminal!.id });

    // UX2's overflow replaces "+"; with no session, new tools are disabled but existing global pins stay selectable (O3).
    await panel.call('switchSession', null);
    await expect(surfaceRow(panel.page).getByRole('button', { name: 'Terminal', exact: true })).toBeDisabled();
    expect(await panel.ids()).toEqual([pin]);
    await openSurface(panel.page, 'Stub');
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
      await panel.page.getByRole('button', { name: 'Hide panel', exact: true }).click();
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

    await showSessionCards(panel.page); // UX2: resting cards are selected by the chrome control, not a Home tab.
    await expect(panel.summary).toBeVisible();
    await expect(scroller, 'the unselected tool is unmounted').toHaveCount(0);
    expect(await panel.ids(), 'the tabs are kept').toEqual([stub]);
    expect(await panel.active()).toBeNull();

    await openSurface(panel.page, 'Stub');
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
      await panel.unfold('Environment', 'Context');

      await test.step('git, the status and the digest', async () => {
        await expect(panel.section('Environment')).toContainText('⎇ main');
        await expect(panel.changeLine).toHaveText('+1 −0 across 2 files · 1 untracked');
        // UX2 embeds push state in Environment and agent/background destinations in Context.
        await expect(panel.section('Environment')).toContainText('1 ahead of origin/main');
        await expect(panel.section('Environment').getByRole('button', { name: 'Open on GitHub' }), 'a local remote has no GitHub page').toHaveCount(0);
        await expect(panel.section('Context').getByRole('button', { name: 'Subagents', exact: true })).toBeEnabled();
        await expect(panel.section('Context').getByRole('button', { name: 'Background work', exact: true })).toBeEnabled();
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
        // UX2's Context card keeps the existing tools reachable without their former permanent summary sections.
        await expect(panel.section('Context').getByRole('button', { name: 'Subagents', exact: true })).toBeEnabled();
        await expect(panel.section('Context').getByRole('button', { name: 'Background work', exact: true })).toBeEnabled();

        await environment.getByRole('button', { name: 'Session info' }).click(); // the model row
        const info = (await panel.tabs()).find((tab) => tab.toolId === 'session-info');
        expect(info, 'the model row opens Session info in A').toMatchObject({ active: true, pinned: false });
        await panel.call('showSummary');
        await panel.unfold('Context');

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

  test('Context’s Sources do not change with transcript disclosure', async ({ maws }) => {
    const panel = await PanelPage.open(maws);
    await panel.unfold('Context');
    const read = () => panel.sources();
    const disclose = (how: 'collapseAll' | 'expandAll') =>
      panel.page.evaluate((how) => (window as unknown as PanelWindow).__maws_harness!.panel!.transcript('A')[how](), how);
    const cases = [
      ['transcript/exploration-and-web', EXPLORATION_SOURCES],
      // UX2 removes the digest glyph strip, not the disclosure-independent source projection or Subagents destination.
      ['transcript/agents-and-messages', []],
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
    await expect(panel.section('Context').getByRole('button', { name: 'Subagents', exact: true })).toBeEnabled();
    panel.expectQuietConsole();
  });

  test('a second edit to an already-dirty file updates the change line', async ({ maws }) => {
    // Each edit's change line within a second; a configured VM lane waits to the ceiling then checks actual guest overlap.
    const changeLineWait = latencyWait('change line latency', 1_000);
    await withRepository(async (repo) => {
      const panel = await PanelPage.open(maws);
      await panel.call('setSession', 'A', { directory: repo.dir });
      await panel.unfold('Environment', 'Context');
      await expect(panel.changeLine).toHaveText('+1 −0 across 2 files · 1 untracked');
      // Two more writes to the same dirty tracked file: its status is unchanged, so only the watcher's size and mtime
      // comparison (the Ask of C4) makes each one a git.changed.
      const latencies: number[] = [];
      for (const lines of [2, 3]) {
        const written = Date.now();
        repo.append(`edit ${lines}`);
        await expect(panel.changeLine).toHaveText(`+${lines} −0 across 2 files · 1 untracked`, { timeout: changeLineWait.timeout });
        const elapsed = Date.now() - written;
        changeLineWait.assertElapsed?.(elapsed);
        latencies.push(elapsed);
      }
      test.info().annotations.push({ type: 'change line latency (ms)', description: latencies.join(', ') });
      panel.expectQuietConsole();
    });
  });

  test('a disk-only session marks shells unavailable in its Background work surface', async ({ maws }) => {
    const panel = await PanelPage.open(maws);
    // UX2 moves the work listing out of a permanent summary section, while preserving the live/disk read boundary.
    await openSurface(panel.page, 'Background work');
    await expect(surface(panel.page, 'background')).toContainText('Shells · 1 running'); // A: live
    await panel.call('switchSession', 'B');
    await openSurface(panel.page, 'Background work');
    await expect(surface(panel.page, 'background')).toContainText('Shells and monitors are known only while the session runs here');
    // Unknown while offline is not zero: no live Shells counter should be claimed for this disk-only session.
    await expect(surface(panel.page, 'background')).not.toContainText('Shells ·');
    panel.expectQuietConsole();
  });

  test('temporary cards start folded on reload without overwriting legacy section preferences', async ({ maws }) => {
    const panel = await PanelPage.open(maws);
    const legacy = { version: 1, collapsed: ['sources'] };
    const saved = await panel.page.evaluate((value) => window.maws.invoke('layout.set', { key: 'summary.sections', value }), legacy);
    expect(saved.ok).toBe(true);
    const heading = panel.section('Context').getByRole('button').first();
    await expect(heading).toHaveAttribute('aria-expanded', 'false');
    await heading.click();
    await expect(heading).toHaveAttribute('aria-expanded', 'true');
    // UX2's disclosures are intentionally temporary, not the previous permanent-column preferences.
    expect(await panel.layout('summary.sections')).toEqual(legacy);
    await panel.page.reload();
    const reloaded = await PanelPage.open(maws);
    for (const name of ['Environment', 'Context', 'Connectors', 'Artifacts'] as const) {
      await expect(reloaded.section(name).getByRole('button').first()).toHaveAttribute('aria-expanded', 'false');
    }
    expect(await reloaded.layout('summary.sections')).toEqual(legacy);
    reloaded.expectQuietConsole();
  });

  // R7 (C8 spec *Delegated unknowns*): C6's child transcript, virtualised and following, inside the region at the
  // panel's three widths and maximized, over the derived fixture's first child.
  test('child transcript renders inside the region at 280, 380, 640 and maximized', async ({ maws }) => {
    const panel = await PanelPage.open(maws);
    // With the sidebar collapsed this window leaves room for every explicit width plus main's 360px floor.
    // The 380px legacy sentinel instead selects the narrow content-sized default.
    await panel.call('collapseSidebar', true);
    const verdict: Record<string, unknown>[] = [];
    let open: string | null = null;
    for (const width of [280, 380, 640, 'maximized'] as const) {
      await test.step(`${width}`, async () => {
        if (open) expect(await panel.call('closeTab', open)).toBe(true); // a fresh child over a fresh player
        await panel.call('loadTranscript', 'A', 'events/panel-child', { releaseTo: PANEL_CHILD_TAIL.first });
        open = await panel.call('addTool', 'child');
        // UX2 restores main when there is no selected surface. Size/maximize the real child after opening it, not the
        // empty stack between iterations, whose maximal state would correctly normalize back to docked.
        if (width === 'maximized') await panel.call('maximize', true);
        else await panel.call('setWidth', width);
        await expect.poll(async () => (await panel.metrics()).rows, 'the child’s history').toBeGreaterThan(0);
        if (width === 'maximized') await expect.poll(async () => (await panel.metrics()).regionWidth, 'maximized: wider than the widest side width').toBeGreaterThan(640);
        else await expect.poll(async () => (await panel.metrics()).regionWidth, 'UX2: automatic narrow defaults cap at 420px; explicit user widths are honored').toBe(width === 380 ? 420 : width);

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
      await panel.unfold('Environment', 'Context');
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
              await panel.unfold('Environment', 'Context');
              await expect(panel.changeLine).toHaveText('+1 −0 across 2 files · 1 untracked');
              await expect.poll(() => panel.sources()).toEqual(EXPLORATION_SOURCES);
            },
          ],
          [
            'the "+" menu',
            async () => {
              await surfaceRow(page).getByRole('button', { name: 'More surfaces', exact: true }).click();
              await expect(page.getByRole('menuitem', { name: 'Session info', exact: true })).toBeVisible();
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
              await panel.call('selectTab', 'topology:placeholder'); // Restored unavailable tools have no registered icon.
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
    // UX2: no tool means no column. Terminal opens at its content-sized narrow default, capped at 420px.
    expect((await panel.region.boundingBox())!.width).toBe(0);
    await openSurface(page, 'Terminal');
    const defaultWidth = (await panel.region.boundingBox())!.width;
    expect(defaultWidth).toBe(420);
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
    expect((await screen.boundingBox())!.width, 'the terminal fits the content-sized side column').toBeLessThanOrEqual(defaultWidth);
    expect(side, 'fitted to the side column, not the window').toBeLessThan(80);
    expect(side).toBeGreaterThan(20);
    test.info().annotations.push({ type: `columns at ${defaultWidth} px`, description: String(side) });

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

    // Narrower and back: UX2 caps this narrow tool, so exercise the meaningful refit from its default to the floor.
    await panel.call('setWidth', 280);
    await expect.poll(cols, 'refits narrower').toBeLessThan(side);
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
// A Files case may point one more session at that real root instead of a recorded, nonexistent probe directory.
async function withScenario(body: (maws: MawsLaunch, panel: Locator) => Promise<void>, { filesFor }: { filesFor?: string } = {}): Promise<void> {
  const repo = scratchRepository();
  const dir = mkdtempSync(join(tmpdir(), 'maws-panel-scenario-'));
  let maws: MawsLaunch | null = null;
  try {
    const scenario = panelScenario(dir, repo.dir);
    if (filesFor) {
      const fixture = JSON.parse(readFileSync(scenario, 'utf8')) as { sessions: { title: { text: string }; directory: string }[] };
      const session = fixture.sessions.find((record) => record.title.text === filesFor);
      if (!session) throw new Error(`Files fixture has no session ${filesFor}`);
      session.directory = repo.dir;
      writeFileSync(scenario, JSON.stringify(fixture, null, 2));
    }
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
  test('floating cards follow the focused session and leave non-session main tabs unreserved', async () => {
    await withScenario(async (maws, panel) => {
      const { page, app } = maws;
      await (await sidebarRow(page, CHARTER)).click();
      const environment = await unfoldSessionCard(page, 'Environment');
      await expect(environment).toContainText('⎇ main');
      await expect(environment).toContainText('1 ahead of origin/main');
      // UX2 embeds push state without changing the real Source control route or its trust boundary (A-28).
      const openScm = environment.getByRole('button', { name: '1 ahead of origin/main', exact: true });
      await expect(openScm).toHaveText('1 ahead of origin/main');
      await expect(openScm).toHaveAccessibleDescription('Open Source control');
      await expect(environment).toContainText('Trust this folder to see PR state');

      await (await sidebarRow(page, SIDEBAR_DRAG)).click({ modifiers: ['Meta'] });
      await menu(app, 'pane.split');
      await expect(mainTabs(page).getByRole('tablist', { name: 'Right pane tabs' }).getByRole('tab', { name: tabNamed(SIDEBAR_DRAG) })).toBeVisible();
      await unfoldSessionCard(page, 'Environment');
      await expect(environment).toContainText(/Not a git repository|Git unavailable/);
      await expect(environment).not.toContainText('⎇');
      await expect(environment).not.toContainText('ahead of origin/main');

      await mainTabs(page).getByRole('tablist', { name: 'Left pane tabs' }).getByRole('tab', { name: tabNamed(CHARTER) }).click();
      await unfoldSessionCard(page, 'Environment');
      await expect(environment).toContainText('⎇ main');
      await menu(app, 'diagnostics.open');
      // UX2: a non-session tab earns neither cards nor an empty right column, but keeps remembered tool context.
      await expect(sessionCards(page)).toHaveCount(0);
      await expect.poll(async () => (await panel.boundingBox())?.width ?? 0).toBe(0);
      await expect(surfaceRow(page).getByRole('button', { name: 'Session cards', exact: true })).toBeDisabled();
      await expect(surfaceRow(page).getByRole('button', { name: 'Review', exact: true })).toBeEnabled();
      expect(maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
    });
  });

  test('registered tools remain reachable through cards, primary icons and overflow', async () => {
    await withScenario(async (maws) => {
      const { page } = maws;
      await (await sidebarRow(page, CHARTER)).click();
      const environment = await unfoldSessionCard(page, 'Environment');
      await expect(environment).toContainText('⎇ main');
      for (const name of ['Review', 'Files', 'Session info']) await expect(environment.getByRole('button', { name, exact: true })).toBeEnabled();
      const context = await unfoldSessionCard(page, 'Context');
      for (const name of ['Subagents', 'Background work']) await expect(context.getByRole('button', { name, exact: true })).toBeEnabled();
      for (const name of ['Terminal', 'Review', 'Files', 'Browser']) await expect(surfaceRow(page).getByRole('button', { name, exact: true })).toBeEnabled();
      await surfaceRow(page).getByRole('button', { name: 'More surfaces', exact: true }).click();
      // UX2: non-primary tools and the Session actions submenu share one More menu. Artifacts is the project Library card; Log is internal.
      expect((await page.getByRole('menuitem').allTextContents()).sort()).toEqual(['Subagents', 'Background work', 'Session info', 'Tasks', 'Source control', 'Side', 'Session actions'].sort());
      await page.keyboard.press('Escape');
      expect(maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
    });
  });
});

// ---- P3-G: the floating session card (the P3-G execution document, M1; acceptance 1 to 5 and 7) ----------------------------

const USAGE = 'Usage reset countdown'; // nine-sessions.json: its turn ends at 8 s on the scenario clock
const USAGE_ID = 'app-59505fdc';

async function advanceTo(app: ElectronApplication, ms: number): Promise<void> {
  await app.evaluate((_electron, ms) => {
    const scenario = (globalThis as { __maws_scenario?: { advanceTo(ms: number): void } }).__maws_scenario;
    if (!scenario) throw new Error('no scenario clock');
    scenario.advanceTo(ms);
  }, ms);
}

// A pointer drag of `element` from its centre by `dx`, `dy` px (pointer capture, as a person drags it).
async function dragBy(page: Page, element: Locator, dx: number, dy = 0): Promise<void> {
  const box = (await element.boundingBox())!;
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}

test.describe('the floating session card (P3-G)', () => {
  test('the divider, ⌥⌘B, the Float button, Close, the pill and Dock; one composer; over a DOM tool', async () => {
    await withScenario(async (maws, panel) => {
      const { page, app } = maws;
      const main = page.locator('[data-region="main"]');
      const card = panel.getByRole('region', { name: 'Session card' });
      const pill = panel.getByRole('button', { name: 'Show session card' });
      const composers = page.locator(`section[data-composer="${USAGE_ID}"]`);
      const divider = panel.getByRole('separator', { name: 'Resize right panel' });
      const mainWidth = () => main.evaluate((el) => el.getBoundingClientRect().width);

      await (await sidebarRow(page, USAGE)).click();
      // UX2 optional surfaces: the divider and Float controls belong to an explicitly opened tool, not resting cards.
      await openSurface(page, 'Files');
      await expect(main.getByRole('textbox', { name: 'Message' })).toBeVisible();

      await test.step('acceptance 1: 39 px past the maximum leaves the panel at its maximum; 40 px floats it', async () => {
        const max = Number(await divider.getAttribute('aria-valuemax'));
        const width = Number(await divider.getAttribute('aria-valuenow'));
        await dragBy(page, divider, -(max - width) - 39);
        await expect(divider).toHaveAttribute('aria-valuenow', String(max));
        await expect(card).toHaveCount(0);
        await dragBy(page, divider, -40);
        await expect(card).toBeVisible();
        await expect(card.getByRole('heading', { name: USAGE })).toBeVisible();
        await expect(card.locator('[data-transcript-scroller]')).toBeVisible();
        await expect(card.getByRole('textbox', { name: 'Message' })).toBeVisible();
        await expect(main).toHaveAttribute('inert', '');
        expect(await mainWidth(), 'the main region at 0 px').toBe(0);
        await expect(divider, 'no divider while floating').toHaveCount(0);
      });

      await test.step('acceptance 5: the card is the session’s one composer, and it has the keyboard', async () => {
        await expect(composers).toHaveCount(1);
        await expect(card.locator(`section[data-composer="${USAGE_ID}"]`)).toHaveCount(1);
        await expect(card.getByRole('textbox', { name: 'Message' })).toBeFocused();
      });

      await test.step('acceptance 2: ⌥⌘B and the Float button dock a floating panel and float a docked one', async () => {
        // The menu item by id: Playwright's synthetic Meta+Alt+B reaches the page, never the macOS menu's key equivalent
        // (tried here at M1's review: the card stayed up), as shell.spec.ts notes for every menu chord
        await menu(app, 'panel.float');
        await expect(card).toHaveCount(0);
        await expect(main).not.toHaveAttribute('inert', '');
        await menu(app, 'panel.float');
        await expect(card).toBeVisible();
        await panel.getByRole('button', { name: 'Dock session', pressed: true }).click(); // the header's Float, pressed
        await expect(card).toHaveCount(0);
        await panel.getByRole('button', { name: 'Float conversation over surface' }).click();
        await expect(card).toBeVisible();
      });

      await test.step('acceptance 3 and 2: Close leaves the pill; ⌥⌘B and a click reopen the card; a turn ending behind the pill marks it', async () => {
        await card.getByRole('button', { name: 'Close session card' }).click();
        await expect(card).toHaveCount(0);
        await expect(pill).toHaveText(USAGE);
        await expect(composers, 'the compact composer remains usable').toHaveCount(1);
        const compact = panel.getByRole('region', { name: 'Compact session composer' });
        await compact.getByRole('textbox', { name: 'Message' }).fill('Continue from the compact composer');
        await menu(app, 'panel.float');
        await expect(card).toBeVisible();
        await expect(card.getByRole('textbox', { name: 'Message' })).toHaveText('Continue from the compact composer');
        await card.getByRole('textbox', { name: 'Message' }).fill('');
        await card.getByRole('button', { name: 'Close session card' }).click();
        await expect(pill.locator('[aria-label="Unread"]')).toHaveCount(0);
        await advanceTo(app, 8000);
        await expect(pill.locator('[aria-label="Unread"]')).toHaveCount(1);
        await pill.click();
        await expect(card).toBeVisible();
        await expect(pill).toHaveCount(0);
      });

      await test.step('acceptance 7: over a DOM tool the card floats 16 px from the panel’s right and bottom edges', async () => {
        await openSurface(page, 'Session info');
        await closeSurface(page, 'Files'); // Keep one tool for this floating-card contract, not the separate stacking case.
        await expect(panel.locator(`[data-session-info="${USAGE_ID}"]`)).toBeVisible();
        await expect(card).toBeVisible();
        // P4-B3 (parent Decision Log 15.7): the card sits at the panel body's bottom right (it sat at the bottom left)
        const near = async () => {
          const [region, box] = [(await panel.boundingBox())!, (await card.boundingBox())!];
          return { right: Math.round(region.x + region.width - (box.x + box.width)), bottom: Math.round(region.y + region.height - (box.y + box.height)) };
        };
        // The region's 1 px border is on its left, outside the card's side
        expect(await near()).toEqual({ right: 16, bottom: 16 });
        await openSurface(page, 'Files');
        await closeSurface(page, 'Session info');
        await expect(surface(page, 'files').getByRole('tree')).toBeVisible();
        await expect(surface(page, 'files').getByRole('treeitem').first(), 'the real scratch root renders behind the card').toBeVisible();
        expect(await near()).toEqual({ right: 16, bottom: 16 });
        // M1 review: at its largest (its top edge dragged to the window's top) the card stops 16 px under the tool body's
        // top, so the strip above it and its controls stay clear
        const handle = card.locator('[data-card-resize="top-left"]'); // P4-B3: the corner mirrored with the card
        const from = (await handle.boundingBox())!;
        await dragBy(page, handle, -2000, 1 - from.y);
        const [strip, body, box] = [
          (await surface(page, 'files').locator('[data-editor-header]').boundingBox())!,
          (await panel.locator('#panel-host-body-files').boundingBox())!,
          (await card.boundingBox())!,
        ];
        expect(Math.round(box.y - body.y), 'the card’s top 16 px under the tool body’s').toBe(16);
        expect(box.y, 'the card below the strip').toBeGreaterThan(strip.y + strip.height);
        await surfaceRow(page).getByRole('button', { name: 'More surfaces', exact: true }).click({ trial: true }); // nothing covers it
        expect(await near()).toEqual({ right: 16, bottom: 16 });
      });

      await test.step('acceptance 4: Dock restores the column at its width, and the main pane’s composer has the keyboard', async () => {
        await card.getByRole('button', { name: 'Dock session' }).click();
        await expect(card).toHaveCount(0);
        await expect(main).not.toHaveAttribute('inert', '');
        await expect(divider).toHaveAttribute('aria-valuenow', (await divider.getAttribute('aria-valuemax'))!);
        await expect(main.getByRole('textbox', { name: 'Message' })).toBeFocused();
        await expect(composers).toHaveCount(1);
      });
      expect(maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
    }, { filesFor: USAGE });
  });

  // The whole-branch review: at its minimum size a docked request and the composer are taller than the card. The card's
  // body scrolls (a person's wheel, not a programmatic scroll, which would also move the clipping frame), so every
  // control of the request and the composer can be brought into the card's visible rect; the header stays in place.
  test('at its minimum size the card’s body scrolls to a docked request’s controls and the composer', async () => {
    await withScenario(async (maws, panel) => {
      const { page, app } = maws;
      const card = panel.getByRole('region', { name: 'Session card' });
      const body = card.locator('[data-pane="card"]');
      const request = card.getByRole('group', { name: 'Approval needed' });

      await (await sidebarRow(page, SIDEBAR_DRAG)).click(); // its permission is pending in nine-sessions.json
      await openSurface(page, 'Files'); // UX2: floating must have a real surface behind the card.
      await menu(app, 'panel.float');
      await expect(request.getByTestId('request-input')).toHaveText('git log --oneline');
      const handle = card.locator('[data-card-resize="top-left"]'); // P4-B3: the corner mirrored with the card
      await dragBy(page, handle, 2000, 2000);
      const frame = (await card.boundingBox())!;
      expect([Math.round(frame.width), Math.round(frame.height)], 'the card at its minimum').toEqual([360, 240]);

      const box = (await body.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, 2000);
      // Each control's centre is inside the body's rect and is what a click there would reach.
      const reachable = (selector: string) =>
        card.evaluate((cardElement, selector) => {
          const view = cardElement.querySelector('[data-pane="card"]')!.getBoundingClientRect();
          return Array.from(cardElement.querySelectorAll<HTMLElement>(selector))
            .filter((element) => element.getClientRects().length > 0)
            .map((element) => {
              const r = element.getBoundingClientRect();
              const [x, y] = [r.left + r.width / 2, r.top + r.height / 2];
              const inside = x > view.left && x < view.right && y > view.top && y < view.bottom;
              return `${element.getAttribute('aria-label') ?? element.textContent?.trim()}: ${inside && element.contains(document.elementFromPoint(x, y))}`;
            });
        }, selector);
      await expect.poll(() => reachable('[data-docked-frame] button')).not.toContainEqual(expect.stringMatching(/: false$/));
      expect(await reachable('[data-docked-frame] button'), 'the request has buttons').not.toEqual([]);
      const composer = await card.locator('section[data-composer]').boundingBox();
      expect(composer!.y + composer!.height, 'the composer’s bottom inside the card').toBeLessThanOrEqual(box.y + box.height + 1);
      expect(await card.evaluate((element) => element.scrollTop), 'the card itself never scrolls').toBe(0);
      await expect(card.getByRole('heading', { name: SIDEBAR_DRAG })).toBeInViewport();
      expect(maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
    });
  });
});

// ---- P4-B3: the main split's float (docs/doperpowers/plans/2026-10-20-p4-b3-layout.md, M6; the P4 composite's §2 item 5) -

// A session read from the engine's store (index mode, a scratch config home: maws-tools' scene), its transcript forty
// exchanges long, several screens in a pane, so the round trip's scroll rule has a place to keep.
const FLOAT_TITLE = 'P4-B3 float: a chat beside a wide tab';
async function withLongSession(body: (s: Scene, id: AppSessionId) => Promise<void>): Promise<void> {
  const scratch = scratchProject({ titles: [FLOAT_TITLE], label: 'p4b3-float' });
  try {
    const engineId = scratch.engineIds[0]!;
    const t = transcript({ sessionId: engineId, cwd: scratch.repo, start: Date.UTC(2026, 9, 20, 9, 0, 0) });
    const uuid = (k: number, n: number) => `b3f10000-0000-4000-8000-${String(k * 10 + n).padStart(12, '0')}`;
    t.user(uuid(0, 0), FLOAT_TITLE);
    for (let k = 1; k <= 40; k++) {
      t.text(uuid(k, 1), `Answer ${k}. ${'A paragraph long enough to wrap over a few lines in the narrower card. '.repeat(3)}`);
      t.turnEnd(uuid(k, 2));
      t.user(uuid(k, 3), `Question ${k + 1}`);
    }
    t.text(uuid(41, 1), 'The last answer.');
    t.turnEnd(uuid(41, 2));
    seedTranscript(scratch.config, scratch.repo, engineId, t.records);
    const s = await launchScene(scratch);
    try {
      await s.maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())!.setContentSize(1440, 860));
      await s.page.waitForFunction(() => window.innerWidth === 1440 && window.innerHeight === 860);
      await body(s, s.ids[0]!);
    } catch (error) {
      await s.maws.cleanup();
      throw error;
    }
    await closeScene(s);
  } finally {
    rmSync(scratch.root, { recursive: true, force: true });
  }
}

// The id of the first transcript row in view at the scroller's top, and whether the scroller rests at its end.
const firstRowInView = (scroller: Locator) =>
  scroller.evaluate((el) => {
    const top = el.getBoundingClientRect().top;
    const rows = Array.from(el.querySelectorAll<HTMLElement>('[data-row-id]'))
      .map((row) => ({ id: row.dataset.rowId!, box: row.getBoundingClientRect() }))
      .filter((row) => row.box.bottom > top + 1)
      .sort((a, b) => a.box.top - b.box.top);
    return rows[0]?.id ?? null;
  });
const atEnd = (scroller: Locator) => scroller.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 2);

// The most composers of `id` the page held at once since this call, sampled after every DOM change.
async function watchComposers(page: Page, id: string): Promise<() => Promise<number>> {
  await page.evaluate((id) => {
    const w = window as unknown as { __b3Composers: number };
    const count = () => (w.__b3Composers = Math.max(w.__b3Composers, document.querySelectorAll(`section[data-composer="${id}"]`).length));
    w.__b3Composers = 0;
    count();
    new MutationObserver(count).observe(document.body, { childList: true, subtree: true });
  }, id);
  return () => page.evaluate(() => (window as unknown as { __b3Composers: number }).__b3Composers);
}

test.describe('the main split’s float (P4-B3)', () => {
  test('the divider holds a session at 320, arms past 160, disarms, floats on release; the card at the bottom right; the round trip; Close, the pill, ⌥⌘B; the panel card at the bottom right', async () => {
    test.setTimeout(120_000);
    await withLongSession(async (s, id) => {
      const { page } = s;
      const app = s.maws.app;
      const main = page.locator('[data-region="main"]');
      const area = page.locator('[data-main-area]');
      const divider = main.getByRole('separator', { name: 'Resize panes' });
      const card = main.getByRole('region', { name: 'Session card' });
      const outline = main.locator('[data-split-card-outline]'); // LC-3: the card's place while the drag is armed
      const pill = main.getByRole('button', { name: 'Show session card' });
      const composers = page.locator(`section[data-composer="${id}"]`);
      const left = page.locator('[data-pane="0"]');
      const right = page.locator('[data-pane="1"]');
      // the left column's width, as the main area's grid lays it out (a collapsed pane's body keeps its width, hidden)
      const leftWidth = () => area.evaluate((el) => Math.round(parseFloat(getComputedStyle(el).gridTemplateColumns.split(' ')[0]!)));
      const valueNow = async () => Number(await divider.getAttribute('aria-valuenow'));
      const corner = async (of: Locator, within: Locator) => {
        const [region, box] = [(await within.boundingBox())!, (await of.boundingBox())!];
        return { right: Math.round(region.x + region.width - (box.x + box.width)), bottom: Math.round(region.y + region.height - (box.y + box.height)) };
      };

      // The session in the left pane; Diagnostics (a tab of no session, so it only ever clamps) moved into the right one
      await show(s, id);
      await menu(app, 'diagnostics.open');
      await menu(app, 'pane.split');
      await expect(mainTabs(page).getByRole('tablist', { name: 'Right pane tabs' }).getByRole('tab', { name: /^Diagnostics/ })).toBeVisible();
      await expect(left.locator(`section[data-composer="${id}"]`)).toBeVisible();
      const paneScroller = left.locator('[data-transcript-scroller]');
      await expect(paneScroller.locator('[data-row-id]').first()).toBeVisible();

      // The draft, and a reader several screens up, in the pane
      const DRAFT = 'kept across the round trip';
      await left.getByRole('textbox', { name: 'Message' }).click();
      await page.keyboard.type(DRAFT);
      const scrollerBox = (await paneScroller.boundingBox())!;
      await page.mouse.move(scrollerBox.x + scrollerBox.width / 2, scrollerBox.y + scrollerBox.height / 2);
      await page.mouse.wheel(0, -2500);
      await expect(left.getByRole('button', { name: 'Jump to latest' })).toBeVisible();
      await expect.poll(() => atEnd(paneScroller)).toBe(false);
      const maxComposers = await watchComposers(page, id);

      const region = (await area.boundingBox())!;
      const r0 = await valueNow();
      expect(region.width, 'the main area is wide enough for both floors and a drag to 400').toBeGreaterThanOrEqual(720);

      // The reader's row as the pane is held at its floor is the place a float carries: the narrowing from r0 re-wraps
      // the rows, and the transcript's own anchoring may move the row at the top by one as it does (any resize, before P4).
      let heldRow: string | null = null;
      await test.step('the drag: 400 follows the pointer, 200 holds at 320, 159 arms, 161 disarms at 320 as it was, release at 150 floats', async () => {
        const box = (await divider.boundingBox())!;
        const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        // the pointer where the left pane's pointer-implied width is `implied` px (its width at pointer-down plus the travel)
        const to = (implied: number) => page.mouse.move(from.x + implied - r0, from.y, { steps: 4 });
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await to(400);
        await expect.poll(valueNow).toBe(400);
        expect(await leftWidth()).toBe(400);
        await to(200);
        await expect.poll(valueNow, 'held at S_MIN_PX').toBe(320);
        expect(await leftWidth()).toBe(320);
        await expect.poll(() => paneScroller.evaluate((el) => el.clientWidth)).toBeLessThanOrEqual(320);
        heldRow = await firstRowInView(paneScroller);
        expect(heldRow, 'a row in view').not.toBeNull();
        await to(159);
        await expect.poll(leftWidth, 'armed: the session’s column collapsed live').toBe(0);
        expect(Math.round((await right.locator(':scope > [role="tabpanel"]').boundingBox())!.width), 'the other pane spans the area').toBeGreaterThanOrEqual(Math.round(region.width) - 1);
        await expect(composers, 'S stays mounted while armed').toHaveCount(1);
        await expect(card, 'no card before release').toHaveCount(0);
        await expect(outline, 'LC-3: the card’s outline while armed').toBeVisible();
        await to(161);
        await expect.poll(leftWidth, 'disarmed: back at the floor').toBe(320);
        await expect(outline, 'a disarm takes the outline away').toHaveCount(0);
        expect(await firstRowInView(paneScroller), 'a disarm is lossless: the same row at the top').toBe(heldRow);
        await to(150);
        await expect.poll(leftWidth).toBe(0);
        const outlined = (await outline.boundingBox())!;
        await page.mouse.up();
        await expect(card).toBeVisible();
        await expect(outline).toHaveCount(0);
        const opened = (await card.boundingBox())!;
        for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(opened[key] - outlined[key]), `the card opens on its outline (${key})`).toBeLessThanOrEqual(1);
        await expect(divider, 'no divider while floating').toHaveCount(0);
      });

      const cardScroller = card.locator('[data-transcript-scroller]');
      await test.step('the card: at the main area’s bottom right, the session’s one composer with the keyboard, the draft and the reader’s row', async () => {
        expect(await corner(card, area)).toEqual({ right: 16, bottom: 16 });
        await expect(card.getByRole('textbox', { name: 'Message' })).toBeFocused();
        await expect(card.getByRole('textbox', { name: 'Message' })).toHaveText(DRAFT);
        await expect(composers).toHaveCount(1);
        await expect.poll(() => firstRowInView(cardScroller), 'the same row at the top').toBe(heldRow);
        await expect(card.getByRole('button', { name: 'Jump to latest' })).toBeVisible();
      });

      await test.step('Dock: the split at r0 to the pixel; the text typed in the card and the card’s row in the pane', async () => {
        await page.keyboard.type(' and in the card');
        const box = (await cardScroller.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, -600);
        let cardRow: string | null = null;
        await expect.poll(async () => (cardRow = await firstRowInView(cardScroller))).not.toBe(heldRow);
        await card.getByRole('button', { name: 'Dock session' }).click();
        await expect(card).toHaveCount(0);
        await expect.poll(valueNow, 'the ratio at pointer-down').toBe(r0);
        expect(await leftWidth()).toBe(r0);
        await expect(left.getByRole('textbox', { name: 'Message' })).toBeFocused();
        await expect(left.getByRole('textbox', { name: 'Message' })).toHaveText(`${DRAFT} and in the card`);
        await expect.poll(() => firstRowInView(paneScroller), 'the card’s row').toBe(cardRow);
        await expect(composers).toHaveCount(1);
      });

      await test.step('a reader at the end floats and stays at the end', async () => {
        await left.getByRole('button', { name: 'Jump to latest' }).click();
        await expect.poll(() => atEnd(paneScroller)).toBe(true);
        const box = (await divider.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(region.x + 100, box.y + box.height / 2, { steps: 6 });
        await page.mouse.up();
        await expect(card).toBeVisible();
        await expect.poll(() => atEnd(cardScroller)).toBe(true);
        await expect(card.getByRole('button', { name: 'Jump to latest' })).toHaveCount(0);
      });

      await test.step('Close leaves the pill at the bottom right with no composer behind it; the pill reopens the card', async () => {
        await card.getByRole('button', { name: 'Close session card' }).click();
        await expect(card).toHaveCount(0);
        await expect(pill).toBeVisible();
        expect(await corner(main.getByRole('region', { name: 'Compact session composer' }), area)).toEqual({ right: 16, bottom: 16 });
        await expect(composers, 'the compact composer remains usable').toHaveCount(1);
        await pill.click();
        await expect(card).toBeVisible();
        await expect(card.getByRole('textbox', { name: 'Message' })).toBeFocused();
      });

      await test.step('⌥⌘B docks the split card first; a second press floats the panel, its card at the panel’s bottom right', async () => {
        await menu(app, 'panel.float');
        await expect(card).toHaveCount(0);
        await expect.poll(valueNow).toBe(r0);
        await expect(left.locator(`section[data-composer="${id}"]`)).toBeVisible();
        await expect.poll(() => atEnd(paneScroller), 'docked at the end').toBe(true);
        const panelCard = s.panel.getByRole('region', { name: 'Session card' });
        await expect(panelCard).toHaveCount(0);
        await openSurface(page, 'Session info'); // UX2 has no implicit empty panel to float.
        await menu(app, 'panel.float');
        await expect(panelCard).toBeVisible();
        await expect(panelCard.getByRole('textbox', { name: 'Message' })).toHaveText(`${DRAFT} and in the card`);
        expect(await corner(panelCard, s.panel)).toEqual({ right: 16, bottom: 16 });
        await menu(app, 'panel.float');
        await expect(panelCard).toHaveCount(0);
        await expect(composers).toHaveCount(1);
      });
      expect(await maxComposers(), 'never two composers of the session at once').toBe(1);
    });
  });
});

// ---- P3-G: the panel header and the editor host contract (the P3-G execution document, M3; acceptance 9 and 10) ---------

test.describe('the panel header and X32 (P3-G)', () => {
  test.use({ mawsEnv: HARNESS_ENV });

  test('the header shows a tool’s title, and an editor’s registration with its handlers, updates, disposal and closeGuard', async ({ maws }) => {
    const panel = await PanelPage.open(maws);
    const header = surface(panel.page, 'harness-editor').locator('[data-editor-header]');
    const title = header.locator('[data-header-title]');
    const stubHeader = surface(panel.page, 'harness-stub').locator('[data-editor-header]');
    const invoked = () => panel.page.evaluate(() => (window as unknown as PanelWindow).__maws_harness!.panel!.editor.invoked());
    const setEditor = (patch: Parameters<PanelHarnessApi['editor']['set']>[0]) =>
      panel.page.evaluate((patch) => (window as unknown as PanelWindow).__maws_harness!.panel!.editor.set(patch), patch);
    await test.step('resting cards reserve no header; an opened tool keeps its title and controls', async () => {
      await expect(panel.summary).toBeVisible();
      await expect(panel.region.locator('[data-editor-header]')).toHaveCount(0);
      await panel.call('addTool', 'harness-stub');
      // A multi-instance plain tool is named by its selected tab, not a duplicate metadata title.
      await expect(stubHeader.getByRole('tab', { name: 'Stub', exact: true, selected: true })).toBeVisible();
      await expect(stubHeader.locator('[data-header-title]')).toHaveCount(0);
      for (const name of ['Float conversation over surface', 'Expand surface', 'Close surface']) await expect(stubHeader.getByRole('button', { name })).toBeVisible();
    });

    const editor = await panel.call('addTool', 'harness-editor');
    await closeSurface(panel.page, 'Stub'); // Keep the editor primary while testing its region controls.
    await test.step('acceptance 9: the registration’s breadcrumb, saved state, count, actions and Export, each invoking its handler', async () => {
      await panel.call('maximize', true); // room for the whole left side
      await expect(title).toHaveText('Q3 brief');
      await expect(header.locator('[data-header-breadcrumb]')).toHaveText('Docs/Planning/');
      await expect(header.locator('[data-header-breadcrumb]')).toBeVisible();
      await expect(header.getByText('Saving…')).toBeVisible();
      await header.getByRole('button', { name: '3 open comments' }).click();
      await header.getByRole('button', { name: 'Version history' }).click();
      await header.getByRole('button', { name: 'Open in tab' }).click();
      await header.getByRole('button', { name: 'Export' }).click();
      await expect(panel.page.getByRole('menuitem')).toHaveText(['PDF', 'Word document']);
      await panel.page.getByRole('menuitem', { name: 'PDF' }).click();
      expect(await invoked()).toEqual(['comments', 'history', 'open-in-tab', 'export:pdf']);
    });

    await test.step('acceptance 9: an update to saved shows "All changes saved"; disposal returns the plain title', async () => {
      await setEditor({ saved: 'saved' });
      await expect(header.getByText('All changes saved')).toBeVisible();
      await setEditor({ registered: false });
      await expect(title).toHaveText('Editor');
      await expect(header.getByText('All changes saved')).toHaveCount(0);
      await expect(header.getByRole('button', { name: 'Export' })).toHaveCount(0);
      await setEditor({ registered: true });
      await expect(title).toHaveText('Q3 brief');
    });

    await test.step('the header at the panel’s narrowest: three actions and Export fold into "More actions", the title keeps its room', async () => {
      await setEditor({ unresolved: 0 }); // the comments action is an ordinary action again: three actions plus Export
      await panel.call('setWidth', 280); // restored from maximized too
      for (const name of ['Float conversation over surface', 'Expand surface', 'Close surface']) await expect(header.getByRole('button', { name })).toBeInViewport();
      await expect(title).toBeVisible();
      expect(await title.evaluate((el) => el.scrollWidth - el.clientWidth), 'the title is whole, not truncated').toBeLessThanOrEqual(0);
      for (const name of ['Version history', 'Open in tab', 'Comments', 'Export']) await expect(header.getByRole('button', { name })).toHaveCount(0);
      const overflow = await header.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(overflow, 'nothing spills past the header').toBeLessThanOrEqual(0);
      await header.getByRole('button', { name: 'More actions' }).click();
      await expect(panel.page.getByRole('menuitem')).toHaveText(['Version history', 'Open in tab', 'Comments', 'PDF', 'Word document']);
      await panel.page.getByRole('menuitem', { name: 'Word document' }).click();
      expect((await invoked()).at(-1)).toBe('export:docx');
      await panel.call('setWidth', 380);
      await expect(header.getByRole('button', { name: 'Export' })).toBeVisible();
      await setEditor({ unresolved: 3 });
    });

    await test.step('acceptance 9: a closeGuard answering false keeps the tab open', async () => {
      await setEditor({ allowClose: false });
      // UX2 singletons have no fake tab strip: close the retained ref through the host's actual guarded close API.
      expect(await panel.call('closeTab', editor), 'the guard vetoes').toBe(false);
      expect(await panel.ids()).toContain(editor);
      await expect(title).toHaveText('Q3 brief');
      // Switched away, the editor's body unmounts; its registration stays with the tab, and its guard still vetoes.
      await openSurface(panel.page, 'Stub');
      await closeSurface(panel.page, 'Editor'); // Close surface hides, rather than discarding the guarded editor ref.
      await expect(stubHeader.getByRole('tab', { name: 'Stub', exact: true, selected: true })).toBeVisible();
      await expect(surface(panel.page, 'harness-editor')).toHaveCount(0);
      expect(await panel.call('closeTab', editor), 'the inactive ref’s guard vetoes').toBe(false);
      expect(await panel.ids()).toContain(editor);
      await panel.call('selectTab', editor);
      await setEditor({ allowClose: true });
      expect(await panel.call('closeTab', editor), 'the confirmed close releases the editor').toBe(true);
      await expect.poll(() => panel.ids()).not.toContain(editor);
      await expect(stubHeader.getByRole('tab', { name: 'Stub', exact: true, selected: true })).toBeVisible();
    });
    panel.expectQuietConsole();
  });
});
