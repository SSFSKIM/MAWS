// P3-F W-E: the deck scale gate's in-job heavy deck (e2e/support/deck-history.ts). The soak itself never runs here (it
// runs once, inside the gate's job): a stand-in script takes its place for the generation's outcomes, and the export's
// check reads small files written for each case (no binary fixture).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Y from '@y/y';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkDeckHistory, DECK_HISTORY_FILES, DECK_HISTORY_SOAK, DECK_HISTORY_SOAK_ARGS, DECK_HISTORY_SOAK_SCRIPT, deckHistoryLogic, generateDeckHistory, nodeStripsTypes } from '../../e2e/support/deck-history';

let scratch: string;
let exported: string;
let scripts: string;
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'maws-deck-history-test-'));
  exported = join(scratch, 'export');
  scripts = join(scratch, 'scripts');
  mkdirSync(exported);
  mkdirSync(scripts);
});
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

const META = { month: 3, versionAt: '2026-07-05 11:00', kind: 'auto', enc: 'delta', provenanceRows: 120, s7aWalk: { slides: 82, elements: 0 }, ms: { state: 3.1, total: 9.4 }, restores: [], soak: DECK_HISTORY_SOAK, workload: { updates: 900 }, filesView: { prev: 'a1', next: 'b2' } };
function exportWith(meta: unknown = META, skip: string[] = [], empty: string[] = []): void {
  for (const name of DECK_HISTORY_FILES) {
    if (skip.includes(name)) continue;
    const body = empty.includes(name) ? '' : name === 'meta.json' ? (typeof meta === 'string' ? meta : JSON.stringify(meta)) : `${name} bytes`;
    writeFileSync(join(exported, name), body);
  }
}
const script = (name: string, body: string) => {
  const path = join(scripts, name);
  writeFileSync(path, body);
  return path;
};

describe('the heavy deck export’s check', () => {
  it('accepts the four files with a complete meta.json, answering each file’s size and SHA-256 and the meta', () => {
    exportWith();
    const check = checkDeckHistory(exported, { generated: true });
    expect(check).toMatchObject({ ok: true, meta: { kind: 'auto', soak: DECK_HISTORY_SOAK, filesView: { prev: 'a1' } }, files: { 'prev.bin': { bytes: 14, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) } } });
    // a named export (M8's, before the soak descriptor) is read without one
    const older = Object.fromEntries(Object.entries(META).filter(([key]) => !['soak', 'workload', 'filesView'].includes(key)));
    exportWith(older);
    expect(checkDeckHistory(exported, { generated: false })).toMatchObject({ ok: true });
    expect(checkDeckHistory(exported, { generated: true })).toMatchObject({ ok: false, reason: expect.stringMatching(/soak/) });
  });

  it('refuses by name a missing or empty file and a meta.json that is not JSON', () => {
    exportWith(META, ['next.bin']);
    expect(checkDeckHistory(exported, { generated: true })).toEqual({ ok: false, reason: expect.stringMatching(/no next\.bin/) });
    exportWith(META, [], ['attrs.bin']);
    expect(checkDeckHistory(exported, { generated: true })).toEqual({ ok: false, reason: expect.stringMatching(/attrs\.bin is empty/) });
    exportWith('{"month": 3,');
    expect(checkDeckHistory(exported, { generated: true })).toEqual({ ok: false, reason: expect.stringMatching(/not JSON/) });
    exportWith('[1]');
    expect(checkDeckHistory(exported, { generated: true })).toEqual({ ok: false, reason: expect.stringMatching(/not an object/) });
  });

  it('refuses a consumer field that is not finite, a version kind that is not one, a timestamp that does not parse, or another soak', () => {
    const refused = (patch: Record<string, unknown>, field: RegExp) => {
      exportWith({ ...META, ...patch });
      expect(checkDeckHistory(exported, { generated: true })).toEqual({ ok: false, reason: expect.stringMatching(field) });
    };
    refused({ month: 0 }, /month/);
    refused({ versionAt: 'yesterday' }, /versionAt/);
    refused({ versionAt: '2026-13-45 99:99' }, /versionAt/);
    refused({ kind: 'deck' }, /kind is not a version kind/);
    refused({ enc: '' }, /enc/);
    refused({ provenanceRows: null }, /provenanceRows/);
    refused({ s7aWalk: { slides: 82 } }, /s7aWalk/);
    refused({ ms: { total: 'fast' } }, /ms/);
    refused({ ms: {} }, /ms/);
    refused({ soak: { ...DECK_HISTORY_SOAK, profile: 'normal' } }, /soak/);
    refused({ soak: { ...DECK_HISTORY_SOAK, seed: 12 } }, /soak/);
    refused({ month: 2 }, /month/);
  });
});

