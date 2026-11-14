// The measurement of a full-length search against the daemon's other work (UX wave U6c,
// docs/doperpowers/plans/2026-11-12-ux-wave-U6c-linked-file.md, M1 decision 8; acceptance A9). It writes a transcript of
// invented records `NAMED_SCAN_BYTES` long into a scratch store, in the proportions a long transcript has (two thirds the
// engine's request records and file snapshots, the rest conversation rows, tool calls and their results), with one row in
// a hundred mentioning the path in prose and linking a sibling of it (`<path>.bak`): a line the search must parse, whose
// link runs the whole of `clickPath`, the URL step included, and which names nothing. Its newest line, the first the
// search meets, is one row just under the row bound holding 100,000 such links (the branch review's finding 2: the rule
// works one row in bounded steps). It starts a search for that path, which finds nothing, and while it runs times fifty `files.list` calls, one after another, to a real files
// service over a small scratch folder in the same process. Timing only, so it runs on request, on the build VM:
// `MAWS_NAMED_MEASURE=1 pnpm exec vitest run src/services/files/named.measure.test.ts`. It writes about 1 GiB and
// removes it.
import { mkdirSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { StoreFixture } from '../../../test/support/store-fixture';
import { createNamedPaths, NAMED_ROW_BYTES, NAMED_SCAN_BYTES } from './named';
import { createFilesService } from './service';

const S = 'app-measured' as AppSessionId;
const P = '/work/out/measured-report.md';
const LISTS = 50;
const DENSE_LINKS = 100_000;

// One block of records, repeated to the bound's length.
function block(): Buffer {
  const lines: string[] = [];
  let rows = 0; // the conversation rows and tool results so far: one in a hundred mentions the path
  const prose = () => (rows++ % 100 === 0 ? `The draft is at ${P} for now; the old one is [the backup](${P}.bak).` : 'Nothing to report on this step.');
  for (let i = 0; i < 3000; i += 1) {
    const turn = `${'lorem ipsum dolor sit amet '.repeat(20)}${i % 3 === 2 ? prose() : 'Nothing to report on this step.'}`;
    if (i % 3 !== 2) {
      // two thirds: the engine's request records (the conversation again) and file snapshots
      lines.push(i % 9 === 0 ? JSON.stringify({ type: 'file-history-snapshot', messageId: `m-${i}`, snapshot: { trackedFileBackups: { '/work/repo/a.ts': { backupFileName: `b-${i}`, version: 1 } } } }) : JSON.stringify({ type: 'api-request', requestId: `r-${i}`, messages: [{ role: 'user', content: turn }, { role: 'assistant', content: turn }] }));
    } else if (i % 4 === 0) {
      lines.push(JSON.stringify({ type: 'assistant', uuid: `a-${i}`, message: { role: 'assistant', content: [{ type: 'text', text: turn }, { type: 'tool_use', id: `toolu_${i}`, name: 'Bash', input: { command: 'make test' } }] } }));
    } else if (i % 4 === 1) {
      lines.push(JSON.stringify({ type: 'user', uuid: `u-${i}`, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${i - 1}`, content: `${'ok '.repeat(400)}${turn.slice(-40)}` }] }, toolUseResult: { stdout: 'ok', stderr: '' } }));
    } else lines.push(JSON.stringify({ type: 'user', uuid: `u-${i}`, message: { role: 'user', content: turn } }));
  }
  return Buffer.from(`${lines.join('\n')}\n`);
}

describe.skipIf(process.env.MAWS_NAMED_MEASURE !== '1')('the daemon is not held by a search of the whole bound', () => {
  it(`fifty files.list calls while a ${NAMED_SCAN_BYTES} byte search finds nothing`, { timeout: 15 * 60_000 }, async () => {
    const fixture = await StoreFixture.create();
    try {
      const file = await fixture.addTranscript('/work/repo', 'engine-session-measured', []);
      const handle = await open(file, 'a');
      const bytes = block();
      for (let written = 0; written < NAMED_SCAN_BYTES; written += bytes.length) await handle.write(bytes);
      const dense = JSON.stringify({ type: 'assistant', uuid: 'a-dense', message: { role: 'assistant', content: [{ type: 'text', text: `[b](${P}.bak) `.repeat(DENSE_LINKS) }] } });
      expect(Buffer.byteLength(dense)).toBeLessThan(NAMED_ROW_BYTES); // a row the search parses, not one it passes over
      await handle.write(`${dense}\n`);
      await handle.close();

      const root = join(fixture.configHome, 'listed');
      mkdirSync(root);
      for (let i = 0; i < 40; i += 1) writeFileSync(join(root, `file-${i}.txt`), `content ${i}\n`);
      const LISTED = 'app-listed' as AppSessionId;
      const files = createFilesService({ records: (id) => (id === LISTED ? { directory: root, additionalDirectories: [], worktree: null } : null) });

      const named = createNamedPaths({ transcript: async () => file, bounds: { waitMs: 15 * 60_000 } }); // the search's own time, past a waiter's patience
      const started = performance.now();
      let searchEnded = 0;
      const searched = named.names(S, P).then((value) => ((searchEnded = performance.now()), value));
      const lists: number[] = [];
      let listsEnded = 0;
      for (let i = 0; i < LISTS; i += 1) {
        const before = performance.now();
        const listed = await files.list({ appSessionId: LISTED, path: root });
        lists.push(performance.now() - before);
        expect(listed.entries.length).toBe(40);
        listsEnded = performance.now();
      }
      expect(await searched).toBe(false);
      files.dispose();

      const sorted = [...lists].sort((a, b) => a - b);
      const median = (sorted[LISTS / 2 - 1]! + sorted[LISTS / 2]!) / 2;
      console.log(`named: search ${Math.round(searchEnded - started)} ms; list median ${median.toFixed(1)} ms, worst ${sorted[LISTS - 1]!.toFixed(1)} ms`);
      expect(listsEnded).toBeLessThan(searchEnded); // every list was answered while the search ran
    } finally {
      await fixture.dispose();
    }
  });
});
