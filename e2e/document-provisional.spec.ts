// P4-A2 (X35; docs/doperpowers/plans/2026-10-19-p4-smoothing.md §2 item 9 and §4.2's four rules [binding];
// docs/doperpowers/plans/2026-10-19-p4-a2-agent-experience.md M6): the agent's edit seen as it is written, end to end
// without a model. `pnpm e2e:document-app`, the product build, MAWS_HARNESS=0, through the host seam
// (`documents/kinds/document-perf.ts`, MAWS_DOCUMENT_PERF=1), whose `stream` feeds the session's provisional emitter the
// call's input piece by piece as the normaliser's deltas would, and whose `call` then runs the real `artifact_edit`
// under the same tool-use id (the commit), or a batch the host refuses.
//
// Proved here, on the page the owner sees: presence from the first frame in which the call's `artifact` parses (before
// any op's text); the provisional text at the target block, growing as the input arrives, before the call runs; the
// real text replacing it with no sample in which the block shows neither and none in which it shows both (rule 2: the
// withdrawal and the write's application in one step); a refused batch (the owner changed the target block after the
// agent's read, so the batch is stale) withdrawn without trace, the blocks and the version list unchanged (rule 3); the
// composition case (rule 2 under the hold): a batch committed while the owner composes Korean in another block keeps
// its layer until the composition ends and releases the hold, then swaps without a gap, the owner's text exact; and
// rule 4: a layer aimed at the block the owner is composing in stays out of that block until the composition ends.
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test';
import { pieces, recordDrawing, swapOffenders } from './support/document-provisional';
import { imeStep, PerfSeam, type ReadResult } from './support/document-scale';
import { keystrokes } from './support/hangul';
import { launchMaws, type MawsLaunch } from './support/launch';
import { sidebarRow } from './support/sidebar';

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };

async function ok<T>(page: Page, name: string, input?: unknown): Promise<T> {
  const result = (await page.evaluate(([n, i]) => (window as unknown as { maws: { invoke(name: string, input: unknown): Promise<unknown> } }).maws.invoke(n as string, i), [name, input] as const)) as Result<T>;
  if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
  return result.value;
}

let launch: MawsLaunch | null = null;
let userData: string | null = null;

test.afterEach(async () => {
  await launch?.cleanup();
  launch = null;
  if (userData) rmSync(userData, { recursive: true, force: true });
  userData = null;
});

const SESSIONS = 'stub:test/fixtures/panel/harness-sessions.json'; // the panel's harness scenario (C8a)
const AGENT_NAME = 'Claude'; // an agent session with no title (src/shared/artifacts/actor.ts)
const AGENT = 'document-provisional-agent';
const NEW = 'on Thursday, after the review';
const EDITOR = (id: string) => `[data-artifact-tab="${id}"] .ds-doc .ProseMirror[data-editor="live"]`;

async function start(): Promise<{ page: Page; seam: PerfSeam }> {
  mkdirSync('/tmp/maws-harness/a', { recursive: true });
  userData = mkdtempSync('/tmp/maws-e2e-document-provisional-');
  launch = await launchMaws({ userData, env: { MAWS_HARNESS: '0', MAWS_SESSION_SOURCE: SESSIONS, MAWS_DOCUMENT_PERF: '1' } });
  const { page } = launch;
  await expect.poll(async () => (await ok<{ state: string }>(page, 'engine.hostState')).state, { timeout: 20_000, message: 'the engine host is ready' }).toBe('ready');
  const seam = new PerfSeam(join(userData, 'document-perf'));
  await expect.poll(() => existsSync(join(seam.dir, 'in')), { message: 'the host seam is up' }).toBe(true);
  await (await sidebarRow(page, 'Harness A')).click();
  return { page, seam };
}

// The owner's document, opened from the library in an `artifact` main tab, with three paragraphs typed and durable.
async function openDocument(page: Page, title: string): Promise<{ id: string; editor: Locator }> {
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'document', title });
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  await page.locator('[data-library]').getByRole('article', { name: title, exact: true }).click({ timeout: 15_000 });
  const editor = page.locator(EDITOR(artifact.id));
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await editor.click();
  await page.keyboard.type('The kickoff is on Monday.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('The budget review is on Friday.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Risks are listed below.');
  await expect(editor.locator('p')).toHaveText(['The kickoff is on Monday.', 'The budget review is on Friday.', 'Risks are listed below.']);
  await durable(editor);
  return { id: artifact.id, editor };
}

