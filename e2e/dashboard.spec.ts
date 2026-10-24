// The dashboard editor in the product app (P3-E2 M3 of docs/doperpowers/plans/2026-10-16-p3-e2-dashboard.md, "Proof";
// `pnpm e2e:dashboard`, the product build, MAWS_HARNESS=0). A dashboard opens through L's registry in an `artifact` main
// tab and in the panel's Artifacts tool as two replicas of one host doc; its chart and table blocks draw E's renderer
// over real data (M1's vendored World Bank and penguin tables, Korean labels included) with their source labels; the
// narrow panel scrolls a figure rather than shrinking its text; the real editor's hover reaches a scatter's last point
// and a hatched bar's own value; eight series draw as named small multiples on one scale, a filter to the first and last
// keeping their names, hover reaching the last panel with its tip shown whole in the frame's visible box (a long, wrapping
// tip too, at a scrolled right-edge point near the frame's bottom); the keyboard opens and closes the source sheet from a
// label; the sheet copies its rows,
// downloads the snapshot's own bytes through main's save, and stays on the snapshot it opened on while the dataset is
// replaced, both views redrawing; the header's Datasets lists the datasets. M6 extends this group with the agent's path
// (artifact_create, artifact_dataset), comments, history and exports.
//
// The data is bound as `artifact_dataset` binds it (an uploaded asset and its descriptor in the doc's `datasets` root),
// written here through the human's upload and the host's MAWS_E2E test writer, since this milestone's proof is the
// editor's; the agent's tool is M2's (unit-proved) and M6's (product). Evidence shots go to test-results/dashboard-proof/.
import { openArtifactReplicaInPanel } from './support/shell';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { GDP_CSV, PENGUINS_CSV } from '../src/artifacts/dashboard/fixtures/datasets';
import { DatasetError, parseDataset } from '../src/artifacts/dashboard/parse';
import { launchMaws, type MawsLaunch } from './support/launch';
import { sidebarRow } from './support/sidebar';
import { bindCsv, commentSelectedChart, durable, openInMain, openInPanel, selectPanelSession, railOf, refusalOf, reply, revisionOf, selectChart, startApp, toggleDatasets, watchSelection, type DashboardApp } from './support/dashboards'; // M6

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
async function ok<T>(page: Page, name: string, input?: unknown): Promise<T> {
  const result = (await page.evaluate(([n, i]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke(n as string, i), [name, input] as const)) as Result<T>;
  if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
  return result.value;
}
const hostState = (page: Page) => ok<{ state: string }>(page, 'engine.hostState');

const PROOF = 'test-results/dashboard-proof';
const SESSIONS = 'stub:test/fixtures/panel/harness-sessions.json';
let launch: MawsLaunch | null = null;
let userData: string | null = null;
let saved: string | null = null;
test.afterEach(async () => {
  await launch?.cleanup();
  launch = null;
  for (const dir of [userData, saved]) if (dir) rmSync(dir, { recursive: true, force: true });
  userData = saved = null;
});

async function start(): Promise<Page> {
  mkdirSync('/tmp/maws-harness/a', { recursive: true }); // session A's directory in the scenario
  mkdirSync(PROOF, { recursive: true });
  userData = mkdtempSync('/tmp/maws-e2e-dashboard-');
  saved = mkdtempSync('/tmp/maws-e2e-dashboard-saved-');
  launch = await launchMaws({ userData, env: { MAWS_HARNESS: '0', MAWS_SESSION_SOURCE: SESSIONS, MAWS_E2E_SAVE_PATH: saved } });
  const { page } = launch;
  await expect.poll(async () => (await hostState(page)).state, { timeout: 20_000, message: 'the engine host is ready' }).toBe('ready');
  return page;
}

/** Binds `csv` as dataset `id`: the bytes uploaded as the dashboard's asset, the descriptor written as artifact_dataset writes it. */
let writes = 0;
async function bind(page: Page, artifactId: string, id: string, title: string, name: string, csv: string): Promise<string> {
  const bytes = new TextEncoder().encode(csv);
  const parsed = parseDataset(bytes, 'csv');
  if (parsed instanceof DatasetError) throw new Error(parsed.reason);
  const { ref } = (await page.evaluate(
    ([a, n, b]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<{ ok: boolean; value: { ref: string } }> } }).maws.invoke('artifacts.uploadAsset', { artifactId: a, name: n, mime: 'text/csv', bytes: new Uint8Array(b as number[]) }).then((r) => r.value),
    [artifactId, name, [...bytes]] as const,
  )) as { ref: string };
  const at = Date.now();
  const descriptor = {
    title,
    source: { kind: 'file', ref, name, format: 'csv', sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length },
    columns: parsed.columns,
    rows: parsed.rows.length,
    updated: { at, by: { kind: 'human' } },
    state: { status: 'ok', at },
  };
  await ok(page, 'artifacts.testWrite', { artifactId, opId: `dashboard-bind-${++writes}`, ops: [{ op: 'setAttr', root: 'datasets', key: id, value: descriptor }] });
  return ref;
}

const chart = (source: string, spec: Record<string, unknown>) => ({ type: 'chart', attrs: { source, spec } });
const VIEWS = [
  chart('gdp', { view: 'bar', x: 'country_ko', y: 'growth_pct', filter: [{ column: 'year', op: 'eq', value: 2024 }], sort: { by: 'growth_pct', dir: 'desc' }, title: '2024년 실질 GDP 성장률 (%)' }),
  chart('gdp', { view: 'table', columns: ['country_ko', 'year', 'growth_pct'], filter: [{ column: 'year', op: 'eq', value: 2020 }], sort: { by: 'growth_pct', dir: 'asc' }, title: '2020년 성장률, 낮은 순' }),
  chart('penguins', { view: 'scatter', x: 'flipper_length_mm', y: 'body_mass_g', series: 'species_ko', title: '펭귄 344마리의 날개 길이와 체중' }),
  chart('penguins', { view: 'bar', x: 'island_ko', series: 'species_ko', agg: 'count', title: '섬별 종의 관측 수' }),
  // eight countries, past the six forms: labelled small multiples (parent Decision Log 27); then its first and last alone
  chart('gdp', { view: 'line', x: 'year', y: 'growth_pct', series: 'country_ko', format: { year: 'text' }, title: '8개국 GDP 성장률, 2019–2024 (%)' }),
  chart('gdp', { view: 'line', x: 'year', y: 'growth_pct', series: 'country_ko', filter: [{ column: 'iso3', op: 'in', value: ['CAN', 'USA'] }], format: { year: 'text' }, title: '캐나다와 미국' }),
  // eight long-named series: the last panel's last point at the figure's right edge, its tip long enough to wrap
  chart('sites', { view: 'line', x: 'x', y: 'level', series: 'site', title: '마라도 관측소 여덟 곳' }),
];
const COUNTRIES = ['캐나다', '독일', '프랑스', '영국', '이탈리아', '일본', '대한민국', '미국']; // the snapshot's order
// A synthetic fixture for tip geometry only (no observations): eight long Korean series names, three falling points each,
// the last series' last point the lowest of all, so its tip has the frame's bottom just below it.
const SITE = (i: number) => `제주특별자치도 서귀포시 대정읍 마라도 등대 앞 선착장 관측소 ${i}`;
const SITES_CSV = `x,level,site\n${Array.from({ length: 24 }, (_, k) => `${k % 3},${3 * (8 - Math.floor(k / 3)) - (k % 3)},${SITE(Math.floor(k / 3) + 1)}`).join('\n')}\n`;

