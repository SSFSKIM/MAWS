// Design systems in utility mode (docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md; `pnpm e2e:design-systems`).
// It reads the host's store file once (`pnpm e2e:design-systems` silences node:sqlite's ExperimentalWarning). M6's first cases, through A's store and L's library on a scratch instance: a fresh store is seeded with the built-in
// systems, which open from the library as the Design System page in an artifact tab (L's registry); and the owner's
// default chosen in Settings › Artifacts reaches the engine host (main's `artifacts.setDefaults`), so a document that
// names no system is pinned to it when a version is written (Acceptance 12 over the settings). M6b's case: the agent's
// `ask` with design_system questions, over C3's replay of a journal derived from E1's recorded blocking ask with only the
// ask's questions and its recorded answers rewritten (the replay matches the host's answers by request id; what the
// sheet submitted is asserted on the journal's own rows): the sheet lists the seeded systems with their swatches and
// origin, offers "Build one with me" where allowed, and answers `{designSystemId, name}` and `{create: true}`
// (Acceptance 14). M7 adds the rest of the group (Acceptance 9 to 14).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { AskAnswer, AskQuestion } from '@shared/maws/tools';
import type { AppSessionId } from '@shared/graph/ids';
import { invoke, launchReady, value } from './support/c7-replay';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { allowNext, fixtureRows, mcpResultOf, ofKind, PASS3, resultText, scene, show, type Frame, type McpResult, type Scene } from './support/maws-tools';

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
interface Row {
  id: string;
  title: string;
}

async function ok<T>(page: Page, name: string, input?: unknown): Promise<T> {
  const result = (await page.evaluate(([n, i]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke(n as string, i), [name, input] as const)) as Result<T>;
  if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
  return result.value;
}
// The application menu's item, clicked as main's menu would (settings.spec.ts's helper).
async function menu(app: ElectronApplication, id: string): Promise<void> {
  const click = () =>
    app.evaluate(({ Menu }, id) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById(id);
      if (!item?.enabled) return false;
      item.click();
      return true;
    }, id);
  await expect.poll(click, { message: `menu item ${id} exists and is enabled` }).toBe(true);
}
const systems = async (page: Page): Promise<Row[]> => (await ok<{ artifacts: Row[] }>(page, 'artifacts.list', { filter: { kind: 'design_system' } })).artifacts;
const titles = async (page: Page) => (await systems(page)).map((s) => s.title).sort();

const BUILT_IN = ['Classroom', 'MAWS', 'Official'];

let launch: MawsLaunch | null = null;

test.afterEach(async () => {
  await launch?.cleanup();
  launch = null;
});

async function ready(): Promise<Page> {
  launch = await launchMaws();
  const { page } = launch;
  await expect.poll(async () => (await ok<{ state: string }>(page, 'engine.hostState')).state, { timeout: 20_000, message: 'the engine host is ready' }).toBe('ready');
  await expect.poll(() => titles(page), { timeout: 15_000, message: 'the built-in systems are seeded' }).toEqual(BUILT_IN);
  return page;
}

test('a fresh store holds the built-in systems, and one opens from the library as the Design System page', async () => {
  test.setTimeout(90_000);
  const page = await ready();
  // `official` is seeded with its bundled faces, read from the build beside the engine-host chunk
  const official = (await systems(page)).find((s) => s.title === 'Official')!;
  const db = new DatabaseSync(join(launch!.userData, 'artifacts', 'store.sqlite'), { readOnly: true });
  try {
    const assets = db.prepare('SELECT name, size FROM artifact_assets WHERE artifactId = ? ORDER BY name').all(official.id) as { name: string; size: number }[];
    expect(assets.map((a) => a.name)).toEqual(['NotoSerifKR-Bold-full.woff2', 'NotoSerifKR-Regular-full.woff2', 'OFL.txt']);
    for (const asset of assets) expect(asset.size, asset.name).toBeGreaterThan(1000);
  } finally {
    db.close();
  }
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  const library = page.locator('[data-library]');
  for (const title of BUILT_IN) await expect(library.getByRole('article', { name: title, exact: true })).toBeVisible({ timeout: 15_000 });
  await library.getByRole('article', { name: 'MAWS', exact: true }).click();
  const house = (await systems(page)).find((s) => s.title === 'MAWS')!;
  const tab = page.locator(`[data-artifact-tab="${house.id}"]`);
  await expect(tab.locator(`[data-ds-page="${house.id}"]`)).toBeVisible({ timeout: 15_000 });
  await expect(tab.locator('.dsp-title')).toHaveText('MAWS');
  for (const section of ['palette', 'type', 'measures', 'canon', 'law', 'check']) await expect(tab.locator(`[data-ds-section="${section}"]`)).toBeAttached();
  await expect(tab.getByLabel('--ds-color-accent hex')).toBeVisible();
  // the owner looked at it: L's surface recorded the view once the page said it was on screen
  await expect.poll(async () => (await ok<{ artifact: { lastViewedAt: number | null } }>(page, 'artifacts.get', { artifactId: house.id })).artifact.lastViewedAt, { timeout: 10_000 }).not.toBeNull();
  expect(launch!.consoleErrors()).toEqual([]);
});

