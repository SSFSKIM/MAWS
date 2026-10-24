// The agent's presence in a document, end to end (P3-F wave S, F19: the sitting's candidate 21; spec §2 item 2, "the
// agent's cursor and the blocks it is editing are visible while it works"; D11 of
// docs/doperpowers/plans/2026-10-12-p3-b-documents.md, presence published with the committed write). `pnpm
// e2e:document-app`, the product build, MAWS_HARNESS=0 per launch: the harness build's `#document` page has an in-memory
// host and no tool server, so it cannot script an agent's batch; this build can, through the host seam
// (`documents/kinds/document-perf.ts`, MAWS_DOCUMENT_PERF=1), which runs the real `artifact_edit` as a session.
//
// The owner's document is open in an `artifact` main tab and in the panel's Artifacts tool (two replicas); the owner
// types in the first paragraph while the agent's batch rewrites a sentence of the second and inserts a block after the
// third. The whole path is under test: the agent replica's awareness, the host's relay, each renderer replica's
// awareness, the editor's Presence and cursor plugins and the product CSS. A page-side recorder notes what each editor
// draws as it changes, so the outline is seen however briefly it holds; the case asserts what was drawn while it was
// up, that it goes, and that it was up for most of its 4 s hold (F19: the owner missed the 1.5 s one), and annotates the
// timeline (ms after the batch's answer). No engine runs; the profile is the case's own directory under /tmp.
import { openArtifactReplicaInPanel } from './support/shell';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { PerfSeam, type ReadResult } from './support/document-scale';
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

// The panel's harness scenario (C8a): two synthetic sessions main serves, so a session's panel can hold tools.
const SESSIONS = 'stub:test/fixtures/panel/harness-sessions.json';
// What an agent session with no title is called (src/shared/artifacts/actor.ts, actorDisplay); the owner is "You".
const AGENT_NAME = 'Claude';

async function start(): Promise<Page> {
  mkdirSync('/tmp/maws-harness/a', { recursive: true }); // session A's directory in the scenario
  userData = mkdtempSync('/tmp/maws-e2e-document-presence-');
  launch = await launchMaws({ userData, env: { MAWS_HARNESS: '0', MAWS_SESSION_SOURCE: SESSIONS, MAWS_DOCUMENT_PERF: '1' } });
  const { page } = launch;
  await expect.poll(async () => (await ok<{ state: string }>(page, 'engine.hostState')).state, { timeout: 20_000, message: 'the engine host is ready' }).toBe('ready');
  return page;
}

// Select the session that receives the artifact's panel surface; openInPanel pins it after transfer.
async function selectPanelSession(page: Page): Promise<void> {
  await (await sidebarRow(page, 'Harness A')).click();
}

// The owner's document, opened from the library in an `artifact` main tab.
async function openInMain(page: Page, title: string): Promise<{ id: string; main: Locator }> {
  const { artifact } = await ok<{ artifact: { id: string } }>(page, 'artifacts.create', { kind: 'document', title });
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click();
  await page.locator('[data-library]').getByRole('article', { name: title, exact: true }).click({ timeout: 15_000 });
  const main = page.locator(`[data-artifact-tab="${artifact.id}"]`);
  await expect(main.locator('.ds-doc .ProseMirror[data-editor="live"]')).toBeVisible({ timeout: 15_000 });
  return { id: artifact.id, main };
}

// The same document in the pinned Artifacts tool's record view.
async function openInPanel(page: Page, artifactId: string): Promise<Locator> {
  const panel = page.locator('[data-region="panel"]');
  await openArtifactReplicaInPanel(page, artifactId);
  const record = panel.locator(`[data-artifact-record="${artifactId}"]`);
  await expect(record.locator('.ds-doc .ProseMirror[data-editor="live"]')).toBeVisible({ timeout: 15_000 });
  return record;
}

// The replica behind the editor under `scope` has nothing the host has not acknowledged.
async function durable(scope: Locator): Promise<void> {
  const unsaved = () =>
    scope.locator('.ds-doc .ProseMirror[data-editor="live"]').evaluate((el) => {
      const editor = (el as HTMLElement & { editor?: { extensionManager: { extensions: Array<{ name: string; options: { hold?: { base: { state(): { unsaved: number } } } } }> } } }).editor;
      return editor?.extensionManager.extensions.find((extension) => extension.name === 'collaboration')?.options.hold?.base.state().unsaved ?? -1;
    });
  await expect.poll(unsaved, { timeout: 10_000, message: 'every edit acknowledged by the host' }).toBe(0);
}