/**
 * Hovers the figure's last drawable point with the real pointer and proves its tip readable (E2's Decision Log 21), not
 * only present: the frame scrolled to the point (a figure wider than its column scrolls in its frame), the point under
 * the pointer, the tip shown with the point's exact value, its rendered box whole inside the frame's visible box and the
 * window, captured by a page clip that neither scrolls nor moves the pointer, and still shown after. The frame's pointer
 * events and the tip's changes are recorded, so a tip that does not show says what hid it.
 */
async function hoverLastPoint(page: Page, figure: Locator, evidence: string) {
  const frame = figure.locator('.dash-figure');
  await figure.locator('svg').evaluate((svg) => svg.scrollIntoView({ block: 'center', inline: 'nearest' }));
  const last = await frame.evaluate((el) => {
    const log: string[] = [];
    (el as HTMLElement & { hoverLog?: string[] }).hoverLog = log;
    for (const type of ['pointerover', 'pointerenter', 'pointermove', 'pointerout', 'pointerleave'])
      el.addEventListener(type, (event) => log.push(`${type} ${(event.target as Element).tagName} ${Math.round((event as PointerEvent).clientX)},${Math.round((event as PointerEvent).clientY)}`), true);
    el.ownerDocument.addEventListener('pointerout', (event) => (event as PointerEvent).relatedTarget === null && log.push('pointer left the window'));
    // the pointer reported anywhere else in the window (the OS cursor resyncing hover, for one)
    for (const type of ['pointermove', 'pointerover'])
      el.ownerDocument.addEventListener(type, (event) => !el.contains(event.target as Node) && log.push(`${type} elsewhere ${(event.target as Element).tagName} ${Math.round((event as PointerEvent).clientX)},${Math.round((event as PointerEvent).clientY)}`), true);
    el.ownerDocument.defaultView!.addEventListener('blur', () => log.push('window blur'));
    el.ownerDocument.defaultView!.addEventListener('focus', () => log.push('window focus'));
    el.ownerDocument.addEventListener('visibilitychange', () => log.push(`visibility ${el.ownerDocument.visibilityState}`));
    const tip = el.querySelector<HTMLElement>('.dash-tip')!;
    // an SVG added to or removed from the frame is a redrawn figure; the tip's own text changes are not
    const svgs = (nodes: NodeList) => Array.from(nodes).some((n) => n.nodeName.toLowerCase() === 'svg');
    new MutationObserver((records) =>
      records.forEach((r) => {
        if (r.type === 'attributes') log.push(`tip ${tip.hidden ? 'hidden' : 'shown'}`);
        else if (r.target === el && (svgs(r.addedNodes) || svgs(r.removedNodes))) log.push('figure redrawn');
      }),
    ).observe(el, { childList: true, attributes: true, attributeFilter: ['hidden'], subtree: true });
    const svg = el.querySelector('svg')!;
    const layer = svg.querySelector('[data-hover="nearest"]')!;
    const [x, y] = layer.getAttribute('data-xy')!.split(' ').at(-1)!.split(',').map(Number);
    const scale = svg.getBoundingClientRect().width / Number(svg.getAttribute('width'));
    // a column narrower than the figure's 480 px minimum scrolls it (run 38940311997): scrolled to the point, as the owner would
    el.scrollLeft = Math.max(0, x * scale - el.clientWidth + 16);
    const box = svg.getBoundingClientRect();
    const at = { x: box.left + x * scale, y: box.top + y * scale };
    const hit = document.elementFromPoint(at.x, at.y);
    const seen = { ...at, figure: [box.left, box.top, box.width, box.height].map(Math.round), frame: [el.clientWidth, el.scrollLeft], viewport: [innerWidth, innerHeight], hit: hit ? `${hit.tagName}.${hit.getAttribute('class') ?? ''}` : null };
    return { ...at, scrollLeft: el.scrollLeft, inFigure: hit !== null && svg.contains(hit), seen: JSON.stringify(seen), tip: layer.getAttribute('data-tips')!.split('\n').at(-1)! };
  });
  expect(last.inFigure, `the last point is on screen, under the figure: ${last.seen}`).toBe(true);
  await page.mouse.move(last.x, last.y);
  const tip = figure.locator('.dash-tip');
  const events = () => frame.evaluate((el) => ((el as HTMLElement & { hoverLog?: string[] }).hoverLog ?? []).join(' | '));
  await expect(tip).toHaveText(last.tip);
  const visible = await tip.waitFor({ state: 'visible', timeout: 3_000 }).then(
    () => true,
    () => false,
  );
  expect(visible, `the tip is shown: ${await events()}`).toBe(true);
  // the tip's rendered box whole inside the frame's visible box (the frame scrolls and clips its figure) and the window
  const shown = await frame.evaluate((el, point) => {
    const box = el.getBoundingClientRect();
    const tipEl = el.querySelector<HTMLElement>('.dash-tip')!;
    const at = tipEl.getBoundingClientRect();
    const visible = {
      left: Math.max(box.left + el.clientLeft, 0),
      top: Math.max(box.top + el.clientTop, 0),
      right: Math.min(box.left + el.clientLeft + el.clientWidth, innerWidth),
      bottom: Math.min(box.top + el.clientTop + el.clientHeight, innerHeight),
    };
    const rendered = { left: at.left, top: at.top, right: at.right, bottom: at.bottom };
    const inside = at.width > 0 && at.height > 0 && rendered.left >= visible.left - 0.5 && rendered.right <= visible.right + 0.5 && rendered.top >= visible.top - 0.5 && rendered.bottom <= visible.bottom + 0.5;
    const style = getComputedStyle(tipEl);
    const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2;
    return {
      inside,
      seen: JSON.stringify({ rendered, visible }),
      clip: { x: visible.left, y: visible.top, width: visible.right - visible.left, height: visible.bottom - visible.top },
      tipHeight: at.height,
      lines: Math.round((at.height - Number.parseFloat(style.paddingTop) - Number.parseFloat(style.paddingBottom)) / lineHeight),
      roomBelow: visible.bottom - point.y,
    };
  }, last);
  expect(shown.inside, `the tip is whole inside the frame's visible box: ${shown.seen}`).toBe(true);
  // The visible frame captured without disturbing the hover. Observed in run 38946147833: during Playwright's CDP capture
  // the page received a window leave that hid the tip ('capture start | pointerout … | pointer left the window |
  // pointerleave … | tip hidden | capture end', no SVG replaced). Why the capture produced it is not proved; the window is
  // the quiet e2e one (transparent, ignoring the mouse: showAppWindow). The pixels are taken by Electron's own surface copy
  // of the page's window instead (capturePage, kept hidden); the log still brackets the capture, so a leave would show.
  const mark = (text: string) => frame.evaluate((el, t) => void (el as HTMLElement & { hoverLog?: string[] }).hoverLog?.push(t), text);
  await mark('capture start');
  // capturePage's rect is in the window's DIPs: the clip's CSS px times the page's actual zoom factor
  const captured = await launch!.app.evaluate(
    async ({ BrowserWindow }, { url, clip }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === url);
      if (!win) throw new Error(`no window shows ${url}`);
      const zoom = win.webContents.getZoomFactor();
      const rect = { x: Math.round(clip.x * zoom), y: Math.round(clip.y * zoom), width: Math.round(clip.width * zoom), height: Math.round(clip.height * zoom) };
      const image = await win.webContents.capturePage(rect, { stayHidden: true });
      return { png: image.toPNG().toString('base64'), zoom, size: image.getSize() };
    },
    { url: page.url(), clip: shown.clip },
  );
  writeFileSync(`${PROOF}/${evidence}.png`, Buffer.from(captured.png, 'base64'));
  // the zoom used and the image's size checked against the clip, so the rect is verified rather than assumed: the image is
  // the clip in DIPs (CSS px × zoom) or in device pixels (CSS px × the page's devicePixelRatio, which includes the zoom)
  const dpr = await page.evaluate(() => devicePixelRatio);
  const near = (scale: number) => Math.abs(captured.size.width - shown.clip.width * scale) <= 2 && Math.abs(captured.size.height - shown.clip.height * scale) <= 2;
  const units = near(captured.zoom) ? 'dip' : near(dpr) ? 'device' : null;
  const sizeNote = { zoom: captured.zoom, devicePixelRatio: dpr, clip: shown.clip, image: captured.size, units };
  writeFileSync(`${PROOF}/${evidence}.json`, JSON.stringify(sizeNote));
  expect(units, `the capture is the visible frame's size: ${JSON.stringify(sizeNote)}`).not.toBeNull();
  await mark('capture end');
  const survived = await tip.waitFor({ state: 'visible', timeout: 1_000 }).then(
    () => true,
    () => false,
  );
  expect(survived, `the hover survives its capture: ${await events()}`).toBe(true);
  await expect(tip).toHaveText(last.tip);
  return { tip: last.tip, scrollLeft: last.scrollLeft, tipHeight: shown.tipHeight, lines: shown.lines, roomBelow: shown.roomBelow };
}