// The replica behind the editor has nothing the host has not acknowledged.
async function durable(editor: Locator): Promise<void> {
  const unsaved = () =>
    editor.evaluate((el) => {
      const instance = (el as HTMLElement & { editor?: { extensionManager: { extensions: Array<{ name: string; options: { hold?: { base: { state(): { unsaved: number } } } } }> } } }).editor;
      return instance?.extensionManager.extensions.find((extension) => extension.name === 'collaboration')?.options.hold?.base.state().unsaved ?? -1;
    });
  await expect.poll(unsaved, { timeout: 10_000, message: 'every edit acknowledged by the host' }).toBe(0);
}

const idOf = (read: ReadResult, words: string): string => {
  const line = read.markdown.split('\n').find((l) => l.includes(words));
  const marker = line && /\^([0-9a-z]+)\s*$/.exec(line);
  if (!marker) throw new Error(`no block reads "${words}" in:\n${read.markdown}`);
  return marker[1]!;
};

// The agent's read, as a session's `artifact_read` makes it, and the ids of the blocks the specs name.
async function agentRead(seam: PerfSeam, id: string): Promise<{ revision: number; kickoff: string; budget: string; risks: string }> {
  const read = await seam.call<ReadResult>(AGENT, 'artifact_read', { artifact: id });
  expect(read.isError, read.text).toBe(false);
  return { revision: read.result!.revision, kickoff: idOf(read.result!, 'kickoff'), budget: idOf(read.result!, 'budget review'), risks: idOf(read.result!, 'Risks are listed') };
}

