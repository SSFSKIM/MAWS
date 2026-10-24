// The design system's menus and the presenter in the product build (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md,
// M6, D10, D13; `pnpm e2e:presentations`). A deck is created by the human's `artifacts.create` and seeded from files
// through the renderer's seam (presentations.spec.ts's way), on a scratch profile with the three built-in systems seeded.
// - The design system: Theme switches the deck's system (its slides restyle by reference, the artifact names it) and an
//   override of its background recolours the slide; Text style sets a paragraph in a type role; New slide from layout
//   makes a slide from each of `maws`'s four layouts, `data-ph` stripped; Check lists a planted literal colour, and a
//   click selects the element.
// - The presenter: Present opens the audience window (with a second display, a presenter window beside it); the show
//   advances through a fade and a build, skips a hidden slide, runs a live embed from the store's scheme under its own
//   sandbox; the presenter view shows the notes, the next slide and the timer; Escape ends the show and its windows close.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
async function ok<T>(page: Page, name: string, input?: unknown): Promise<T> {
  const result = (await page.evaluate(([n, i]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke(n as string, i), [name, input] as const)) as Result<T>;
  if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
  return result.value;
}

interface Seam {
  __maws_presentations: {
    seed(artifactId: string, files: Record<string, string>): Promise<{ changed: string[]; held: string[] }>;
    files(artifactId: string): Promise<Record<string, string>>;
    order(artifactId: string): Promise<string[]>;
  };
}
const seed = (page: Page, id: string, files: Record<string, string>) => page.evaluate(([a, f]) => (window as unknown as Seam).__maws_presentations.seed(a, f), [id, files] as const);
const filesOf = (page: Page, id: string) => page.evaluate((a) => (window as unknown as Seam).__maws_presentations.files(a), id);
const orderOf = (page: Page, id: string) => page.evaluate((a) => (window as unknown as Seam).__maws_presentations.order(a), id);

let launch: MawsLaunch | null = null;
test.afterEach(async () => {
  await launch?.cleanup();
  launch = null;
});

interface Row {
  id: string;
  title: string;
  designSystemId?: string | null;
}
const systems = async (page: Page): Promise<Row[]> => (await ok<{ artifacts: Row[] }>(page, 'artifacts.list', { filter: { kind: 'design_system' } })).artifacts;

async function ready(): Promise<Page> {
  launch = await launchMaws();
  await launch.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1600, 1000));
  const { page } = launch;
  await expect.poll(async () => (await ok<{ state: string }>(page, 'engine.hostState')).state, { timeout: 20_000, message: 'the engine host is ready' }).toBe('ready');
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as Partial<Seam>).__maws_presentations), { message: 'the seam is installed' }).toBe('object');
  await expect.poll(async () => (await systems(page)).map((s) => s.title).sort(), { timeout: 15_000, message: 'the built-in systems are seeded' }).toEqual(['Classroom', 'MAWS', 'Official']);
  return page;
}

async function createDeck(page: Page, title: string, files: Record<string, string>): Promise<string> {
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'presentation', title });
  await seed(page, artifact.id, files);
  return artifact.id;
}

async function openFromLibrary(page: Page, title: string, artifactId: string): Promise<Locator> {
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  await page.locator('[data-library]').getByRole('article', { name: title, exact: true }).click();
  const tab = page.locator(`[data-region="main"] [data-artifact-tab="${artifactId}"]`);
  await expect(tab.locator('[data-deck-editor]')).toBeVisible({ timeout: 15_000 });
  return tab;
}

/** Present stays direct; Theme and Check live in the deck toolbar's action menu. */
async function deckAction(page: Page, label: 'Present' | 'Theme' | 'Check against the design system'): Promise<void> {
  const toolbar = page.locator('[data-region="main"] .deck-toolbar [data-editor-toolbar]');
  if (label === 'Present') return toolbar.getByRole('button', { name: label, exact: true }).click();
  await toolbar.getByRole('button', { name: 'Deck actions', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: label, exact: true }).click();
}