test('the owner’s default chosen in Settings reaches the host: a document naming no system is pinned to it', async () => {
  test.setTimeout(90_000);
  const page = await ready();
  const classroom = (await systems(page)).find((s) => s.title === 'Classroom')!;
  await menu(launch!.app, 'settings.open');
  const panel = page.locator('[data-region="main"]').getByRole('tabpanel');
  const select = panel.getByRole('combobox', { name: 'Default design system' });
  await expect(select).toBeVisible({ timeout: 15_000 });
  await expect(select.locator('option')).toHaveText(['House system', ...BUILT_IN]);
  await select.selectOption({ label: 'Classroom' });
  const settingsFile = join(launch!.userData, 'settings.json');
  await expect.poll(() => (JSON.parse(readFileSync(settingsFile, 'utf8')) as { artifacts: unknown }).artifacts).toEqual({ defaultDesignSystem: classroom.id, spaceDesignSystems: {} });

  const { artifact: doc } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'document', title: 'Syllabus' });
  await ok(page, 'artifacts.testWrite', { artifactId: doc.id, opId: 'ds-e2e-1', ops: [{ op: 'insertText', index: 0, text: 'Week one.' }] });
  // main pushes the defaults on every settings change; the pin follows once the host has them
  await expect
    .poll(async () => {
      await ok(page, 'artifacts.saveVersion', { artifactId: doc.id, label: `check ${Date.now()}` });
      const { versions } = await ok<{ versions: { designSystemRef?: { id: string } | null }[] }>(page, 'artifacts.versions', { artifactId: doc.id });
      return versions.at(-1)?.designSystemRef?.id ?? null;
    }, { timeout: 10_000 })
    .toBe(classroom.id);
  expect(launch!.consoleErrors()).toEqual([]);
});

// ---- M6b: the design_system ask (Acceptance 14) ------------------------------------------------------------------------

const ASK_BLOCKING = `${PASS3}/p1-maws-ask-blocking.jsonl`;
const ASK_TOOL_USE = 'toolu_012dCG4TE89gS8BSqhFFZnjS'; // the recorded ask's tool-use id, its askId
const QUESTIONS: AskQuestion[] = [
  { id: 'q1', question: 'Which of your design systems should the handout use?', header: 'Design system', modality: 'design_system', allowCreate: false },
  { id: 'q2', question: 'And the slides?', modality: 'design_system' },
];

// The fields of a journal frame the rewrite touches.
interface Block {
  type?: string;
  id?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
}
interface AskFrame {
  type?: string;
  event?: { delta?: { type?: string; partial_json?: string } };
  message?: { content?: Block[] | string };
  request?: { subtype?: string; tool_name?: string; input?: unknown; message?: { method?: string; params?: { name?: string; arguments?: unknown } } };
  response?: { response?: { updatedInput?: { questions?: unknown }; mcp_response?: { result?: { content?: { text?: string }[] } } } };
}

// E1's recorded blocking ask with `QUESTIONS` in place of its five: the tool_use, its streamed input (the whole input in
// the first delta, the others empty), the permission request and its answer, the tools/call; and the recorded answers in
// the results replaced by `answers`, so the transcript the replay feeds back reads the same answers the host wrote.
function designSystemAskJournal(dir: string, answers: AskAnswer[]): string {
  const input = { title: 'A look for the handout', questions: QUESTIONS };
  const result = JSON.stringify({ status: 'answered', askId: ASK_TOOL_USE, answers }, null, 2);
  let firstDelta = true;
  const rows = fixtureRows(ASK_BLOCKING).map((row) => {
    const frame = structuredClone(row.frame) as AskFrame;
    const delta = frame.event?.delta;
    if (frame.type === 'stream_event' && delta?.type === 'input_json_delta' && row.seq > 77 && row.seq < 130) {
      delta.partial_json = firstDelta ? JSON.stringify(input) : ''; // the ask's own content block (seq 77 to 130)
      firstDelta = false;
    }
    const blocks = Array.isArray(frame.message?.content) ? frame.message.content : [];
    if (frame.type === 'assistant') for (const block of blocks) if (block.type === 'tool_use' && block.id === ASK_TOOL_USE) block.input = input;
    if (frame.type === 'user') for (const block of blocks) if (block.type === 'tool_result' && block.tool_use_id === ASK_TOOL_USE) block.content = [{ type: 'text', text: result }];
    const request = frame.request;
    if (frame.type === 'control_request' && request?.subtype === 'can_use_tool' && request.tool_name === 'mcp__maws__ask') request.input = input;
    if (frame.type === 'control_request' && request?.message?.method === 'tools/call' && request.message.params?.name === 'ask') request.message.params.arguments = input;
    const response = frame.response?.response;
    if (frame.type === 'control_response' && response?.updatedInput?.questions !== undefined) response.updatedInput = input;
    const text = response?.mcp_response?.result?.content?.[0];
    if (frame.type === 'control_response' && text?.text?.includes(ASK_TOOL_USE)) text.text = result;
    return { ...row, frame: frame as Frame };
  });
  const path = join(dir, 'p3d-design-system-ask.jsonl');
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  return path;
}