type Region = 'main' | 'panel';
// What one editor draws of the others' presence: each outlined block (its label, its text, the outline's computed style
// and the label's `::after` content) and each remote cursor (its label, its computed bar, whether it sits in an outline).
interface Drawn {
  outlines: { name: string; text: string; outline: string; label: string }[];
  cursors: { name: string; bar: string; inOutline: boolean }[];
}
interface Sample extends Drawn {
  at: number; // Date.now() in the page
  region: Region;
}

// Records, from now on, every change in what the two editors draw of the others' presence.
async function recordPresence(page: Page, artifactId: string): Promise<() => Promise<Sample[]>> {
  await page.evaluate((id) => {
    const roots: Record<Region, string> = {
      main: `[data-artifact-tab="${id}"] .ds-doc .ProseMirror[data-editor="live"]`,
      panel: `[data-region="panel"] [data-artifact-record="${id}"] .ds-doc .ProseMirror[data-editor="live"]`,
    };
    const samples: Sample[] = [];
    const last: Partial<Record<Region, string>> = {};
    (window as unknown as { __presence: Sample[] }).__presence = samples;
    const sample = () => {
      for (const region of ['main', 'panel'] as const) {
        const root = document.querySelector(roots[region]);
        if (!root) continue;
        const drawn: Drawn = {
          outlines: Array.from(root.querySelectorAll<HTMLElement>('[data-agent-editing]')).map((el) => ({
            name: el.getAttribute('data-agent-editing') ?? '',
            text: el.textContent ?? '',
            outline: getComputedStyle(el).outlineStyle,
            label: getComputedStyle(el, '::after').content,
          })),
          cursors: Array.from(root.querySelectorAll<HTMLElement>('.ProseMirror-yjs-cursor')).map((el) => ({
            name: (el.textContent ?? '').replace(/⁠/g, ''),
            bar: getComputedStyle(el).borderLeftStyle,
            inOutline: el.closest('[data-agent-editing]') !== null,
          })),
        };
        const key = JSON.stringify(drawn);
        if (last[region] === key) continue;
        last[region] = key;
        samples.push({ at: Date.now(), region, ...drawn });
      }
    };
    sample();
    new MutationObserver(sample).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-agent-editing', 'class', 'style'] });
  }, artifactId);
  return () => page.evaluate(() => (window as unknown as { __presence: Sample[] }).__presence);
}

const agentDrawn = (sample: Sample) => sample.outlines.some((o) => o.name === AGENT_NAME) || sample.cursors.some((c) => c.name === AGENT_NAME);