const bundled = (key: string) => JSON.parse(readFileSync(join(REPO_ROOT, `src/artifacts/types/design_system/defaults/${key}/tokens.tokens.json`), 'utf8')) as { color: Record<string, { $root: { $value: { hex: string } } }> };
const rgbOf = (hex: string) => `rgb(${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(', ')})`;
const stageNode = (tab: Locator, eid: string) => tab.locator(`[data-stage-slide] [data-eid="${eid}"]`);
const computed = (node: Locator, property: string) => node.evaluate((n, p) => getComputedStyle(n).getPropertyValue(p), property);

const DECK_JSON = (order: string[], extra: Record<string, unknown> = {}) => JSON.stringify({ v: 4, createdOnFiles: { v: 1, at: '2026-10-15T09:00:00Z' }, title: 'Theme lab', cover: order[0], order, ...extra });

const THEMED: Record<string, string> = {
  'project/deck.json': DECK_JSON(['cover', 'planted']),
  'project/slides/cover.html': `<section id="cover" style="background:var(--ds-color-bg); padding:128px; display:flex; flex-direction:column; gap:40px"><h1 id="title" style="font-size:96px; color:var(--ds-color-text)">Air has mass</h1><p id="lede" style="font-size:40px; color:var(--ds-color-text)">We weighed a ball before and after pumping it.</p></section>`,
  'project/slides/planted.html': `<section id="planted" style="background:var(--ds-color-bg); padding:128px"><p id="loud" style="font-size:var(--ds-type-body-size); color:#ff0044">A colour no token holds</p></section>`,
};

test('the design system: Theme switches the deck’s system and overrides it, Text style, New slide from layout, and Check', async () => {
  test.setTimeout(180_000);
  const page = await ready();
  const id = await createDeck(page, 'Theme lab', THEMED);
  const tab = await openFromLibrary(page, 'Theme lab', id);
  const official = (await systems(page)).find((s) => s.title === 'Official')!;
  const maws = (await systems(page)).find((s) => s.title === 'MAWS')!;
  const title = stageNode(tab, 'title');
  // no system of its own: the house floor (MAWS's tokens)
  await expect.poll(() => computed(title, 'color')).toBe(rgbOf(bundled('maws').color.text!.$root.$value.hex));

  // Theme: the panel beside the stage, each system offered; Official names the deck's system and restyles it
  await deckAction(page, 'Theme');
  const theme = tab.locator('[data-deck-rail="theme"]');
  await expect(theme).toBeVisible();
  await expect.poll(async () => (await theme.locator('.deck-theme-system-name').allInnerTexts()).sort()).toEqual(['Classroom', 'Default', 'MAWS', 'Official']);
  await theme.locator(`[data-system="${official.id}"]`).click();
  await expect.poll(async () => (await ok<{ artifact: Row }>(page, 'artifacts.get', { artifactId: id })).artifact.designSystemId).toBe(official.id);
  await expect(theme.locator(`[data-system="${official.id}"]`)).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => computed(title, 'color')).toBe(rgbOf(bundled('official').color.text!.$root.$value.hex));

  // an override of the background recolours the slide, and is the deck's own (dsOverrides)
  const section = tab.locator('[data-stage-slide] .maws-slide');
  const background = theme.getByRole('textbox', { name: 'Background', exact: true });
  await background.fill('#123456');
  await background.press('Enter');
  await expect.poll(() => computed(section, 'background-color')).toBe('rgb(18, 52, 86)');
  await expect.poll(async () => JSON.parse((await filesOf(page, id))['project/deck.json']!).dsOverrides).toEqual({ '--ds-color-bg': '#123456' });
  await theme.getByRole('button', { name: 'Use the system’s background' }).click();
  await expect.poll(() => computed(section, 'background-color')).toBe(rgbOf(bundled('official').color.bg!.$root.$value.hex));

  // Text style: the paragraph set in Heading 1 takes the role's variables and draws at the system's deck size
  const lede = stageNode(tab, 'lede');
  await lede.click();
  await expect(tab.locator('[data-overlay] [data-selected="lede"]')).toBeVisible();
  await tab.getByRole('button', { name: 'Text style', exact: true }).click();
  await page.locator('.deck-text-style-item[data-role="h1"]').click();
  await expect.poll(async () => (await filesOf(page, id))['project/slides/cover.html']).toContain('font-size:var(--ds-type-h1-size)');
  // the role's size as the system's deck scale sets it in the scope, and the paragraph drawn at it
  await expect.poll(() => lede.evaluate((n) => getComputedStyle(n).fontSize === getComputedStyle(n).getPropertyValue('--ds-type-h1-size').trim())).toBe(true);
  expect(await computed(lede, 'font-size')).not.toBe('40px');
  await expect(tab.getByRole('button', { name: 'Text style', exact: true })).toHaveText('Heading 1');

  // New slide from layout: the deck back in MAWS, a slide from each of its four layouts, no placeholder marks left
  await theme.locator(`[data-system="${maws.id}"]`).click();
  await expect.poll(async () => (await ok<{ artifact: Row }>(page, 'artifacts.get', { artifactId: id })).artifact.designSystemId).toBe(maws.id);
  for (const layout of ['Content', 'Figures', 'Quote', 'Title']) {
    await tab.getByRole('button', { name: 'From layout', exact: true }).click();
    const item = page.getByRole('menuitem', { name: `${layout} layout`, exact: true });
    await expect(item.locator('.maws-slide')).toBeVisible();
    await item.click();
  }
  await expect.poll(async () => (await orderOf(page, id)).length).toBe(6);
  const files = await filesOf(page, id);
  const made = (await orderOf(page, id)).filter((s) => s !== 'cover' && s !== 'planted');
  expect(made).toHaveLength(4);
  for (const slide of made) expect(files[`project/slides/${slide}.html`]).not.toContain('data-ph');
  expect(files[`project/slides/${made.at(-1)}.html`]).toContain('var(--ds-type-title-size)');

  // Check: the planted literal colour is listed under its slide; a click shows the slide and selects the element
  await deckAction(page, 'Check against the design system');
  const check = tab.locator('[data-deck-rail="check"]');
  await expect(check).toBeVisible();
  const violation = check.locator('[data-violation="literal-color"][data-element="loud"]');
  await expect(violation).toBeVisible({ timeout: 10_000 });
  await expect(violation).toContainText('#ff0044');
  await violation.click();
  await expect(tab.locator('[data-stage-slide="planted"]')).toBeVisible();
  await expect(tab.locator('[data-overlay] [data-selected="loud"]')).toBeVisible();
});

