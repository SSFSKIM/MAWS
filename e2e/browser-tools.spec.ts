// E4c's `browser-tools` group (docs/doperpowers/plans/2026-10-06-e4c-browser-tools.md, Acceptance G1 and G2, Design
// §13): the agent's browser tools on the real Electron, against E4c's server on the fixed loopback port
// (support/browser-tools-server.ts), in the product app over the replay.
//
// (generator) under MAWS_E4C_GENERATE=1 only: the live recording's call sequence through the e2e seam, its two
// snapshots written to test/fixtures/browser/{form,done}.snapshot.txt, which the recording's stand-in answers from;
// (1) the precondition of the replay: a fresh launch running the same sequence mints the same tab id and yields the
// fixtures byte for byte (Playwright numbers refs by traversal order in one document under one connection sequence),
// so a drift fails here rather than deep in the replay.
// Runs under `pnpm e2e:browser-tools` (a harness build, MAWS_HARNESS=1 for playwright.config.ts's list); each launch
// passes MAWS_HARNESS=0, so the window is the product app.
import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { AppSessionId } from '@shared/graph/ids';
import { show } from './support/deliverables-scene';
import { browserToolsScene, FIRST_TAB_ID, ORDER, readSnapshotFixture, recordedSequence, SNAPSHOT_FIXTURES } from './support/browser-tools-scene';

test.describe.configure({ timeout: 180_000 });

test('generator: the recording’s sequence writes the snapshot fixtures', async () => {
  test.skip(process.env.MAWS_E4C_GENERATE !== '1', 'writes the fixtures only under MAWS_E4C_GENERATE=1');
  await browserToolsScene(['E4c: generate'], async (s) => {
    const [id] = s.ids as [AppSessionId];
    await show(s, id);
    const { tabId, form, done } = await recordedSequence(s, id);
    expect(tabId).toBe(FIRST_TAB_ID);
    expect(form).toContain('textbox "Name"');
    expect(done).toContain(ORDER.reference);
    writeFileSync(SNAPSHOT_FIXTURES.form, form);
    writeFileSync(SNAPSHOT_FIXTURES.done, done);
  });
});

test('(1) precondition: a fresh launch’s real snapshots of /form.html and /done.html equal the fixtures', async () => {
  await browserToolsScene(['E4c: precondition'], async (s) => {
    const [id] = s.ids as [AppSessionId];
    await show(s, id);
    const { tabId, form, done } = await recordedSequence(s, id);
    expect(tabId).toBe(FIRST_TAB_ID);
    expect(form).toBe(readSnapshotFixture('form'));
    expect(done).toBe(readSnapshotFixture('done'));
  });
});