/** The owner's editor in `scope` inserts the blocks after its last one (the editor's own write, through its replica). */
async function insertBlocks(scope: Locator, blocks: unknown[]): Promise<void> {
  await scope.locator('.ds-doc .ProseMirror').first().evaluate((el, content) => {
    const editor = (el as HTMLElement & { editor: { state: { doc: { content: { size: number } } }; commands: { insertContentAt(at: number, content: unknown): boolean } } }).editor;
    editor.commands.insertContentAt(editor.state.doc.content.size, content);
  }, blocks);
}

const figures = (scope: Locator) => scope.locator('.ds-doc figure.dash-view');
const tipsOf = (figure: Locator) => figure.locator('svg [data-tip]').evaluateAll((els) => els.map((el) => el.getAttribute('data-tip')));

test('a dashboard draws its views in the main tab and the panel, hovers every point, and opens its source sheet by keyboard; the sheet copies, downloads and keeps its snapshot across a replacement', async () => {
  test.setTimeout(180_000);
  const page = await start();
  const panel = page.locator('[data-region="panel"]');
  await (await sidebarRow(page, 'Harness A')).click();

  const title = '성장률 대시보드';
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'dashboard', title });
  const id = artifact.id;
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  await page.locator('[data-library]').getByRole('article', { name: title, exact: true }).click({ timeout: 15_000 });
  const main = page.locator(`[data-artifact-tab="${id}"]`);
  await expect(main.locator('.ds-doc .ProseMirror')).toBeVisible({ timeout: 15_000 });
  const mainHeader = page.locator('[data-region="main"] [data-editor-header]');

  const gdpRef = await bind(page, id, 'gdp', '세계은행 GDP 성장률', 'gdp-growth.csv', GDP_CSV);
  await bind(page, id, 'penguins', 'Palmer penguins', 'penguins.csv', PENGUINS_CSV);
  await bind(page, id, 'sites', '마라도 관측소 (합성)', 'sites.csv', SITES_CSV);
  await insertBlocks(main, [{ type: 'paragraph', content: [{ type: 'text', text: '2020년의 급락 이후 대부분의 경제가 회복했다.' }] }, ...VIEWS]);

  await test.step('the main tab draws every view with its caption and source label', async () => {
    await expect(figures(main)).toHaveCount(VIEWS.length);
    for (const figure of await figures(main).all()) await expect(figure.locator('.dash-figure > svg, .dash-figure > table')).toBeVisible({ timeout: 15_000 });
    const bar = figures(main).nth(0);
    await expect(bar.locator('.dash-caption')).toHaveText('2024년 실질 GDP 성장률 (%)');
    expect((await tipsOf(bar))[0]).toBe('미국 · growth_pct: 2.79');
    await expect(bar.locator('button.dash-source-label')).toHaveText(/^세계은행 GDP 성장률 · from gdp-growth\.csv · updated \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC by You$/);
    // the table view is the document's own table, its text selectable: the first 25 rows of the view, noted
    const table = figures(main).nth(1).locator('.dash-figure > table.dash-table');
    await expect(table).toContainText('대한민국');
    await expect(table.locator('tbody tr')).toHaveCount(8);
    expect(await figures(main).nth(1).locator('.dash-figure svg').count()).toBe(0);
    // M1's geometry grade on the real faces: every text's glyph box inside its figure, Korean included
    const outside = await main.locator('.dash-figure svg').evaluateAll((svgs) =>
      svgs.flatMap((svg) => {
        const width = Number(svg.getAttribute('width'));
        const height = Number(svg.getAttribute('height'));
        return Array.from(svg.querySelectorAll('text')).flatMap((text) => {
          const box = (text as SVGTextElement).getBBox();
          return box.x < -0.5 || box.y < -0.5 || box.x + box.width > width + 0.5 || box.y + box.height > height + 0.5 ? [text.textContent] : [];
        });
      }),
    );
    expect(outside, 'no text outside its figure').toEqual([]);
    await main.screenshot({ path: `${PROOF}/main-tab.png` });
    expect(launch!.consoleErrors(), 'the console stays free of errors').toEqual([]);
  });

  let record: Locator | null = null;
  await test.step('the panel, a second replica, draws the same views; a narrow column scrolls a figure rather than shrinking it', async () => {
    await openArtifactReplicaInPanel(page, id);
    const shown = panel.locator(`[data-artifact-record="${id}"]`);
    record = shown;
    await expect(figures(shown)).toHaveCount(VIEWS.length, { timeout: 15_000 });
    await expect(figures(shown).nth(0).locator('svg')).toBeVisible({ timeout: 15_000 });
    expect(await tipsOf(figures(shown).nth(0))).toEqual(await tipsOf(figures(main).nth(0)));
    const frame = figures(shown).nth(0).locator('.dash-figure');
    const sizes = await frame.evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth, svg: el.querySelector('svg')!.getBoundingClientRect().width }));
    expect(sizes.svg, 'the figure keeps its legible size').toBeGreaterThanOrEqual(480);
    if (sizes.client < 480) expect(sizes.scroll, 'the narrow column scrolls the figure').toBeGreaterThan(sizes.client);
    await panel.screenshot({ path: `${PROOF}/panel-narrow.png` });
  });

  await test.step('the real editor\'s hover reaches the scatter\'s last point and a hatched bar\'s own value', async () => {
    const scatter = figures(main).nth(2);
    await scatter.scrollIntoViewIfNeeded();
    const last = await scatter.locator('svg').evaluate((svg) => {
      const layer = svg.querySelector('[data-hover="nearest"]')!;
      const [x, y] = layer.getAttribute('data-xy')!.split(' ').at(-1)!.split(',').map(Number);
      const box = svg.getBoundingClientRect();
      const scale = box.width / Number(svg.getAttribute('width'));
      return { x: box.left + x * scale, y: box.top + y * scale, tip: layer.getAttribute('data-tips')!.split('\n').at(-1)! };
    });
    await page.mouse.move(last.x, last.y);
    await expect(scatter.locator('.dash-tip')).toHaveText(last.tip);
    const counts = figures(main).nth(3);
    const hatch = counts.locator('svg path[data-tip] + path[pointer-events="none"]').first();
    // The figure keeps its 480px legibility floor: a narrow main column must scroll to the same hatched bar.
    await hatch.scrollIntoViewIfNeeded();
    const hatched = await hatch.evaluate((hatch) => {
      const box = hatch.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const hit = hatch.ownerDocument.elementFromPoint(x, y)?.closest('[data-tip]');
      return { x, y, tip: hatch.previousElementSibling!.getAttribute('data-tip')!, hitTip: hit?.getAttribute('data-tip') ?? null };
    });
    expect(hatched.hitTip, 'the visible hatching lets the real pointer reach its bar underneath').toBe(hatched.tip);
    await page.mouse.move(hatched.x, hatched.y);
    await expect(counts.locator('.dash-tip')).toHaveText(hatched.tip);
    await counts.screenshot({ path: `${PROOF}/hatched-hover.png` });
  });

  await test.step('eight series draw as eight named panels on one scale; the first and the last alone stay two named panels; hover reaches the last panel', async () => {
    const panelsOf = (figure: Locator) => figure.locator('svg g[role="group"]').evaluateAll((gs) => gs.map((g) => g.getAttribute('aria-label')));
    const eight = figures(main).nth(4);
    await eight.scrollIntoViewIfNeeded();
    expect(await panelsOf(eight)).toEqual(COUNTRIES);
    expect(await panelsOf(figures(main).nth(5))).toEqual(['캐나다', '미국']);
    await expect.poll(() => panelsOf(figures(record!).nth(4)), { timeout: 15_000, message: 'the panel\'s replica draws the same panels' }).toEqual(COUNTRIES);
    // on the real faces: each panel's name inside its own plot's width, every panel's grid the same heights in its row
    const geometry = await eight.locator('svg').evaluate((svg) =>
      Array.from(svg.querySelectorAll('g[role="group"]')).map((g) => {
        const rules = Array.from(g.querySelectorAll('path')).filter((p) => /^M[\d.]+,[\d.]+H[\d.]+$/.test(p.getAttribute('d') ?? ''));
        const plot = rules[0].getBBox();
        const name = (g.querySelector('text') as SVGTextElement).getBBox();
        const top = Math.min(...rules.map((r) => r.getBBox().y));
        return { inside: name.x >= plot.x - 0.5 && name.x + name.width <= plot.x + plot.width + 0.5, rules: rules.map((r) => Math.round(r.getBBox().y - top)) };
      }),
    );
    expect(geometry.map((p) => p.inside), 'every name inside its panel').toEqual(COUNTRIES.map(() => true));
    for (const p of geometry) expect(p.rules).toEqual(geometry[0].rules);
    await eight.locator('svg').evaluate((svg) => svg.scrollIntoView({ block: 'center', inline: 'nearest' }));
    await eight.screenshot({ path: `${PROOF}/small-multiples.png` });
    const hovered = await hoverLastPoint(page, eight, 'small-multiples-hover');
    expect(hovered.tip).toMatch(/^2024 · 미국 · growth_pct: /);
    await figures(main).nth(5).screenshot({ path: `${PROOF}/small-multiples-pair.png` });
  });

  await test.step('a long name\'s tip wraps and stays whole at a scrolled right-edge point near the frame\'s bottom', async () => {
    const sites = figures(main).nth(6);
    const divider = panel.getByRole('separator', { name: 'Resize right panel', exact: true });
    const defaultWidth = await divider.getAttribute('aria-valuenow');
    // This case deliberately needs a narrow main column, independent of the resting surface's content-sized default.
    await divider.press('End');
    try {
      await expect.poll(() => sites.locator('.dash-figure').evaluate((frame) => frame.scrollWidth - frame.clientWidth), { message: 'the real divider leaves the figure horizontally scrollable' }).toBeGreaterThan(0);
      const hovered = await hoverLastPoint(page, sites, 'long-tip-hover');
      expect(hovered.tip).toBe(`2 · ${SITE(8)} · level: 1`);
      expect(hovered.scrollLeft, 'the frame is scrolled to the point').toBeGreaterThan(0);
      expect(hovered.lines, 'the tip wraps').toBeGreaterThanOrEqual(2);
      expect(hovered.roomBelow, 'too little room below the point: the tip must turn above it').toBeLessThan(hovered.tipHeight + 12);
    } finally {
      await divider.press('Enter'); // the scene started at the surface's default width; return to it for the sheet steps
      await expect(divider).toHaveAttribute('aria-valuenow', defaultWidth!);
    }
  });

  await test.step('the keyboard opens the source sheet from a label, on the view\'s own rows, and closes it, the focus returning', async () => {
    const label = figures(main).nth(0).locator('button.dash-source-label');
    await label.focus();
    await page.keyboard.press('Enter');
    const sheet = main.page().getByRole('dialog', { name: 'Source of 세계은행 GDP 성장률' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'This view’s rows (8)' })).toHaveAttribute('aria-pressed', 'true');
    await expect(sheet.getByRole('table', { name: 'Rows' })).toHaveAttribute('aria-rowcount', '9'); // 2024, sorted as the view
    await expect(sheet.getByRole('row').nth(1)).toContainText('미국');
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    expect(await label.evaluate((el) => el === document.activeElement)).toBe(true);
  });

  await test.step('the sheet sorts and copies its rows, downloads the snapshot\'s own bytes, and keeps its snapshot across a replacement', async () => {
    await figures(main).nth(0).locator('button.dash-source-label').click();
    const sheet = page.getByRole('dialog', { name: 'Source of 세계은행 GDP 성장률' });
    await sheet.getByRole('button', { name: 'All source rows (48)' }).click();
    await expect(sheet.getByRole('table', { name: 'Rows' })).toHaveAttribute('aria-rowcount', '49');
    await sheet.getByRole('button', { name: 'Sort by growth_pct' }).click();
    await sheet.getByRole('button', { name: 'Sort by growth_pct' }).click(); // descending
    await sheet.getByRole('button', { name: 'Copy rows' }).click();
    await expect.poll(() => launch!.app.evaluate(({ clipboard }) => clipboard.readText())).toMatch(/^country\tcountry_ko\tiso3\tyear\tgrowth_pct\n/);
    const text = await launch!.app.evaluate(({ clipboard }) => clipboard.readText());
    expect(text.split('\n')).toHaveLength(50); // the header, 48 rows, the final newline
    await sheet.getByRole('button', { name: 'Download gdp-growth.csv' }).click();
    await expect(sheet.getByRole('status')).toHaveText('Saved to gdp-growth.csv');
    expect(readdirSync(saved!)).toEqual(['gdp-growth.csv']);
    expect(readFileSync(join(saved!, 'gdp-growth.csv'), 'utf8')).toBe(GDP_CSV);
    await page.screenshot({ path: `${PROOF}/source-sheet.png` });

    // the dataset replaced by its 2024 rows alone (a real subset): both replicas' views redraw, the open sheet stays
    const header = GDP_CSV.split('\n')[0];
    const only2024 = `${[header, ...GDP_CSV.split('\n').filter((line) => /,2024,[^,]*$/.test(line))].join('\n')}\n`; // "Korea, Rep." is quoted with its comma
    const replacedRef = await bind(page, id, 'gdp', '세계은행 GDP 성장률', 'gdp-growth.csv', only2024);
    expect(replacedRef).not.toBe(gdpRef);
    await expect(figures(main).nth(1).locator('table caption')).toHaveText('no rows to draw', { timeout: 15_000 }); // the 2020 table, now empty
    await expect(figures(record!).nth(1).locator('table caption')).toHaveText('no rows to draw', { timeout: 15_000 });
    await expect(sheet.getByRole('table', { name: 'Rows' })).toHaveAttribute('aria-rowcount', '49');
    await sheet.getByRole('button', { name: 'Close' }).click();
    await figures(main).nth(0).locator('button.dash-source-label').click();
    await page.getByRole('dialog').getByRole('button', { name: 'All source rows (8)' }).click();
    await expect(page.getByRole('dialog').getByRole('table', { name: 'Rows' })).toHaveAttribute('aria-rowcount', '9');
    await page.keyboard.press('Escape');
  });

  await test.step('the header\'s Datasets opens the sheet on every dataset of the shown document', async () => {
    const datasets = () => toggleDatasets(mainHeader);
    await datasets();
    const picker = page.getByRole('dialog').getByRole('combobox', { name: 'Dataset' });
    await expect(picker.locator('option')).toHaveText(['세계은행 GDP 성장률 (gdp)', 'Palmer penguins (penguins)', '마라도 관측소 (합성) (sites)']);
    await page.screenshot({ path: `${PROOF}/datasets-sheet.png` });
    await datasets();
    await expect(page.getByRole('dialog')).toBeHidden();
  });
  expect(launch!.consoleErrors(), 'the console stays free of errors').toEqual([]);
});