// ---- the presenter

const SHOW: Record<string, string> = {
  'project/deck.json': DECK_JSON(['open', 'build', 'backup', 'close'], { title: 'Show' }),
  'project/slides/open.html': `<section id="open" data-transition="fade" style="background:#ffffff; padding:128px"><h1 id="t1" style="font-size:96px">Opening</h1><aside>Open with the ramp time.</aside></section>`,
  'project/slides/build.html': `<section id="build" style="background:#ffffff; padding:128px"><h2 id="t2" style="font-size:64px">Two points</h2><p id="a" data-build-in="fade" style="position:absolute; left:128px; top:400px; width:800px; font-size:48px">First point</p><p id="b" data-build-in="rise" style="position:absolute; left:128px; top:560px; width:800px; font-size:48px">Second point</p><x-embed id="live" style="position:absolute; left:1100px; top:400px; width:600px; height:300px"><p id="out" style="font:48px sans-serif">waiting</p><script>document.getElementById('out').textContent = 'ran ' + (typeof fetch)</script></x-embed><aside>Build the points one by one.</aside></section>`,
  'project/slides/backup.html': `<section id="backup" hidden style="background:#ffffff; padding:128px"><h2 id="t3" style="font-size:64px">Backup</h2></section>`,
  'project/slides/close.html': `<section id="close" style="background:#ffffff; padding:128px"><h2 id="t4" style="font-size:64px">Thank you</h2></section>`,
};

const presentPages = (app: ElectronApplication) => app.windows().filter((w) => w.url().includes('present=1'));
const at = (page: Page) => page.locator('[data-present-role]').evaluate((n) => `${(n as HTMLElement).dataset.presentSlide}/${(n as HTMLElement).dataset.presentBuild}`);
const visibilityOf = (page: Page, eid: string) => page.locator(`[data-present-view="audience"] .present-layer:last-of-type [data-eid="${eid}"]`).evaluate((n) => getComputedStyle(n).visibility);

