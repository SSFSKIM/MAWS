// P3-C M10 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, Acceptance 7): the deck's scale seam in the engine
// host, requested only under MAWS_E2E=1 and MAWS_PRESENTATIONS_SCALE=1. It runs an agent session's `artifact_read` and
// `artifact_publish` through A's real tools (the publish through A's `publishDoc` and the deck's three-way publish),
// with `baseRevision: 'last'` standing for the revision the session last saw, and answers each call's wall time, the
// host loop's longest gap over it and the loop's busy time (event-loop utilization) over it; commands arrive as files in
// `<userData>/presentations-scale/in` and are answered in `out` (B's channel).
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPresentationAdapter } from '@artifacts/slides/adapter';
import { benchDeckFiles } from '@artifacts/slides/fixtures/bench';
import { artifactCreateTool } from '../tool-server/artifact-tools';
import { openWorld, textOf, type World } from '../tool-server/artifact-world.fixture';
import { DeckScaleSeam, presentationsScaleSeamRequested, startPresentationsScaleSeam, type DeckCallAnswer } from './scale-seam';

let world: World;
beforeEach(() => {
  world = openWorld();
  world.store.registerAdapter(createPresentationAdapter());
});
afterEach(() => world.close());

const SLIDE = 'project/slides/s006.html';

async function deck(slides = 8): Promise<string> {
  const result = await artifactCreateTool(world.deps()).call({ kind: 'presentation', title: 'Bench', files: benchDeckFiles(slides) }, world.ctx());
  if (result.isError) throw new Error(textOf(result));
  return (JSON.parse(textOf(result)) as { artifactId: string }).artifactId;
}

type Read = DeckCallAnswer & { result: { revision: number; files: Record<string, string> } };
type Published = DeckCallAnswer & { result: { revision: number; changed: string[] } };

describe('presentationsScaleSeamRequested', () => {
  it('is requested only under both the e2e mark and the scale flag', () => {
    expect(presentationsScaleSeamRequested({ MAWS_E2E: '1', MAWS_PRESENTATIONS_SCALE: '1' })).toBe(true);
    expect(presentationsScaleSeamRequested({ MAWS_E2E: '1' })).toBe(false);
    expect(presentationsScaleSeamRequested({ MAWS_PRESENTATIONS_SCALE: '1' })).toBe(false);
    expect(presentationsScaleSeamRequested({ MAWS_E2E: '0', MAWS_PRESENTATIONS_SCALE: '1' })).toBe(false);
  });
});

describe('the seam’s commands', () => {
  it('runs a session’s read, then a publish from the revision it last saw, measuring the host loop around each', async () => {
    const id = await deck();
    const seam = new DeckScaleSeam(world.store);
    try {
      const read = (await seam.run({ cmd: 'call', session: 'deck-agent', tool: 'artifact_read', args: { artifact: id } })) as Read;
      expect(read).toMatchObject({ ok: true, isError: false });
      const text = read.result.files[SLIDE]!;
      expect(text).toContain('font-size:64px');
      const published = (await seam.run({ cmd: 'call', session: 'deck-agent', tool: 'artifact_publish', args: { artifact: id, baseRevision: 'last', files: { [SLIDE]: text.replace('font-size:64px', 'font-size:66px') } } })) as Published;
      expect(published).toMatchObject({ ok: true, isError: false });
      expect(published.result.changed).toEqual([SLIDE]);
      expect(published.result.revision).toBe(world.store.revision(id));
      for (const answer of [read, published]) {
        expect(answer.wallMs).toBeGreaterThan(0);
        expect(answer.loop.max).toBeGreaterThan(0);
        // the busy time holds the longest stretch (a gap within twice the tick counts as idle); it is not bounded by the
        // call's wall time, since the turns after the call count too (a loaded runner read 185 ms against a 164 ms call)
        expect(answer.busyMs).toBeGreaterThanOrEqual(answer.loop.max > 2 ? answer.loop.max - 1 : 0);
      }
      // 'last' follows the session: its publish is now its base, so a second publish from 'last' is not stale
      const again = (await seam.run({ cmd: 'call', session: 'deck-agent', tool: 'artifact_publish', args: { artifact: id, baseRevision: 'last', files: { [SLIDE]: text.replace('font-size:64px', 'font-size:68px') } } })) as Published;
      expect(again).toMatchObject({ ok: true, isError: false });
      expect(again.result.revision).toBeGreaterThan(published.result.revision);
    } finally {
      seam.close();
    }
  });

  it('answers a refusal as the tool’s error text, not a seam failure', async () => {
    const id = await deck();
    const seam = new DeckScaleSeam(world.store);
    try {
      const answer = (await seam.run({ cmd: 'call', session: 'never-read', tool: 'artifact_publish', args: { artifact: id, baseRevision: 'last', files: { [SLIDE]: '<section id="s006"></section>' } } })) as DeckCallAnswer;
      expect(answer).toMatchObject({ ok: true, isError: true });
      expect(answer.text).toMatch(/staleBase/);
    } finally {
      seam.close();
    }
  });

  it('ends a session’s replicas on release and answers an unknown command as a failure naming it', async () => {
    const id = await deck();
    const seam = new DeckScaleSeam(world.store);
    try {
      await seam.run({ cmd: 'call', session: 'deck-agent', tool: 'artifact_read', args: { artifact: id } });
      expect(await seam.run({ cmd: 'release', session: 'deck-agent' })).toEqual({ ok: true });
      const stale = (await seam.run({ cmd: 'call', session: 'deck-agent', tool: 'artifact_publish', args: { artifact: id, baseRevision: 'last', files: { [SLIDE]: '<section id="s006"></section>' } } })) as DeckCallAnswer;
      expect(stale.text).toMatch(/staleBase/); // a released session has read nothing
      expect(await seam.run({ cmd: 'nope' } as never)).toEqual({ ok: false, error: 'unknown command "nope"' });
    } finally {
      seam.close();
    }
  });
});

describe('the file channel', () => {
  it('answers a command file in `out` under the same name', { timeout: 30_000 }, async () => {
    const id = await deck(4);
    const dir = join(world.userData, 'presentations-scale');
    const served = startPresentationsScaleSeam(world.store, dir, () => {});
    try {
      writeFileSync(join(dir, 'in', '000001.tmp'), JSON.stringify({ cmd: 'call', session: 'deck-agent', tool: 'artifact_read', args: { artifact: id } }));
      renameSync(join(dir, 'in', '000001.tmp'), join(dir, 'in', '000001.json'));
      const out = join(dir, 'out', '000001.json');
      for (let k = 0; k < 1_000 && !existsSync(out); k++) await new Promise((resolve) => setTimeout(resolve, 20));
      expect(JSON.parse(readFileSync(out, 'utf8'))).toMatchObject({ ok: true, isError: false, result: { artifactId: id } });
    } finally {
      served.close();
    }
  });
});