// ---- P3-E2 M6: the agent's path through the real tools (the host's acceptance seam), acceptance 1 to 3 ------------------

const AGENT_CSV = 'region,total\n서울,120\n부산,98\n제주,40\n';
const REPLACED_CSV = 'region,total\n서울,310\n부산,280\n제주,250\n';
const AGENT_TIPS = ['서울 · total: 120', '부산 · total: 98', '제주 · total: 40'];
const chartFence = (dataset: string, spec: Record<string, unknown>, block: string) => [`:::chart {spec-json='${JSON.stringify(spec)}'}`, dataset, ':::', `^${block}`, ''];
const BOARD_MARKDOWN = [
  '# 지역별 매출 ^h1',
  '',
  'Revenue by region this quarter. ^p1',
  '',
  ...chartFence('sales', { view: 'bar', x: 'region', y: 'total', title: 'Sales by region' }, 'c1'),
  ...chartFence('sales', { view: 'table', columns: ['region', 'total'], title: 'Sales table' }, 'c2'),
].join('\n');
type Created = { artifactId: string; kind: string; revision: number; viewWarnings?: unknown[] };
type Bound = { status: string; artifactId: string; id: string; revision: number; columns: { name: string; type: string; mismatches?: number }[]; rows: number };
type BoardRead = { revision: number; kind: string; markdown: string; datasets: { id: string; title: string; file: string; rows: number; columns: { name: string; type: string }[]; updated: { by: string } }[] };
const minuteOf = (label: string) => /updated (\S+ \S+) UTC/.exec(label)?.[1];