test('the presenter: the audience window and the presenter view, builds, a fade, a hidden slide skipped, a live embed, Escape', async () => {
  test.setTimeout(180_000);
  const page = await ready();
  const app = launch!.app;
  const id = await createDeck(page, 'Show', SHOW);
  await openFromLibrary(page, 'Show', id);
  const displays = await app.evaluate(({ screen }) => screen.getAllDisplays().length);

  await deckAction(page, 'Present');
  await expect.poll(() => presentPages(app).length, { timeout: 15_000, message: 'the show’s windows opened' }).toBe(displays > 1 ? 2 : 1);
  const audience = presentPages(app).find((w) => w.url().includes('role=audience'))!;
  await expect(audience.locator('[data-present-view="audience"]')).toBeVisible({ timeout: 15_000 });
  expect(await at(audience)).toBe('open/0');

  // a fade into the next slide (the motion the stage asked of the arriving layer recorded), its builds hidden until
  // clicked, then built one by one with their effects
  await audience.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __motion: string[] }).__motion = seen;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, frames: Keyframe[] | PropertyIndexedKeyframes | null, options?: number | KeyframeAnimationOptions) {
      const first = Array.isArray(frames) ? frames[0] : undefined;
      seen.push(`${this.classList.contains('present-layer') ? 'layer' : ((this as HTMLElement).dataset.eid ?? '?')}:${JSON.stringify(first)}`);
      return animate.call(this, frames, options);
    };
  });
  const motion = () => audience.evaluate(() => (window as unknown as { __motion: string[] }).__motion);
  await audience.keyboard.press('ArrowRight');
  await expect.poll(() => at(audience)).toBe('build/0');
  await expect.poll(motion).toContain('layer:{"opacity":0}');
  await expect.poll(() => visibilityOf(audience, 'a')).toBe('hidden');
  expect(await visibilityOf(audience, 'b')).toBe('hidden');
  await audience.keyboard.press('ArrowRight');
  await expect.poll(() => at(audience)).toBe('build/1');
  await expect.poll(() => visibilityOf(audience, 'a')).toBe('visible');
  expect(await visibilityOf(audience, 'b')).toBe('hidden');
  await audience.keyboard.press(' ');
  await expect.poll(() => at(audience)).toBe('build/2');
  await expect.poll(() => visibilityOf(audience, 'b')).toBe('visible');
  const played = await motion();
  expect(played).toContain('a:{"opacity":0}');
  expect(played).toContain('b:{"opacity":0,"translate":"0px 80px"}');

  // the embed runs from the store's scheme under its own policy: its script ran, with no network to reach for
  const embedFrame = () => audience.frames().find((f) => f.url().includes('/live/embeds/build/live.html'));
  await expect.poll(() => embedFrame() !== undefined, { timeout: 10_000, message: 'the embed’s page loads from the store’s scheme' }).toBe(true);
  const embed = embedFrame()!;
  await expect(embed.locator('#out')).toHaveText(/^ran /, { timeout: 10_000 });
  const blocked = await embed.evaluate(() => new Promise<string>((resolve) => fetch('https://example.com/').then(() => resolve('fetched'), () => resolve('refused'))));
  expect(blocked).toBe('refused');

  // the presenter view: its own window with a second display, else P in the audience window
  let presenter: Page = audience;
  if (displays > 1) presenter = presentPages(app).find((w) => w.url().includes('role=presenter'))!;
  else await audience.keyboard.press('p');
  await expect(presenter.locator('[data-present-view="presenter"]')).toBeVisible();
  await expect.poll(() => at(presenter)).toBe('build/2');
  await expect(presenter.locator('[data-present-notes]')).toContainText('Build the points one by one.');
  await expect(presenter.locator('[data-present-count]')).toHaveText('Slide 2 of 3');
  // the hidden backup slide is skipped: next is the closing slide
  await expect(presenter.locator('[data-present-next] .maws-slide')).toHaveAttribute('data-slide', 'close');
  await expect(presenter.locator('[data-present-timer]')).toHaveText(/^\d+:\d\d$/);
  const started = await presenter.locator('[data-present-timer]').textContent();
  await expect.poll(() => presenter.locator('[data-present-timer]').textContent(), { timeout: 5_000 }).not.toBe(started);
  await presenter.getByRole('button', { name: 'Next', exact: true }).click();
  await expect.poll(() => at(audience)).toBe('close/0');
  await expect(presenter.locator('[data-present-next]')).toContainText('End of the show.');

  // Escape ends the show: its windows close, the app's stays
  const closed = Promise.all(presentPages(app).map((w) => w.waitForEvent('close')));
  // the window closes between the key's down and up: a press that finds its page closed has done its work
  await presenter.keyboard.press('Escape').catch((error: unknown) => {
    if (!/has been closed/.test(String(error))) throw error;
  });
  await closed;
  expect(presentPages(app)).toHaveLength(0);
  await expect(page.locator('[data-region="main"]')).toBeVisible();
});