test('the agent’s edit is seen as it is written: presence from the first delta, the provisional text at the target, the swap without a gap, a refused batch withdrawn without trace', async () => {
  test.setTimeout(120_000);
  const { page, seam } = await start();
  const { id, editor } = await openDocument(page, 'Provisional review');
  const { revision, budget, risks } = await agentRead(seam, id);
  const seen = await recordDrawing(page, EDITOR(id));

  // 1: the batch streams, then lands
  const INSERTED = 'The vendor may slip a week.';
  const toolUseId = 'toolu_provisional_1';
  const args = { artifact: id, baseRevision: revision, ops: [{ op: 'replace_text', block: budget, old: 'on Friday', new: NEW }, { op: 'insert', after: risks, markdown: INSERTED }] };
  const streamedAt = Date.now();
  const streamed = await seam.stream(AGENT, toolUseId, 'artifact_edit', pieces(JSON.stringify(args)), 25);
  await expect.poll(async () => (await seen()).some((s) => s.provisional.some((p) => p.id === toolUseId && p.op === 'replace_text' && p.text === NEW)), { timeout: 10_000, message: 'the whole new text drawn before the call' }).toBe(true);
  const before = await seen();
  const answer = await seam.call<{ revision: number; results: { newIds: string[] }[] }>(AGENT, 'artifact_edit', { ...args, toolUseId });
  expect(answer.isError, answer.text).toBe(false);
  await expect(editor.locator(`[data-id="${budget}"]`)).toHaveText(`The budget review is ${NEW}.`, { timeout: 10_000 });
  await expect(editor).toContainText(INSERTED);
  await expect(editor.locator('[data-provisional]')).toHaveCount(0);
  await expect.poll(async () => (await seen()).at(-1)?.provisional.length, { timeout: 5_000 }).toBe(0);

  const samples = await seen();
  const firstPresence = samples.find((s) => s.outlines.includes(AGENT_NAME));
  const firstLayer = samples.find((s) => s.provisional.some((p) => p.id === toolUseId));
  const texts = [...new Set(samples.flatMap((s) => s.provisional.filter((p) => p.id === toolUseId && p.op === 'replace_text').map((p) => p.text)))];
  const timeline = { frames: streamed.frames, firstPresenceMs: firstPresence ? firstPresence.at - streamedAt : null, firstLayerMs: firstLayer ? firstLayer.at - streamedAt : null, texts };
  test.info().annotations.push({ type: 'provisional timeline (ms after the stream began)', description: JSON.stringify(timeline) });
  console.log(`[document-provisional] ${JSON.stringify(timeline)}`);
  await test.step('presence from the first delta: the outline is drawn no later than the first provisional text', () => {
    expect(firstPresence, `the agent's outline was drawn; the first samples ${JSON.stringify(samples.slice(0, 6))}`).toBeDefined();
    expect(firstLayer, 'the layer was drawn').toBeDefined();
    expect(firstPresence!.at).toBeLessThanOrEqual(firstLayer!.at);
    expect(samples.filter((s) => s.provisional.some((p) => p.id === toolUseId)).every((s) => s.outlines.includes(AGENT_NAME)), 'the outline stays while the layer is up').toBe(true);
  });
  await test.step('the provisional text grows at the target block, in the agent’s colour, labelled, before the call', () => {
    expect(texts.length, `several lengths of the text were drawn: ${JSON.stringify(texts)}`).toBeGreaterThan(1);
    expect(texts.every((t) => NEW.startsWith(t))).toBe(true);
    expect(texts.at(-1)).toBe(NEW);
    const drawn = firstLayer!.provisional.find((p) => p.id === toolUseId)!;
    expect(drawn.by).toBe(AGENT_NAME);
    expect(drawn.inBlock).toBe(budget);
    expect(drawn.color).not.toBe('');
    expect(before.some((s) => s.provisional.some((p) => p.id === toolUseId && p.op === 'insert' && p.text.includes(INSERTED))), 'the inserted block drawn after the risks block').toBe(true);
    expect(before.every((s) => !s.blocks[budget]?.includes(NEW)), 'nothing of the batch is in the document before the call').toBe(true);
  });
  await test.step('the swap: no sample shows neither the layer nor the real text, and none shows both', () => {
    const { gaps, doubles } = swapOffenders(samples, toolUseId, 'replace_text', budget, NEW);
    expect(gaps, `a gap: the block showed neither the layer nor the write: ${JSON.stringify(gaps.map((s) => ({ at: s.at - streamedAt, block: s.blocks[budget] })))}`).toEqual([]);
    expect(doubles, 'a double: the layer stayed after its write landed').toEqual([]);
    expect(samples.at(-1)!.blocks[budget]).toBe(`The budget review is ${NEW}.`);
  });

  // 2: the owner changes the block the next batch names, so the batch is stale; it is seen, then withdrawn whole
  const versionsBefore = (await ok<{ versions: unknown[] }>(page, 'artifacts.versions', { artifactId: id })).versions.length;
  await editor.locator(`[data-id="${budget}"]`).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Bring the notes.');
  await durable(editor);
  const blocksBefore = (await seen()).at(-1)!.blocks;
  const staleId = 'toolu_provisional_stale';
  const STALE = 'The budget review moved to next week.';
  const stale = { artifact: id, baseRevision: answer.result!.revision, ops: [{ op: 'replace_block', id: budget, markdown: STALE }] };
  await seam.stream(AGENT, staleId, 'artifact_edit', pieces(JSON.stringify(stale)), 25);
  await expect.poll(async () => (await seen()).some((s) => s.provisional.some((p) => p.id === staleId && p.op === 'replace_block' && p.text === STALE)), { timeout: 10_000, message: 'the stale batch is seen' }).toBe(true);
  const refused = await seam.call<unknown>(AGENT, 'artifact_edit', { ...stale, toolUseId: staleId });
  expect(refused.isError, 'the stale batch is refused').toBe(true);
  expect(refused.text).toMatch(/staleTargets|notFound/);
  await expect(editor.locator('[data-provisional]')).toHaveCount(0, { timeout: 10_000 });
  const blocksAfter = (await seen()).at(-1)!.blocks;
  expect(blocksAfter, 'nothing of the refused batch is in the document').toEqual(blocksBefore);
  expect(blocksAfter[budget]).toBe(`The budget review is ${NEW}. Bring the notes.`);
  const versionsAfter = (await ok<{ versions: unknown[] }>(page, 'artifacts.versions', { artifactId: id })).versions.length;
  expect(versionsAfter, 'the history is untouched').toBe(versionsBefore);
  await expect(editor.locator(`[data-agent-editing="${AGENT_NAME}"]`)).toHaveCount(0, { timeout: 20_000 });
  expect(launch!.consoleErrors(), 'the console stays free of errors').toEqual([]);
});

