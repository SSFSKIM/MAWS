// P3-E1 M3 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M3): the design specs' shared fixture and seam
// access. A design is created by the human's `artifacts.create` and seeded from files through the renderer's seam
// (`window.__maws_design`, src/renderer/src/tools/design/e2e-seam.ts: the files published onto a replica by the kind's
// own publish, forced). The fixture's boards are a phone, a tablet, a desktop screen, a poster taller than 8,192 px and
// a board whose file does not load (held), every live one drawn on the design system's background.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { visuallyHidden, type NodeDraw } from './design-geometry';

export type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
export async function ok<T>(page: Page, name: string, input?: unknown): Promise<T> {
  const result = (await page.evaluate(([n, i]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke(n as string, i), [name, input] as const)) as Result<T>;
  if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
  return result.value;
}

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Viewport {
  zoom: number;
  x: number;
  y: number;
}
// The slide IR as the seam answers it (plain data; src/artifacts/slides/ir.ts)
export interface ElementIR {
  id: string;
  tag: string;
  attrs: Record<string, string>;
  style: Record<string, string>;
  children: ElementIR[];
  text?: { type: 'p' | 'li'; inline: ({ text: string; marks: Record<string, unknown> } | { br: true })[] }[];
}
export interface BoardIR {
  id: string;
  attrs: Record<string, string>;
  style: Record<string, string>;
  children: ElementIR[];
  notes: string;
}
export interface TabView {
  surface: string;
  viewport: Viewport | null;
  room: { w: number; h: number } | null;
  frame: string | null;
  currentBoard: string | null;
  selection: string[];
  timings: { openedAt: number; drawnAt?: number; thumbnails?: number };
}
export type DesignEdit =
  | { op: 'setStyle'; boardId: string; elementId: string; props: Record<string, string | null> }
  | { op: 'prependText'; boardId: string; elementId: string; text: string }
  | { op: 'setFrame'; boardId: string; frame: Partial<Frame> }
  | { op: 'addThread'; threadId: string; boardId: string; elementId: string; body: string }; // M4
/** M4: a thread as the seam reads it (C's derived state). */
export interface SeamThread {
  id: string;
  slideId: string;
  elementId: string;
  quote: string;
  status: string;
  live: boolean;
  orphan: boolean;
  messages: { body: string; by: string }[];
}
interface Seam {
  __maws_design: {
    seed(artifactId: string, files: Record<string, string>): Promise<{ changed: string[]; held: string[] }>;
    edit(artifactId: string, edit: DesignEdit): Promise<void>;
    files(artifactId: string): Promise<Record<string, string>>;
    boards(artifactId: string): Promise<{ id: string; frame: Frame | null; title: string | null }[]>;
    board(artifactId: string, boardId: string): Promise<BoardIR>;
    tabs(artifactId: string): TabView[];
    threads(artifactId: string): Promise<SeamThread[]>; // M4
    derivedId(artifactId: string, from: string, to: string, elementId: string): Promise<string>; // M4
    frameProbe: { arm(artifactId: string, surface: string, model: FrameProbeModel, dom: FrameProbeDom[]): string; result(probe: string): FrameProbeResult | null; disarm(probe: string): void }; // M6
    layoutProbe: { arm(artifactId: string, surface: string, options?: LayoutProbeOptions): string; result(probe: string): { armedAt: number; scopeAt: number | null; layouts: Record<string, number[]> }; disarm(probe: string): void }; // M6; DL39's options
  };
}

// ---- M6: the within-a-frame probe (src/renderer/src/tools/design/e2e-seam.ts)
export type FrameProbeModel = { kind: 'frame'; boardId: string; key: 'x' | 'y' | 'w' | 'h'; value: number } | { kind: 'style'; boardId: string; elementId: string; prop: string; value: string };
export interface FrameProbeDom {
  selector: string;
  style: string;
  equals: string;
}
export interface FrameProbeResult {
  surface: string;
  inbound: number;
  startedAt: number;
  domObservedMs: number | null;
  sentinelMs: number;
  atSentinel: { selector: string; style: string; value: string | null; ok: boolean }[];
  withinFrame: boolean;
}
export const armFrameProbe = (page: Page, id: string, surface: 'main' | 'panel', model: FrameProbeModel, dom: FrameProbeDom[]) =>
  page.evaluate(([a, s, m, d]) => (window as unknown as Seam).__maws_design.frameProbe.arm(a, s, m, d), [id, surface, model, dom] as const);
/** The probe's result once the edit's sentinel ran; disarmed either way (a probe that never resolves throws). */
export async function frameProbeResult(page: Page, probe: string, timeout = 10_000): Promise<FrameProbeResult> {
  let result: FrameProbeResult | null = null;
  try {
    await expect.poll(async () => (result = await page.evaluate((p) => (window as unknown as Seam).__maws_design.frameProbe.result(p), probe)) !== null, { timeout, message: 'the edit reached the receiving replica and its sentinel frame ran' }).toBe(true);
  } finally {
    await page.evaluate((p) => (window as unknown as Seam).__maws_design.frameProbe.disarm(p), probe);
  }
  return result!;
}
/** DL39: a mark per layout (`<mark>:layout:<board>:<n>`) and one when `scope`'s token stands (`<mark>:scope`), for a trace's reader. */
export interface LayoutProbeOptions {
  mark?: string;
  scope?: { token: string; value: string };
}
export const armLayoutProbe = (page: Page, id: string, surface: 'main' | 'panel', options: LayoutProbeOptions = {}) => page.evaluate(([a, s, o]) => (window as unknown as Seam).__maws_design.layoutProbe.arm(a, s, o), [id, surface, options] as const);
export const layoutProbeResult = (page: Page, probe: string) => page.evaluate((p) => (window as unknown as Seam).__maws_design.layoutProbe.result(p), probe);
export const disarmLayoutProbe = (page: Page, probe: string) => page.evaluate((p) => (window as unknown as Seam).__maws_design.layoutProbe.disarm(p), probe);
export const seamInstalled = (page: Page) => page.evaluate(() => typeof (window as unknown as Partial<Seam>).__maws_design);
export const seed = (page: Page, id: string, files: Record<string, string>) => page.evaluate(([a, f]) => (window as unknown as Seam).__maws_design.seed(a, f), [id, files] as const);
export const editDesign = (page: Page, id: string, edit: DesignEdit) => page.evaluate(([a, e]) => (window as unknown as Seam).__maws_design.edit(a, e), [id, edit] as const);
export const boardsOf = (page: Page, id: string) => page.evaluate((a) => (window as unknown as Seam).__maws_design.boards(a), id);
export const boardOf = (page: Page, id: string, boardId: string) => page.evaluate(([a, b]) => (window as unknown as Seam).__maws_design.board(a, b), [id, boardId] as const);
export const tabsOf = (page: Page, id: string) => page.evaluate((a) => (window as unknown as Seam).__maws_design.tabs(a), id);
export const threadsOf = (page: Page, id: string) => page.evaluate((a) => (window as unknown as Seam).__maws_design.threads(a), id); // M4
export const derivedIdOf = (page: Page, id: string, from: string, to: string, elementId: string) => page.evaluate(([a, f, t, e]) => (window as unknown as Seam).__maws_design.derivedId(a, f, t, e), [id, from, to, elementId] as const); // M4
export const filesOf = (page: Page, id: string) => page.evaluate((a) => (window as unknown as Seam).__maws_design.files(a), id); // M4

// ---- M4: the host's design seam (src/engine-host/designs/history-seam.ts), an agent session's writes in the product
// build with no engine: the launch names its channel's directory (MAWS_DESIGN_HISTORY), commands go in as files
export const AGENT_SESSION = '00000000-0000-4000-8000-0000000000e4';
export type AgentEdit =
  | { op: 'setStyle'; boardId: string; elementId: string; props: Record<string, string | null> }
  | { op: 'setFrame'; boardId: string; frame: Partial<Frame> }
  | { op: 'move'; from: string; to: string; elementId: string }
  | { op: 'reply'; threadId: string; body: string }
  | { op: 'resolve'; threadId: string };
/** One edit as the agent's session, then its `auto` version; answers the moved element's new id for a move. */
export async function asAgent(channel: string, artifactId: string, edit: AgentEdit): Promise<{ ok: boolean; error?: string; moved?: string }> {
  const name = `${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
  mkdirSync(join(channel, 'in'), { recursive: true });
  writeFileSync(join(channel, 'in', `${name}.tmp`), JSON.stringify({ cmd: 'write', artifactId, session: AGENT_SESSION, edit }));
  renameSync(join(channel, 'in', `${name}.tmp`), join(channel, 'in', name));
  const out = join(channel, 'out', name);
  await expect.poll(() => existsSync(out), { timeout: 15_000, message: 'the design seam answers' }).toBe(true);
  const answer = JSON.parse(readFileSync(out, 'utf8')) as { ok: boolean; error?: string; moved?: string };
  expect(answer, answer.error).toMatchObject({ ok: true });
  return answer;
}

/** How far a pin sits from the top-right corner of what it marks (its point on the corner), in screen px. */
export async function pinOffset(pin: Locator, target: Locator): Promise<number> {
  const [p, t] = [await pin.boundingBox(), await target.boundingBox()];
  if (!p || !t) return Number.POSITIVE_INFINITY;
  return Math.max(Math.abs(p.x - (t.x + t.width)), Math.abs(p.y + p.height - t.y));
}

export async function frameOf(page: Page, id: string, boardId: string): Promise<Frame | null> {
  return (await boardsOf(page, id)).find((b) => b.id === boardId)?.frame ?? null;
}
export async function viewOf(page: Page, id: string, surface: 'main' | 'panel'): Promise<TabView> {
  const tab = (await tabsOf(page, id)).find((t) => t.surface === surface);
  if (!tab) throw new Error(`no ${surface} tab shows ${id}`);
  return tab;
}
export function findIn(children: ElementIR[], id: string): ElementIR | undefined {
  for (const c of children) {
    if (c.id === id) return c;
    const inner = findIn(c.children, id);
    if (inner) return inner;
  }
  return undefined;
}
export async function elementOf(page: Page, id: string, boardId: string, elementId: string): Promise<ElementIR | undefined> {
  return findIn((await boardOf(page, id, boardId)).children, elementId);
}
export const plain = (e: ElementIR | undefined) => (e?.text ?? []).map((b) => b.inline.map((r) => ('text' in r ? r.text : '\n')).join('')).join('\n');
export const px = (v: string | undefined) => Number.parseFloat(v ?? 'NaN');

/** A board drawn in `where` (the panel or a main tab), and the screen point of a board px on it at the zoom it is drawn. */
export async function boardAt(where: Locator, boardId: string, frame: Frame) {
  const box = (await where.locator(`[data-board-id="${boardId}"]`).boundingBox())!;
  const zoom = box.width / frame.w;
  return { box, zoom, at: (x: number, y: number) => ({ x: box.x + x * zoom, y: box.y + y * zoom }) };
}
/** The screen point of a world px in `where`'s world, at its view. */
export async function worldAt(where: Locator, view: Viewport, x: number, y: number) {
  const box = (await where.locator('[data-design-world]').boundingBox())!;
  return { x: box.x + view.x + x * view.zoom, y: box.y + view.y + y * view.zoom };
}
export async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, options: { steps?: number; during?: () => Promise<void> } = {}) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = options.steps ?? 12;
  for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  await options.during?.();
  await page.mouse.up();
}
export const centre = async (locator: Locator) => {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** A header action by its label: its button, or its entry under More actions when the header folded it there. */
export async function headerAction(page: Page, label: string, region: 'main' | 'panel' = 'main'): Promise<void> {
  const header = page.locator(`[data-region="${region}"] [data-editor-header]`);
  const button = header.getByRole('button', { name: label, exact: true });
  if (await button.isVisible()) return button.click();
  await header.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: label }).or(page.getByRole('menuitem', { name: label })).click();
}

/** M6: an Export entry by its label, from the header's Export menu, or from More actions where a narrow header folds it. */
export async function exportEntry(page: Page, label: string, region: 'main' | 'panel' = 'main'): Promise<void> {
  const header = page.locator(`[data-region="${region}"] [data-editor-header]`);
  const button = header.getByRole('button', { name: 'Export', exact: true });
  await ((await button.isVisible()) ? button : header.getByRole('button', { name: 'More actions', exact: true })).click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
}

/** M6: what a surface's evidence records beside its screenshot: the editor and its chrome, measured. */
export interface SurfaceGeometry {
  window: { w: number; h: number };
  editor: { rect: Rect; scrollWidth: number; clientWidth: number } | null;
  world: Rect | null;
  rails: { label: string | null; rect: Rect }[];
  toolbars: { label: string | null; rect: Rect; scrollWidth: number; clientWidth: number }[];
  /** P2's comment card and any dialog, where they are drawn on the window. */
  overlays: { what: string; label: string | null; rect: Rect }[];
  /** The editor's chrome lying outside the editor sideways (the world's own contents excluded: its boards are clipped to it). */
  outside: { tag: string; className: string; role: string | null; label: string | null; id?: string; rect: Rect; draw: NodeDraw }[];
  /** Nodes outside the editor that draw nothing: screen-reader-only utilities (design-geometry.ts), kept as evidence. */
  hidden: { tag: string; role: string | null; id?: string; rect: Rect }[];
  /** Sideways scroll of the editor's ancestors. */
  scrolled: number;
}
type Rect = { x: number; y: number; w: number; h: number };

/**
 * M6: a surface's evidence, kept before any bound reads it so a failing bound still leaves it: a screenshot of `shot` (a
 * region, or the whole window for a sheet) under the test's output, and the geometry of the editor in `body` attached as
 * JSON beside it.
 */
export async function surfaceEvidence(page: Page, name: string, body: Locator, shot: Locator | null = null): Promise<SurfaceGeometry> {
  const info = test.info();
  if (shot) await shot.screenshot({ path: info.outputPath(`${name}.png`) });
  else await page.screenshot({ path: info.outputPath(`${name}.png`) });
  const measured = await body.evaluate((n): Omit<SurfaceGeometry, 'hidden'> => {
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
    };
    const editor = n.querySelector<HTMLElement>('[data-design-editor]');
    const world = editor?.querySelector('[data-design-world]') ?? null;
    const e = editor?.getBoundingClientRect();
    const outside = editor
      ? Array.from(editor.querySelectorAll<HTMLElement>('*'))
          .filter((el) => !(world && world !== el && world.contains(el)))
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && (r.left < e!.left - 1 || r.right > e!.right + 1))
          .map(({ el, r }) => ({ tag: el.tagName.toLowerCase(), className: typeof el.className === 'string' ? el.className : '', role: el.getAttribute('role'), label: el.getAttribute('aria-label'), ...(el.id && { id: el.id }), rect: rect(el), draw: { w: r.width, h: r.height, clip: getComputedStyle(el).clip, clipPath: getComputedStyle(el).clipPath } }))
      : [];
    let scrolled = 0;
    for (let a: HTMLElement | null = n as HTMLElement; a; a = a.parentElement) scrolled += a.scrollLeft;
    const overlays = [
      ...Array.from(document.querySelectorAll('[data-comment-card]')).map((el) => ({ what: 'comment card', label: el.getAttribute('aria-label'), rect: rect(el) })),
      ...Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]')).map((el) => ({ what: el.getAttribute('role')!, label: el.getAttribute('aria-label'), rect: rect(el) })),
    ];
    return {
      window: { w: window.innerWidth, h: window.innerHeight },
      editor: editor ? { rect: rect(editor), scrollWidth: editor.scrollWidth, clientWidth: editor.clientWidth } : null,
      world: world ? rect(world) : null,
      rails: Array.from(editor?.querySelectorAll('[role="complementary"]') ?? []).map((el) => ({ label: el.getAttribute('aria-label'), rect: rect(el) })),
      toolbars: Array.from(editor?.querySelectorAll<HTMLElement>('[role="toolbar"]') ?? []).map((el) => ({ label: el.getAttribute('aria-label'), rect: rect(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth })),
      overlays,
      outside,
      scrolled,
    };
  });
  // a screen-reader-only node (dnd-kit's live region beside the board list, an sr-only label) draws nothing wherever it
  // sits: kept as evidence apart, never read as chrome; everything else outside stays for the bounds
  const geometry: SurfaceGeometry = {
    ...measured,
    outside: measured.outside.filter((o) => !visuallyHidden(o.draw)),
    hidden: measured.outside.filter((o) => visuallyHidden(o.draw)).map((o) => ({ tag: o.tag, role: o.role, ...(o.id && { id: o.id }), rect: o.rect })),
  };
  await info.attach(`${name}-geometry`, { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' });
  return geometry;
}

/** M6: the bounds every surface keeps, read from its evidence: nothing sideways out of the editor or scrolled, the rails inside it, every overlay on the window. */
export function expectSurfaceBounds(name: string, g: SurfaceGeometry): void {
  expect(g.editor, `${name}: an editor`).not.toBeNull();
  expect(g.scrolled, `${name}: nothing scrolled sideways`).toBe(0);
  expect(g.editor!.scrollWidth - g.editor!.clientWidth, `${name}: the editor does not overflow sideways`).toBeLessThanOrEqual(1);
  expect(g.outside, `${name}: the editor's chrome outside the editor`).toEqual([]);
  const e = g.editor!.rect;
  for (const rail of g.rails) {
    expect(rail.rect.x, `${name}: the ${rail.label} rail`).toBeGreaterThanOrEqual(e.x - 1);
    expect(rail.rect.x + rail.rect.w, `${name}: the ${rail.label} rail`).toBeLessThanOrEqual(e.x + e.w + 1);
  }
  for (const o of g.overlays) {
    expect(o.rect.x, `${name}: the ${o.what} ${o.label}`).toBeGreaterThanOrEqual(-1);
    expect(o.rect.y, `${name}: the ${o.what} ${o.label}`).toBeGreaterThanOrEqual(-1);
    expect(o.rect.x + o.rect.w, `${name}: the ${o.what} ${o.label}`).toBeLessThanOrEqual(g.window.w + 1);
    expect(o.rect.y + o.rect.h, `${name}: the ${o.what} ${o.label}`).toBeLessThanOrEqual(g.window.h + 1);
  }
}

export async function createDesign(page: Page, title: string, files: Record<string, string>): Promise<string> {
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'design', title });
  await seed(page, artifact.id, files);
  return artifact.id;
}