// M6 fix wave 2: a magic move under a parent turned by its own transform. The group (400×200, turned 90°) moves from left
// 200 to 500; its child moves inside it from local left 50 to 100. On the move's first frame each is drawn where it was:
// the group's centre at (400, 400), the child's at (450, 275) (its centre (75, 50) in the group turned about the group's
// centre), read from the audience window with the motion held at its start.
const MAGIC = (left: number, kidLeft: number, id: string, transition = '') =>
  `<section id="${id}"${transition} style="background:#ffffff"><div id="g" data-group="" style="position:absolute; left:${left}px; top:300px; width:400px; height:200px; transform:rotate(90deg); background:#e0e0ff"><div id="kid" style="position:absolute; left:${kidLeft}px; top:25px; width:50px; height:50px; background:#ff0000"></div></div></section>`;
const MAGIC_DECK: Record<string, string> = {
  'project/deck.json': DECK_JSON(['m1', 'm2'], { title: 'Magic' }),
  'project/slides/m1.html': MAGIC(200, 50, 'm1', ' data-transition="magic"'),
  'project/slides/m2.html': MAGIC(500, 100, 'm2'),
};

test('a magic move starts each element where it was, a child inside a turned group included', async () => {
  test.setTimeout(120_000);
  const page = await ready();
  const app = launch!.app;
  const id = await createDeck(page, 'Magic', MAGIC_DECK);
  await openFromLibrary(page, 'Magic', id);
  await deckAction(page, 'Present');
  await expect.poll(() => presentPages(app).length, { timeout: 15_000 }).toBeGreaterThan(0);
  const audience = presentPages(app).find((w) => w.url().includes('role=audience'))!;
  await expect(audience.locator('[data-present-view="audience"]')).toBeVisible({ timeout: 15_000 });
  expect(await at(audience)).toBe('m1/0');
  // every motion from here lasts a minute, so its first frame can be read
  await audience.evaluate(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, frames: Keyframe[] | PropertyIndexedKeyframes | null, options?: number | KeyframeAnimationOptions) {
      return animate.call(this, frames, { ...(typeof options === 'object' ? options : {}), duration: 60_000 });
    };
  });
  await audience.keyboard.press('ArrowRight');
  await expect.poll(() => at(audience)).toBe('m2/0');
  const centres = await audience.evaluate(() => {
    for (const a of document.getAnimations()) {
      a.pause();
      a.currentTime = 0;
    }
    const stage = document.querySelector('.present-audience .present-stage')!.getBoundingClientRect();
    const k = stage.width / 1920;
    const layers = document.querySelectorAll('.present-audience .present-layer');
    const layer = layers[layers.length - 1]!;
    const centre = (eid: string) => {
      const r = layer.querySelector(`[data-eid="${eid}"]`)!.getBoundingClientRect();
      return { x: (r.left + r.width / 2 - stage.left) / k, y: (r.top + r.height / 2 - stage.top) / k };
    };
    return { g: centre('g'), kid: centre('kid') };
  });
  const round = (p: { x: number; y: number }) => ({ x: Math.round(p.x), y: Math.round(p.y) });
  expect(round(centres.g)).toEqual({ x: 400, y: 400 });
  expect(round(centres.kid)).toEqual({ x: 450, y: 275 });
  const closed = Promise.all(presentPages(app).map((w) => w.waitForEvent('close')));
  await audience.keyboard.press('Escape').catch((error: unknown) => {
    if (!/has been closed/.test(String(error))) throw error;
  });
  await closed;
});