// The derived journal launched under the session (an absolute path, which `replay` would read under the repository) and
// the recorded prompt sent, as `replay` does.
async function replayJournal(s: Scene, id: AppSessionId, journal: string): Promise<void> {
  await launchReady(s.page, id, journal, { cwd: s.repo });
  const prompt = (fixtureRows(ASK_BLOCKING).find((row) => row.direction === 'out' && (row.frame as Frame).type === 'user')!.frame as { message: { content: string } }).message.content;
  value(await invoke(s.page, 'session.send', { appSessionId: id, content: prompt }));
}

const rgbOf = (hex: string) => `rgb(${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(', ')})`;

test('the agent asks for a design system: the sheet lists the systems with their swatches and origin, offers Build one with me where allowed, and answers the chosen id or create', async () => {
  test.setTimeout(120_000);
  await scene({ titles: ['P3-D: a design system ask'], label: 'p3d-ask' }, async (s) => {
    const [id] = s.ids;
    await expect.poll(async () => (await systems(s.page)).map((system) => system.title).sort(), { timeout: 20_000, message: 'the built-in systems are seeded' }).toEqual(BUILT_IN);
    const classroom = (await systems(s.page)).find((system) => system.title === 'Classroom')!;
    const answers: AskAnswer[] = [
      { id: 'q1', question: QUESTIONS[0]!.question, status: 'answered', designSystemId: classroom.id, name: 'Classroom' },
      { id: 'q2', question: QUESTIONS[1]!.question, status: 'answered', create: true },
    ];
    await show(s, id);
    await replayJournal(s, id, designSystemAskJournal(s.scratch.root, answers));
    await s.pane.getByRole('group', { name: 'Session view' }).getByRole('button', { name: 'Transcript', exact: true }).click();
    await allowNext(s, id); // mcp__maws__ask

    const [opened] = ofKind(await s.events(id), 'maws.ask.opened');
    expect(opened).toMatchObject({ askId: ASK_TOOL_USE, blocking: true, questions: QUESTIONS });
    const sheet = s.panel.locator('[data-ask-sheet]');
    await expect(sheet).toHaveAttribute('data-ask-id', ASK_TOOL_USE);
    const section = (questionId: string) => sheet.locator(`section[data-question-id="${questionId}"]`);
    // every live system by name, in order, with "Build one with me" only where the question allows it
    await expect(section('q1').getByRole('radio')).toHaveText(BUILT_IN.map((title) => new RegExp(`^${title}`)));
    await expect(section('q2').getByRole('radio')).toHaveCount(BUILT_IN.length + 1);
    await expect(section('q2').getByRole('radio').last()).toHaveAccessibleName('Build one with me');
    for (const name of ['Decide for me', 'Skip']) await expect(section('q1').getByRole('button', { name })).toBeVisible();
    // a row: its origin and its five swatches, painted with the seeded system's own values
    const row = section('q1').locator(`[data-design-system="${classroom.id}"]`);
    await expect(row).toContainText('Built in');
    await expect(row.locator('[data-swatch]')).toHaveCount(5);
    // (the bundled file writes both as literal srgb colours with their hex)
    const bundled = JSON.parse(readFileSync(join(REPO_ROOT, 'src/artifacts/types/design_system/defaults/classroom/tokens.tokens.json'), 'utf8')) as { color: Record<'bg' | 'accent', { $root: { $value: { hex: string } } }> };
    for (const [swatch, role] of [['--ds-color-bg', 'bg'], ['--ds-color-accent', 'accent']] as const) {
      await expect.poll(() => row.locator(`[data-swatch="${swatch}"]`).evaluate((element) => getComputedStyle(element).backgroundColor), { message: swatch }).toBe(rgbOf(bundled.color[role].$root.$value.hex));
    }

    await section('q1').getByRole('radio', { name: 'Classroom' }).click();
    await section('q2').getByRole('radio', { name: 'Build one with me' }).click();
    await sheet.getByRole('button', { name: 'Submit', exact: true }).click();

    // the answers the host wrote to the engine: the system by its id and name, and the build request
    let written: McpResult | null = null;
    await expect.poll(() => (written = mcpResultOf(s.journal(id), opened!.requestId)) !== null, { timeout: 20_000 }).toBe(true);
    expect(JSON.parse(resultText(written!))).toEqual({ status: 'answered', askId: ASK_TOOL_USE, answers });
    const capsule = s.pane.locator('section.transcript-ask');
    await expect(capsule).toHaveAttribute('data-ask-state', 'answered');
    await expect(capsule.locator('[data-ask-answer]')).toHaveText(['Design system→Classroom', 'And the slides?→Build one with me']);
  });
});