/** The design opened from the library: its workbench in an `artifact` main tab (L's registry). */
export async function openFromLibrary(page: Page, title: string, artifactId: string): Promise<Locator> {
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  await page.locator('[data-library]').getByRole('article', { name: title, exact: true }).click();
  const tab = page.locator(`[data-region="main"] [data-artifact-tab="${artifactId}"]`);
  await expect(tab.locator('[data-design-editor]')).toBeVisible({ timeout: 15_000 });
  return tab;
}

// ---- the fixture

const ground = 'background:var(--ds-color-bg, #ffffff)';
export const FRAMES: Record<string, Frame & { title: string }> = {
  phone: { x: 0, y: 0, w: 390, h: 844, title: 'Phone' },
  tablet: { x: 490, y: 0, w: 834, h: 1194, title: 'Tablet' },
  desktop: { x: 1424, y: 0, w: 1440, h: 1024, title: 'Desktop' },
  poster: { x: 2964, y: 0, w: 1080, h: 9000, title: 'Poster' },
  broken: { x: 4144, y: 0, w: 800, h: 600, title: 'Broken' },
};
export const ORDER = ['phone', 'tablet', 'desktop', 'poster', 'broken'];
export const DESIGN_FILES: Record<string, string> = {
  'project/canvas.json': JSON.stringify({ v: 1, title: 'Launch screens', boards: FRAMES, order: ORDER }),
  'project/boards/phone.html': `<section id="phone" style="${ground}; padding:24px; gap:12px"><h1 id="title">Launch</h1><p id="lede">Ship the first week.</p><div id="cta" style="position:absolute; left:24px; top:740px; width:342px; height:56px; background:#2b7a78"></div></section>`,
  'project/boards/tablet.html': `<section id="tablet" style="${ground}; padding:48px"><h2 id="head">Dashboard</h2><p id="body">Three columns of numbers.</p></section>`,
  'project/boards/desktop.html': `<section id="desktop" style="${ground}; padding:64px; gap:24px">
<h2 id="head">Overview</h2>
<p id="para" style="width:600px">Detail of the week</p>
<div id="a" style="position:absolute; left:200px; top:500px; width:200px; height:120px; background:#ff0000"></div>
<div id="b" style="position:absolute; left:600px; top:500px; width:200px; height:120px; background:#00aa00"></div>
<x-shape id="c" kind="ellipse" style="position:absolute; left:1000px; top:600px; width:200px; height:200px; background:#0000ff"></x-shape>
<p id="note" style="position:absolute; left:200px; top:820px; width:800px">Edit me</p>
</section>`,
  'project/boards/poster.html': `<section id="poster" style="${ground}; padding:80px"><h1 id="title">Summer festival</h1><p id="dates">August 1 to 9</p></section>`,
  'project/boards/broken.html': `<section id="broken" style="${ground}"><h2 id="b">Broken</h2><blink>not a board element</blink></section>`,
};