describe('the heavy deck’s generation', () => {
  it('runs S7a’s supported command with --export into the directory', () => {
    expect([DECK_HISTORY_SOAK_SCRIPT, ...DECK_HISTORY_SOAK_ARGS]).toEqual(['spikes/p3-store/s7/soak/soak.mjs', '--kind', 'deck', '--profile', 'heavy', '--encoding', 'delta', '--months', '3']);
  });

  it('answers a run that wrote the export, with its wall time, loads, exit and output', async () => {
    const stub = script('ok.mjs', `import { writeFileSync } from 'node:fs'; const dir = process.argv[process.argv.indexOf('--export') + 1]; for (const n of ['prev.bin', 'next.bin', 'attrs.bin']) writeFileSync(dir + '/' + n, 'x'); writeFileSync(dir + '/meta.json', ${JSON.stringify(JSON.stringify(META))}); console.log('month 3: done', process.argv.slice(2).join(' '));`);
    const run = await generateDeckHistory(exported, { root: scratch, timeoutMs: 20_000, script: stub });
    expect(run).toMatchObject({ ok: true, exitCode: 0, signal: null, timeoutMs: 20_000, loadStart: expect.any(Number), loadEnd: expect.any(Number), wallMs: expect.any(Number) });
    expect(run.stdoutTail).toContain(`--kind deck --profile heavy --encoding delta --months 3 --export ${exported}`);
    expect(run.command.slice(1)).toEqual([stub, ...DECK_HISTORY_SOAK_ARGS, '--export', exported]);
    expect(checkDeckHistory(exported, { generated: true })).toMatchObject({ ok: true });
  });

  it('fails by name a run that exits non-zero, one past its budget, and a Node that cannot strip types', async () => {
    const failing = script('fail.mjs', `console.error('Error: the store could not open'); process.exit(3);`);
    expect(await generateDeckHistory(exported, { root: scratch, timeoutMs: 20_000, script: failing })).toMatchObject({ ok: false, exitCode: 3, reason: expect.stringMatching(/exited 3: Error: the store could not open/), stderrTail: expect.stringContaining('could not open') });
    const slow = script('slow.mjs', `setTimeout(() => {}, 60_000);`);
    expect(await generateDeckHistory(exported, { root: scratch, timeoutMs: 300, script: slow })).toMatchObject({ ok: false, reason: expect.stringMatching(/did not finish within 0\.3 s/) });
    expect(await generateDeckHistory(exported, { root: scratch, timeoutMs: 20_000, script: failing, typescript: false })).toMatchObject({ ok: false, wallMs: 0, exitCode: null, reason: expect.stringMatching(/does not strip \.ts types/) });
  });

  it('reads whether Node strips `.ts` types from Node’s own report', () => {
    expect(['strip', 'transform', false, null].map((typescript) => nodeStripsTypes(typescript))).toEqual([true, true, false, false]);
  });
});

describe('the soak’s repeatability', () => {
  // P4 (the tracker's fixed-descriptor row): the repository's soak at a short descriptor with a restore (the normal
  // profile restores on day 9), generated twice. The two agree on the logic the gate's runs are compared by, and their
  // states hold the same authors (client ids and clocks): restores authored under Yjs's random ids made the heavy
  // descriptor's runs part.
  const SHORT = ['--kind', 'deck', '--profile', 'normal', '--encoding', 'delta', '--months', '1', '--no-truth'];
  const authors = (file: string) => [...Y.decodeStateVector(Y.encodeStateVectorFromUpdateV2(readFileSync(file)))].sort(([a], [b]) => a - b);

  it('generates the same logical history twice for one descriptor', async () => {
    const [a, b] = await Promise.all(
      ['a', 'b'].map(async (run) => {
        const dir = join(scratch, run);
        mkdirSync(dir);
        const generation = await generateDeckHistory(dir, { root: join(import.meta.dirname, '../..'), timeoutMs: 150_000, args: [...SHORT, '--suffix', `repeat-${run}`] });
        expect(generation).toMatchObject({ ok: true });
        const check = checkDeckHistory(dir, { generated: false });
        if (!check.ok) throw new Error(check.reason);
        return { logic: deckHistoryLogic(check.meta), authors: { prev: authors(join(dir, 'prev.bin')), next: authors(join(dir, 'next.bin')) } };
      }),
    );
    expect(a!.logic.restores).toHaveLength(1); // the descriptor still restores
    expect(b).toEqual(a);
  }, 300_000);
});