let agentApp: DashboardApp | null = null;
test.afterEach(async () => {
  await agentApp?.close();
  agentApp = null;
});

test('the agent creates a dashboard from markdown and binds a CSV, a TSV and a JSON array in one call each, answered with columns, rows and the live revision; a ragged and an oversize file are refused naming why, nothing written; a replay answers its first result; two sessions conflict on one dataset and merge across prose', async () => {
  test.setTimeout(180_000);
  agentApp = await startApp(PROOF);
  const { page, agent, launch } = agentApp;

  const created = await agent.ok<Created>('A', 'artifact_create', { kind: 'dashboard', title: '지역별 매출', content: BOARD_MARKDOWN });
  expect(created.kind).toBe('dashboard');
  expect(created.viewWarnings).toBeUndefined();
  const id = created.artifactId;
  const read = await agent.ok<BoardRead>('A', 'artifact_read', { artifact: id });
  expect(read.datasets).toEqual([]);
  let revision = read.revision;

  await test.step('one artifact_dataset call per file binds a CSV, a TSV and a flat JSON array: columns, rows and the live revision', async () => {
    const csv = await agent.ok<Bound>('A', 'artifact_dataset', { artifact: id, baseRevision: revision, id: 'sales', title: 'Sales', path: await agent.write('A', 'sales.csv', AGENT_CSV) });
    expect(csv).toMatchObject({ status: 'dataset', id: 'sales', rows: 3, columns: [{ name: 'region', type: 'string' }, { name: 'total', type: 'number' }] });
    expect(csv.revision).toBe(await revisionOf(page, id));
    const tsv = await agent.ok<Bound>('A', 'artifact_dataset', { artifact: id, baseRevision: csv.revision, id: 'costs', path: await agent.write('A', 'costs.tsv', 'region\tcost\n서울\t3.5\n부산\t2\n') });
    expect(tsv).toMatchObject({ rows: 2, columns: [{ name: 'region', type: 'string' }, { name: 'cost', type: 'number' }] });
    const json = await agent.ok<Bound>('A', 'artifact_dataset', { artifact: id, baseRevision: tsv.revision, id: 'people', path: await agent.write('A', 'people.json', JSON.stringify([{ name: '김', age: 30 }, { name: 'Lee', active: true }])) });
    expect(json).toMatchObject({ rows: 2, columns: [{ name: 'name', type: 'string' }, { name: 'age', type: 'number' }, { name: 'active', type: 'boolean' }] });
    expect(json.revision).toBe(await revisionOf(page, id));
    revision = json.revision;
    const listed = await agent.ok<BoardRead>('A', 'artifact_read', { artifact: id });
    expect(listed.datasets.map(({ id: dataset, file, rows, updated }) => ({ id: dataset, file, rows, by: updated.by }))).toEqual([
      { id: 'costs', file: 'costs.tsv', rows: 2, by: 'this session' },
      { id: 'people', file: 'people.json', rows: 2, by: 'this session' },
      { id: 'sales', file: 'sales.csv', rows: 3, by: 'this session' },
    ]);
  });

  await test.step('a ragged record is refused naming its physical line and why; 16 MiB + 1 is refused by size; nothing is written', async () => {
    const assets = async () => (await agent.ok<{ assets: unknown[] }>('A', 'artifact_list_assets', { artifact: id })).assets.length;
    const before = { revision: await revisionOf(page, id), assets: await assets() };
    // the first record spans two physical lines (a quoted newline), so the ragged one is on line 4
    const ragged = await agent.call('A', 'artifact_dataset', { artifact: id, baseRevision: revision, id: 'sales', path: await agent.write('A', 'ragged.csv', 'region,total\n"서울\n중구",120\n부산\n') });
    expect(refusalOf(ragged)).toMatchObject({ reason: 'invalid', line: 4 });
    expect(ragged.text).toMatch(/line 4/);
    const big = await agent.call('A', 'artifact_dataset', { artifact: id, baseRevision: revision, id: 'big', path: await agent.write('A', 'big.csv', new Uint8Array(16 * 1024 * 1024 + 1)) });
    expect(refusalOf(big)).toMatchObject({ reason: 'tooLarge', size: 16 * 1024 * 1024 + 1 });
    expect({ revision: await revisionOf(page, id), assets: await assets() }).toEqual(before);
    expect((await agent.ok<BoardRead>('A', 'artifact_read', { artifact: id })).datasets.map((d) => d.id)).toEqual(['costs', 'people', 'sales']);
  });

  await test.step('a replay of one tool-use id answers its first result, its file gone since', async () => {
    const args = { artifact: id, baseRevision: revision, id: 'regions', path: await agent.write('A', 'regions.csv', 'region\n서울\n') };
    const first = await agent.call<Bound>('A', 'artifact_dataset', args, { toolUseId: 'toolu_dashboard_replay' });
    expect(first.isError, first.text).toBe(false);
    rmSync(join(await agent.cwd('A'), 'regions.csv'));
    const again = await agent.call<Bound>('A', 'artifact_dataset', args, { toolUseId: 'toolu_dashboard_replay' });
    expect(again.result).toEqual(first.result);
  });

  await test.step('two sessions replacing `sales` from one base: the second is refused `conflict`; after an unrelated prose edit, a replacement merges', async () => {
    const base = (await agent.ok<BoardRead>('A', 'artifact_read', { artifact: id })).revision;
    expect((await agent.ok<BoardRead>('B', 'artifact_read', { artifact: id })).revision).toBe(base);
    await agent.ok('B', 'artifact_dataset', { artifact: id, baseRevision: base, id: 'sales', path: await agent.write('B', 'sales.csv', 'region,total\n서울,1\n') });
    const second = await agent.call('A', 'artifact_dataset', { artifact: id, baseRevision: base, id: 'sales', path: await agent.write('A', 'sales-2.csv', 'region,total\n서울,2\n') });
    expect(refusalOf(second)).toMatchObject({ reason: 'conflict', dataset: 'sales' });
    const seen = (await agent.ok<BoardRead>('A', 'artifact_read', { artifact: id })).revision;
    const other = (await agent.ok<BoardRead>('B', 'artifact_read', { artifact: id })).revision;
    await agent.ok('B', 'artifact_edit', { artifact: id, baseRevision: other, ops: [{ op: 'replace_text', block: 'p1', old: 'this quarter', new: 'in Q4' }] });
    expect(await revisionOf(page, id)).toBeGreaterThan(seen);
    const merged = await agent.ok<Bound>('A', 'artifact_dataset', { artifact: id, baseRevision: seen, id: 'sales', path: await agent.write('A', 'sales.csv', AGENT_CSV) });
    expect(merged.revision).toBe(await revisionOf(page, id));
    expect((await agent.ok<BoardRead>('A', 'artifact_read', { artifact: id })).markdown).toContain('Revenue by region in Q4.');
  });

  let main: Locator | null = null;
  await test.step('the owner opens it in a main tab: both views draw the bound data under the session-credited source label', async () => {
    main = await openInMain(page, id);
    await expect(figures(main)).toHaveCount(2, { timeout: 15_000 });
    const bar = figures(main).nth(0);
    await expect(bar.locator('.dash-figure > svg')).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => tipsOf(bar), { timeout: 15_000 }).toEqual(AGENT_TIPS);
    await expect(figures(main).nth(1).locator('.dash-figure > table tbody')).toContainText('제주');
    await expect(bar.locator('button.dash-source-label')).toHaveText(/^Sales · from sales\.csv · updated \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC by Harness A$/);
    await main.screenshot({ path: `${PROOF}/agent-board.png` });
  });

  await test.step('the agent’s suggested chart draws the data in the suggested document, the live one untouched; accepted, the live one draws it (the suggestion as the displayed document)', async () => {
    const tab = main!;
    const base = (await agent.ok<BoardRead>('A', 'artifact_read', { artifact: id })).revision;
    const fence = chartFence('sales', { view: 'bar', x: 'region', y: 'total', sort: { by: 'total', dir: 'asc' }, title: 'Lowest first' }, 'c3').join('\n');
    await agent.ok('A', 'artifact_edit', { artifact: id, baseRevision: base, mode: 'suggest', ops: [{ op: 'insert', after: 'c2', markdown: fence }] });
    const proposed = tab.getByLabel('Suggested document').locator('figure.dash-view', { hasText: 'Lowest first' });
    await expect(proposed.locator('.dash-figure > svg')).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => tipsOf(proposed), { timeout: 15_000 }).toEqual(['제주 · total: 40', '부산 · total: 98', '서울 · total: 120']);
    await expect(proposed.locator('button.dash-source-label')).toHaveText(/^Sales · from sales\.csv · /);
    await expect(tab.locator('[data-editor="live"] figure.dash-view')).toHaveCount(2);
    await tab.screenshot({ path: `${PROOF}/agent-suggested.png` });
    await tab.getByRole('button', { name: 'Accept suggestion 1', exact: true }).click();
    const accepted = tab.locator('[data-editor="live"] figure.dash-view', { hasText: 'Lowest first' });
    await expect(accepted.locator('.dash-figure > svg')).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => tipsOf(accepted), { timeout: 15_000 }).toEqual(['제주 · total: 40', '부산 · total: 98', '서울 · total: 120']);
  });
  await agent.release('A');
  await agent.release('B');
  expect(launch.consoleErrors(), 'the console stays free of errors').toEqual([]);
});