test('the agent’s cursor and the blocks its batch edits are drawn in a main tab and in the panel while the owner types elsewhere, then go', async () => {
  test.setTimeout(120_000);
  const page = await start();
  const seam = new PerfSeam(join(userData!, 'document-perf'));
  await expect.poll(() => existsSync(join(seam.dir, 'in')), { message: 'the host seam is up' }).toBe(true);
  await selectPanelSession(page);
  const { id, main } = await openInMain(page, 'Presence review');
  const record = await openInPanel(page, id);
  const mainText = main.locator('.ds-doc .ProseMirror[data-editor="live"]');
  const panelText = record.locator('.ds-doc .ProseMirror[data-editor="live"]');

  await mainText.click();
  await page.keyboard.type('The kickoff is on Monday.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('The budget review is on Friday.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Risks are listed below.');
  await expect(mainText.locator('p')).toHaveText(['The kickoff is on Monday.', 'The budget review is on Friday.', 'Risks are listed below.']);
  await expect(panelText, 'the panel’s replica has it (its text also holds the main tab’s cursor label)').toContainText('Risks are listed below.', { timeout: 10_000 });
  await durable(main);
  await durable(record);

  // the agent reads the document, as a session's artifact_read does
  const agent = 'document-presence-agent';
  const read = await seam.call<ReadResult>(agent, 'artifact_read', { artifact: id });
  expect(read.isError, read.text).toBe(false);
  const idOf = (words: string) => {
    const line = read.result!.markdown.split('\n').find((l) => l.includes(words));
    const marker = line && /\^([0-9a-z]+)\s*$/.exec(line);
    if (!marker) throw new Error(`no block reads "${words}" in:\n${read.result!.markdown}`);
    return marker[1]!;
  };
  const budget = idOf('budget review');
  const risks = idOf('Risks are listed');

  const seen = await recordPresence(page, id);
  // the owner's caret at the end of the first paragraph, in the main tab
  await mainText.locator('p').first().click();
  await page.keyboard.press('End');
  await expect(mainText).toBeFocused();

  // the agent's batch (a sentence rewritten, a block inserted) while the owner types elsewhere
  const batch = seam.call<{ results: { newIds: string[] }[] }>(agent, 'artifact_edit', {
    artifact: id,
    baseRevision: 'last',
    ops: [
      { op: 'replace_text', block: budget, old: 'on Friday', new: 'on Thursday' },
      { op: 'insert', after: risks, markdown: 'The vendor may slip a week.' },
    ],
  });
  await page.keyboard.type(' Bring the notes.');
  const answer = await batch;
  const answeredAt = Date.now();
  expect(answer.isError, answer.text).toBe(false);
  await expect(panelText).toContainText('The budget review is on Thursday.', { timeout: 10_000 });
  await expect(panelText).toContainText('The vendor may slip a week.');
  await expect(panelText).toContainText('The kickoff is on Monday. Bring the notes.', { timeout: 10_000 });

  const drawnIn = async (region: Region) => (await seen()).filter((s) => s.region === region && agentDrawn(s));
  for (const region of ['main', 'panel'] as const) {
    await test.step(`${region}: the agent's outline and cursor are drawn while the outline is up`, async () => {
      const drawn = async () => {
        const samples = await drawnIn(region);
        // an outline in a resolved colour (a bad colour leaves no outline style) with its generated name label
        const outlined = samples.flatMap((s) => s.outlines.filter((o) => o.name === AGENT_NAME && o.outline === 'solid' && o.label !== 'none' && o.label !== 'normal').map((o) => o.text));
        // the agent's caret bar, at the start of the first block it edits
        const cursor = samples.some((s) => s.cursors.some((c) => c.name === AGENT_NAME && c.bar === 'solid' && c.inOutline));
        return { sentence: outlined.some((t) => t.includes('The budget review is on Thursday.')), inserted: outlined.some((t) => t.includes('The vendor may slip a week.')), cursor };
      };
      try {
        await expect.poll(drawn, { timeout: 10_000 }).toEqual({ sentence: true, inserted: true, cursor: true });
      } catch (error) {
        throw new Error(`${region}: the agent's presence was not drawn; what the editors drew since the batch: ${JSON.stringify(await seen())}`, { cause: error });
      }
    });
  }

  await test.step('the outline and the cursor go once the hold ends, in both editors', async () => {
    for (const scope of [mainText, panelText]) {
      await expect(scope.locator(`[data-agent-editing="${AGENT_NAME}"]`)).toHaveCount(0, { timeout: 20_000 });
      await expect(scope.locator('.ProseMirror-yjs-cursor', { hasText: AGENT_NAME })).toHaveCount(0);
    }
  });

  // the timeline, for the record: when each editor first drew the agent and when it last stopped, ms after the answer
  const samples = await seen();
  const timeline = Object.fromEntries(
    (['main', 'panel'] as const).map((region) => {
      const mine = samples.filter((s) => s.region === region);
      const first = mine.findIndex(agentDrawn);
      const gone = first < 0 ? -1 : mine.findIndex((s, i) => i > first && !agentDrawn(s));
      return [region, { drawnMs: first < 0 ? null : mine[first]!.at - answeredAt, goneMs: gone < 0 ? null : mine[gone]!.at - answeredAt, upMs: first < 0 || gone < 0 ? null : mine[gone]!.at - mine[first]!.at }];
    }),
  );
  test.info().annotations.push({ type: 'presence timeline (ms after the batch answered)', description: JSON.stringify(timeline) });
  console.log(`[document-presence] ${JSON.stringify(timeline)}`);
  // The outline holds 4 s after the batch commits (D11; F19). It is published in the batch's frame, just before the
  // commit, and both of its edges reach the page by the same relay, so its time on the page is the hold, give or take
  // how much later the page drew the first edge than the last. 3 s leaves a loaded machine a second of that and still
  // fails the 1.5 s hold. A region that never drew, or never stopped, reads -1.
  for (const region of ['main', 'panel'] as const) {
    expect(timeline[region]?.upMs ?? -1, `${region}: the agent's presence stays up for most of its 4 s hold; the timeline ${JSON.stringify(timeline)}`).toBeGreaterThanOrEqual(3_000);
  }
  expect(launch!.consoleErrors(), 'the console stays free of errors').toEqual([]);
});