test('a batch committed while the owner composes Korean elsewhere keeps its layer until the hold releases the write, then swaps without a gap; the composition is untouched', async () => {
  test.setTimeout(120_000);
  const { page, seam } = await start();
  const { id, editor } = await openDocument(page, 'Provisional composition');
  const { revision, kickoff, budget } = await agentRead(seam, id);
  const seen = await recordDrawing(page, EDITOR(id));

  // the owner's caret at the end of the first paragraph; a syllable composed and left open (no commit), which holds the
  // replica's remote frames (the composition hold, X24) for up to its 5 s cap
  await editor.locator(`[data-id="${kickoff}"]`).click();
  await page.keyboard.press('End');
  await expect(editor).toBeFocused();
  const cdp: CDPSession = await page.context().newCDPSession(page);
  const steps = keystrokes('한');
  const toolUseId = 'toolu_provisional_held';
  try {
    for (const step of steps.filter((s) => s.kind !== 'commit')) await imeStep(cdp, step, steps);
    const composingAt = Date.now();
    const args = { artifact: id, baseRevision: revision, ops: [{ op: 'replace_text', block: budget, old: 'on Friday', new: NEW }] };
    await seam.stream(AGENT, toolUseId, 'artifact_edit', pieces(JSON.stringify(args), 10), 15);
    const answer = await seam.call<{ revision: number }>(AGENT, 'artifact_edit', { ...args, toolUseId });
    expect(answer.isError, answer.text).toBe(false);
    expect(Date.now() - composingAt, 'the batch landed inside the hold’s cap').toBeLessThan(4_500);
    // the write is held with the composition: the layer stays, the block still reads the old words
    await page.waitForTimeout(300);
    const held = (await seen()).at(-1)!;
    expect(held.provisional.some((p) => p.id === toolUseId && p.text === NEW), `the layer stays while the owner composes: ${JSON.stringify(held)}`).toBe(true);
    expect(held.blocks[budget]).toBe('The budget review is on Friday.');
    expect(held.blocks[kickoff]).toBe('The kickoff is on Monday.한');
    // the composition ends: the hold releases the write, which lands with the layer's withdrawal in one step
    await cdp.send('Input.insertText', { text: '한' });
  } finally {
    await cdp.detach();
  }
  await expect(editor.locator(`[data-id="${budget}"]`)).toHaveText(`The budget review is ${NEW}.`, { timeout: 10_000 });
  await expect(editor.locator('[data-provisional]')).toHaveCount(0);
  await expect(editor.locator(`[data-id="${kickoff}"]`)).toHaveText('The kickoff is on Monday.한');
  const { gaps, doubles } = swapOffenders(await seen(), toolUseId, 'replace_text', budget, NEW);
  expect(gaps, 'no gap across the hold’s release').toEqual([]);
  expect(doubles, 'no double across the hold’s release').toEqual([]);
  expect(launch!.consoleErrors(), 'the console stays free of errors').toEqual([]);
});

test('a layer aimed at the block the owner is composing in stays out of that block until the composition ends (rule 4), and the composed syllable is intact', async () => {
  test.setTimeout(120_000);
  const { page, seam } = await start();
  const { id, editor } = await openDocument(page, 'Provisional same block');
  const { revision, budget } = await agentRead(seam, id);
  const seen = await recordDrawing(page, EDITOR(id));

  await editor.locator(`[data-id="${budget}"]`).click();
  await page.keyboard.press('End');
  await expect(editor).toBeFocused();
  const cdp: CDPSession = await page.context().newCDPSession(page);
  const steps = keystrokes('한');
  const toolUseId = 'toolu_provisional_same';
  try {
    for (const step of steps.filter((s) => s.kind !== 'commit')) await imeStep(cdp, step, steps);
    const args = { artifact: id, baseRevision: revision, ops: [{ op: 'replace_text', block: budget, old: 'on Friday', new: NEW }] };
    await seam.stream(AGENT, toolUseId, 'artifact_edit', pieces(JSON.stringify(args), 10), 15);
    await page.waitForTimeout(300);
    const composing = await seen();
    expect(composing.some((s) => s.outlines.includes(AGENT_NAME)), 'presence is drawn on the composing block').toBe(true);
    expect(composing.every((s) => !s.provisional.some((p) => p.id === toolUseId && p.inBlock === budget)), `nothing of the layer inside the composing block: ${JSON.stringify(composing.filter((s) => s.provisional.length > 0).slice(-2))}`).toBe(true);
    await cdp.send('Input.insertText', { text: '한' });
  } finally {
    await cdp.detach();
  }
  // the composition over: the layer appears inside the block (after the quote it replaces), the owner's syllable intact
  // at the block's end (the recorder reads the block's own words apart from the layer's widget)
  await expect(editor.locator(`[data-id="${budget}"] [data-provisional="${toolUseId}"]`)).toHaveText(NEW, { timeout: 10_000 });
  await expect.poll(async () => (await seen()).at(-1)?.blocks[budget]).toBe('The budget review is on Friday.한');
  const answer = await seam.call<{ revision: number }>(AGENT, 'artifact_edit', { artifact: id, baseRevision: revision, ops: [{ op: 'replace_text', block: budget, old: 'on Friday', new: NEW }], toolUseId });
  expect(answer.isError, answer.text).toBe(false);
  await expect(editor.locator(`[data-id="${budget}"]`)).toHaveText(`The budget review is ${NEW}.한`, { timeout: 10_000 });
  await expect(editor.locator('[data-provisional]')).toHaveCount(0);
  expect(launch!.consoleErrors(), 'the console stays free of errors').toEqual([]);
});