test('beside the agent’s views the owner comments on the chart and writes; B’s thread tools answer the block’s thread; the agent’s replacement changes both views, keeping the prose, the comment and the captions, its label the new time and session; a removal keeps the captions', async () => {
  test.setTimeout(240_000);
  agentApp = await startApp(PROOF);
  const { page, agent, launch } = agentApp;
  await selectPanelSession(page);
  const { artifactId: id, revision } = await agent.ok<Created>('A', 'artifact_create', { kind: 'dashboard', title: 'Owner and agent', content: BOARD_MARKDOWN });
  await agent.ok<Bound>('A', 'artifact_dataset', { artifact: id, baseRevision: revision, id: 'sales', title: 'Sales', path: await agent.write('A', 'sales.csv', AGENT_CSV) });
  const record = await openInPanel(page, id);
  const views = figures(record);
  await expect(views).toHaveCount(2, { timeout: 15_000 });
  await expect(views.nth(0).locator('.dash-figure > svg')).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => tipsOf(views.nth(0)), { timeout: 15_000 }).toEqual(AGENT_TIPS);
  const firstLabel = (await views.nth(0).locator('button.dash-source-label').textContent())!;
  expect(firstLabel).toMatch(/ by Harness A$/);
  const chartBlock = record.locator('.doc-chart').first();

  let threadId = '';
  await test.step('the owner writes beside the chart, comments on the chart block and replies in the rail', async () => {
    // the prose first, while the column is the panel's whole width (the rail open narrows it: the tracker's P3-F row)
    const prose = record.locator('.ds-doc .ProseMirror p', { hasText: 'Revenue by region this quarter.' });
    await prose.click();
    // the caret at the paragraph's end (End would stop at its first visual line: the panel wraps it, run 38992236787)
    await prose.evaluate((el) => el.ownerDocument.getSelection()!.collapse(el, el.childNodes.length));
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))); // read by the editor
    await page.keyboard.type(' Owner: compare with last year.');
    await expect(prose).toHaveText('Revenue by region this quarter. Owner: compare with last year.');
    const watched = await watchSelection(record);
    await selectChart(record);
    await commentSelectedChart(record, watched);
    const card = page.locator('[data-comment-card]');
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-anchor-locator', 'chart: Sales by region');
    await expect.poll(async () => (await chartBlock.getAttribute('class'))?.match(/\bcomment-(?!active\b)([\w-]+)/)?.[1] ?? '').not.toBe('');
    threadId = (await chartBlock.getAttribute('class'))!.match(/\bcomment-(?!active\b)([\w-]+)/)![1]!;
    // kept the owner's way, as the comments group keeps it: Resolve on the card, Reopen and a reply in the rail
    await card.getByRole('button', { name: 'Resolve' }).click();
    await expect(card).toHaveCount(0);
    const rail = await railOf(record);
    await rail.locator(`article[data-thread="${threadId}"]`).getByRole('button', { name: 'Reopen' }).click();
    await reply(rail, threadId, 'Is Jeju this low every quarter?');
    await expect(rail.locator(`article[data-thread="${threadId}"]`).getByRole('listitem')).toHaveText(['YouIs Jeju this low every quarter?']);
    await durable(record);
  });

  await test.step('B’s thread tools answer the block’s thread: listed with its view locator, replied to, resolved and reopened', async () => {
    const listed = await agent.ok<{ threads: { threadId: string; quote: string; block: string | null; orphaned: boolean; messages: { body: string }[] }[] }>('A', 'artifact_comments', { artifact: id });
    const thread = listed.threads.find((t) => t.threadId === threadId);
    expect(thread).toMatchObject({ quote: 'chart: Sales by region', orphaned: false, block: 'c1' });
    expect(thread!.messages.map((m) => m.body)).toEqual(['Is Jeju this low every quarter?']);
    expect(await agent.ok('A', 'artifact_reply', { artifact: id, threadId, body: 'Yes: visitors peak in summer.' })).toMatchObject({ status: 'replied' });
    const rail = await railOf(record);
    const item = rail.locator(`article[data-thread="${threadId}"]`);
    await expect(item.getByRole('listitem')).toHaveText(['YouIs Jeju this low every quarter?', /Yes: visitors peak in summer\.$/], { timeout: 15_000 });
    expect(await agent.ok('A', 'artifact_resolve', { artifact: id, threadId })).toMatchObject({ status: 'resolved' });
    await expect(rail.getByRole('region', { name: /Resolved/ }).locator(`article[data-thread="${threadId}"]`)).toHaveAttribute('data-status', 'resolved', { timeout: 15_000 });
    expect(await agent.ok('A', 'artifact_resolve', { artifact: id, threadId, reopen: true })).toMatchObject({ status: 'reopened' });
    await expect(item).toHaveAttribute('data-status', 'open', { timeout: 15_000 });
  });

  await test.step('session B replaces `sales` with new bytes: both views change; the prose, the comment and the captions stay; the label names the new time and session B', async () => {
    // a later UTC minute than the first bind's, so the label's time visibly moves
    for (const deadline = Date.now() + 65_000; new Date().toISOString().slice(0, 16).replace('T', ' ') === minuteOf(firstLabel) && Date.now() < deadline; ) await page.waitForTimeout(1_000);
    const base = (await agent.ok<BoardRead>('B', 'artifact_read', { artifact: id })).revision;
    await agent.ok<Bound>('B', 'artifact_dataset', { artifact: id, baseRevision: base, id: 'sales', path: await agent.write('B', 'sales.csv', REPLACED_CSV) });
    await expect.poll(() => tipsOf(views.nth(0)), { timeout: 15_000, message: 'the chart draws the new snapshot' }).toEqual(['서울 · total: 310', '부산 · total: 280', '제주 · total: 250']);
    await expect(views.nth(1).locator('.dash-figure > table tbody')).toContainText('310');
    const label = views.nth(0).locator('button.dash-source-label');
    await expect(label).toHaveText(/^Sales · from sales\.csv · updated \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC by Harness B$/);
    expect(minuteOf((await label.textContent())!), 'the label shows the replacement’s time').not.toBe(minuteOf(firstLabel));
    await expect(record.locator('.ds-doc .ProseMirror p', { hasText: 'Owner: compare with last year.' })).toHaveCount(1);
    await expect(views.nth(0).locator('.dash-caption')).toHaveText('Sales by region');
    await expect(chartBlock).toHaveClass(new RegExp(`\\bcomment-${threadId}\\b`));
    await record.screenshot({ path: `${PROOF}/agent-replaced.png` });
  });

  await test.step('a removal draws both views as `no dataset "sales"`, their captions kept', async () => {
    const base = (await agent.ok<BoardRead>('A', 'artifact_read', { artifact: id })).revision;
    await agent.ok('A', 'artifact_dataset', { artifact: id, baseRevision: base, id: 'sales', remove: true });
    for (const k of [0, 1]) await expect(views.nth(k).locator('.dash-source-label')).toHaveText('no dataset "sales"', { timeout: 15_000 });
    await expect(views.nth(0).locator('.dash-caption')).toHaveText('Sales by region');
    await expect(views.nth(1).locator('.dash-caption')).toHaveText('Sales table');
    await expect(chartBlock).toHaveClass(new RegExp(`\\bcomment-${threadId}\\b`));
    await record.screenshot({ path: `${PROOF}/agent-removed.png` });
  });
  expect(launch.consoleErrors(), 'the console stays free of errors').toEqual([]);
});

test('every dataset state draws in place from a fixture: a missing column, an unreadable snapshot, mixed types, an error, a stale and a paused source, and no dataset', async () => {
  test.setTimeout(120_000);
  agentApp = await startApp(PROOF);
  const { page, agent, launch } = agentApp;
  const at = Date.UTC(2026, 9, 1, 9, 0);
  const STATES: [string, Record<string, unknown>][] = [
    ['missing', { view: 'bar', x: 'region', y: 'revenue', title: 'A missing column' }],
    ['broken', { view: 'bar', x: 'region', y: 'total', title: 'An unreadable snapshot' }],
    ['mixed', { view: 'bar', x: 'region', y: 'total', title: 'Mixed types' }],
    ['failing', { view: 'bar', x: 'region', y: 'total', title: 'An error' }],
    ['stale', { view: 'bar', x: 'region', y: 'total', title: 'A stale source' }],
    ['paused', { view: 'bar', x: 'region', y: 'total', title: 'A paused source' }],
    ['nothing', { view: 'bar', x: 'region', y: 'total', title: 'No dataset' }],
  ];
  const content = ['# States ^h1', '', ...STATES.flatMap(([dataset, spec], k) => chartFence(dataset, spec, `v${k}`))].join('\n');
  const { artifactId: id, revision } = await agent.ok<Created>('A', 'artifact_create', { kind: 'dashboard', title: 'States', content });
  // mixed types and the missing column through the agent's own binds: the host keeps the text and counts it
  const mixed = await agent.ok<Bound>('A', 'artifact_dataset', { artifact: id, baseRevision: revision, id: 'mixed', title: 'Mixed', path: await agent.write('A', 'mixed.csv', 'region,total\n서울,120\n부산,n/a\n제주,40\n') });
  expect(mixed.columns).toEqual([{ name: 'region', type: 'string' }, { name: 'total', type: 'number', mismatches: 1 }]);
  await agent.ok('A', 'artifact_dataset', { artifact: id, baseRevision: mixed.revision, id: 'missing', title: 'Sales', path: await agent.write('A', 'sales.csv', AGENT_CSV) });
  // the states E3's query lifecycle writes (error, stale, paused), as their descriptors hold them, and a snapshot whose
  // bytes no longer read as the descriptor's format
  await bindCsv(page, id, 'failing', { title: 'Sales', name: 'sales.csv', csv: AGENT_CSV, at, state: { status: 'error', message: 'the source answered 503', at } });
  await bindCsv(page, id, 'stale', { title: 'Sales', name: 'sales.csv', csv: AGENT_CSV, at, state: { status: 'stale', at } });
  await bindCsv(page, id, 'paused', { title: 'Sales', name: 'sales.csv', csv: AGENT_CSV, at, state: { status: 'paused', at } });
  await bindCsv(page, id, 'broken', { title: 'Broken', name: 'broken.csv', csv: 'region,total\n서울\n', shape: AGENT_CSV, at });

  const main = await openInMain(page, id);
  const views = figures(main);
  await expect(views).toHaveCount(STATES.length, { timeout: 15_000 });
  const frame = (k: number) => views.nth(k).locator('.dash-figure');
  const label = (k: number) => views.nth(k).locator('.dash-source-label');
  const TIME = 'updated 2026-10-01 09:00 UTC by You';
  await expect(frame(0)).toContainText('dataset "missing" has no column "revenue"', { timeout: 15_000 });
  await expect(frame(1)).toContainText('the file of "broken" could not be read', { timeout: 15_000 });
  await expect(views.nth(2).locator('.dash-notes')).toContainText('1 of 3 values in total are not number', { timeout: 15_000 });
  await expect(label(3)).toHaveText(`Sales · from sales.csv · ${TIME} · the source answered 503`);
  await expect(label(4)).toHaveText(`Sales · from sales.csv · ${TIME} · stale since 2026-10-01 09:00 UTC`);
  await expect(label(5)).toHaveText(`Sales · from sales.csv · ${TIME} · paused: no live session`);
  await expect(label(6)).toHaveText('no dataset "nothing"');
  for (let k = 0; k < STATES.length; k++) await expect(views.nth(k).locator('.dash-caption')).toHaveText(String(STATES[k]![1].title));
  await main.screenshot({ path: `${PROOF}/states.png` });
  expect(launch.consoleErrors(), 'the console stays free of errors').toEqual([]);
});
