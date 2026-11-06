// The project channel's look through the gate (P5 O8 M7a Task 3, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md,
// M7a's "Touches", e2e; the Decision Log's "M7a is built as three tasks"). A project's Channel tab, opened from its row's
// menu, over a seeded channel with real-world variety: long member names, aliases, titles and machine names; an exchange
// of 40 messages folded, then opened in place; a phase-1 writer attested at migration, and its tail unverified from
// before the move; an earlier question from the log; a refused word and a not-sent one; the channel offline "as of" its
// last catch-up; and, under "Waiting on you", a permission and a question of the project's own sessions. The window, the
// stream's head and foot and the opened exchange's head and foot are attached as PNGs for the architect's look; the case asserts
// structure only: nothing in the tab is wider than its box, and every action is drawn whole inside its entry.
//
// The channel is seeded where no real log can hold it at once: under MAWS_E2E=1 a harness build's main answers
// `org.status` and the project's `org.channel.open` from a file the `org.*` schemas admit (src/main/org/channel-fixture.ts),
// so the real renderer draws what main would send. The waiting cards are attention's: C5's stub scenario holds the
// project (its sminos id the channel's) and two of its sessions, the permission's and the question's of the shell's own
// scenario (test/fixtures/shell/nine-sessions.json). `pnpm e2e:settings` builds the harness; under any other build the
// case skips.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { ChannelAnswer, ChannelEvent, ChannelSession, OrgMember, OrgStatus } from '../src/shared/ipc/schema/org';
import { memberNames } from '../src/shared/org/member-name';
import { CHANNEL } from '../src/renderer/src/channel/copy';
import { addressed } from './support/address';
import { launchMaws, REPO_ROOT } from './support/launch';

// A packaged app is built without the harness (`pnpm build:app`), whatever `out/` holds now; a plain build's main lacks the seam.
const HARNESS_BUILT = !process.env.MAWS_E2E_EXECUTABLE && existsSync(join(REPO_ROOT, 'out/renderer/harness.html'));
const FIXTURE_ENV = 'MAWS_E2E_CHANNEL'; // channel-fixture.ts's CHANNEL_FIXTURE_ENV

const PROJECT = '5d2c7e1a-9b3f-4c8d-a6e5-0f1b2c3d4e5f';
const PROJECT_ID = 'proj-northwind-clinical'; // the local project the scenario files the sessions under
const PROJECT_NAME = 'northwind-clinical-research-operations-platform-migration';
const S1 = 'e0ad139c-18bc-45bd-9489-be8653145f80';
const S2 = 'f1be24ad-29cd-46ce-a59a-cf9764256091';
const S3 = 'a2cf35be-3ade-46ce-a59a-df0875367102';
const S4 = 'b3d046cf-4bef-47df-b6ab-e01986478213';
const WAITING = ['app-3eb04b84', 'app-d095dc75']; // the scenario's permission and question sessions
const EXCHANGE = 40;

const memberId = () => randomBytes(16).toString('hex');
const nonce = () => randomBytes(16).toString('base64url');

/** The channel as main would answer it, offline, `now` the clock the times read from. */
function seededChannel(now: number): { status: Extract<OrgStatus, { state: 'registered' }>; answer: ChannelAnswer & { ok: true }; asOf: string } {
  const ana = { id: memberId(), email: 'ana.lopez@northwind.example' };
  const long = { id: memberId(), email: 'maximiliana.featherstonehaugh-villanueva-oyelaran@clinical-research-operations.northwind-health.example' };
  const names = memberNames([ana, long]);
  const member = (m: { id: string; email: string }): OrgMember => ({ ...m, name: names.get(m.id)! });

  const sessions: ChannelSession[] = [
    { session: S1, alias: 'maws-45', machine: 'studio-mini', title: 'Refactor the channel cache bound so a phase-one writer larger than both bounds still verifies once', member: true },
    { session: S2, alias: 'ci-optimization-coordinator-for-the-clinical-research-shards', machine: 'render-farm-03.clinical-research-operations.northwind-health', title: 'Rerun the flaky shards of the clinical research operations suite', member: true },
    { session: S3, alias: 'oldmini', machine: 'oldmini', title: null, member: false },
    { session: S4, alias: 'docs-writer', machine: 'studio-mini', title: 'Write the migration notes', member: true },
  ];
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
  const events: ChannelEvent[] = [];
  const add = (writer: string, body: Record<string, unknown>, rest: Pick<ChannelEvent, 'label'> & Partial<Pick<ChannelEvent, 'session' | 'by' | 'author' | 'owners'>>) => {
    const seq = events.filter((e) => e.writer === writer).length + 1;
    events.push({ offset: events.length, writer, seq, event: { writer, seq, ...body }, ...rest });
  };
  // A phase-1 writer: three events a machine attested at migration, and one past its attestation.
  for (const [i, text] of ['Starting the nightly import of the clinical shards.', 'Shard 3 of 8 is slow again.', 'Import done; 2 shards retried.', 'Leaving the old queue in place until the move.'].entries()) {
    add(`oldmini/${S3}`, { kind: 'say', from: 'oldmini', to: '*', text, ts: at(6 * 1440 - i) }, { session: S3, ...(i < 3 ? ({ label: 'migrated', by: 'studio-mini' } as const) : ({ label: 'legacy' } as const)) });
  }
  add(
    `oldmini/${S3}`,
    { kind: 'question', from: 'oldmini', text: ['Ship the migration tonight, or wait for the second review of the clinical research shards?'], choices: ['Ship tonight', 'Wait for the review'], ts: at(6 * 1440 - 5) },
    { session: S3, label: 'migrated', by: 'studio-mini' },
  );
  add(
    `hub/${long.id}`,
    { kind: 'human', from: 'human', member: long.id, to: '*', text: 'The review notes are at https://docs.northwind-health.example/clinical-research-operations/migrations/2026-11/channel-cache-bound-review-notes-final-final-v3.md — please read them before rerunning anything.', ts: at(95), created: at(95), nonce: nonce() },
    { label: 'verified', author: member(long) },
  );
  const lines = ['The cache bound evicts the prefix of the phase-one writer.', 'Rerunning shard 3 of 8 now.', 'Can you hold the merge until it lands?', 'Holding. The retry budget is at two of three.'];
  for (let i = 0; i < EXCHANGE; i++) {
    const [from, to] = i % 2 === 0 ? [sessions[0], sessions[1]] : [sessions[1], sessions[0]];
    add(
      `${from.machine}/${from.session}`,
      { kind: 'say', from: from.machine, to: [{ session: to.session, alias: to.alias }], text: `${lines[i % lines.length]} (${i + 1})`, ts: at(90 - i * 2), created: at(90 - i * 2) },
      { session: from.session, label: 'verified', owners: [member(ana), member(long)] },
    );
  }
  add(`studio-mini/${S4}`, { kind: 'say', from: 'studio-mini', to: '*', text: 'Migration notes drafted: docs/migrations/channel-cache-bound.md, with the eviction table and the checkpoint format.', ts: at(10), created: at(10) }, { session: S4, label: 'verified', owners: [member(ana)] });
  add(`hub/${ana.id}`, { kind: 'human', from: 'human', member: ana.id, to: '*', text: 'Thanks all. I will merge once shard 3 is green.', ts: at(8), created: at(8), nonce: nonce() }, { label: 'verified', author: member(ana) });

  const asOf = at(7);
  const answer: ChannelAnswer & { ok: true } = {
    ok: true,
    rev: 1,
    events,
    sessions,
    pending: [
      { nonce: nonce(), text: `@${sessions[1].alias} please keep the clinical shards out of tonight's rerun`, to: [{ session: S2, alias: sessions[1].alias }], state: { refused: 'not-reachable' } },
      { nonce: nonce(), text: 'Back in ten minutes; leave the merge to me.', to: '*', state: 'not-sent' },
    ],
    unverified: 2,
    asOf,
    live: false,
  };
  const status: Extract<OrgStatus, { state: 'registered' }> = {
    state: 'registered',
    org: 'northwind-health',
    hub: 'https://desk.northwind-health.example',
    member: { id: ana.id, email: ana.email },
    device: randomBytes(16).toString('base64url'),
    session: 'signed-in',
    hubAccess: 'unreachable',
    head: { version: 41, issued: at(3 * 1440) },
    problem: null,
    signer: null,
    pairing: null,
  };
  return { status, answer, asOf };
}

/** C5's stub scenario: the project the channel's sminos id joins, holding the shell scenario's permission and question sessions. */
function scenario(): unknown {
  const shell = JSON.parse(readFileSync(join(REPO_ROOT, 'test/fixtures/shell/nine-sessions.json'), 'utf8')) as Record<string, Array<Record<string, unknown>>>;
  const ours = (entry: Record<string, unknown>) => WAITING.includes((entry.appId ?? entry.appSessionId) as string);
  const titles = ['Approve the shard rerun on the clinical research operations cluster before the nightly window', 'Choose the colours for the migration dashboard'];
  return {
    version: 1,
    projects: [
      {
        id: PROJECT_ID,
        name: PROJECT_NAME,
        directory: `/Users/ana/Developer/${PROJECT_NAME}`,
        order: 0,
        createdAt: '2026-09-01T09:00:00.000Z',
        org: { key: `smns:${PROJECT}`, name: PROJECT_NAME, source: 'smns', smnsId: PROJECT },
      },
    ],
    sessions: shell.sessions.filter(ours).map((s, i) => ({ ...s, projectId: PROJECT_ID, title: { text: titles[i], source: 'user' } })),
    digests: shell.digests.filter(ours),
    engine: shell.engine.filter(ours),
    attention: shell.attention.filter(ours),
    timeline: [],
  };
}

// What is wider than its box under `root`: the root and every block that text lands in (an entry, its header, a bubble,
// a list, a card's own blocks, a party: its alias, which never gives way, past a party squeezed narrower). A text item
// too wide for its block shows as that block's overflow; a run truncated on purpose (a `truncate` span) is no fault. Each offender as `<tag> "<text>" scrollWidth > clientWidth`.
function overflowing(root: Element): string[] {
  return [root, ...Array.from(root.querySelectorAll('article, section, header, div, p, ol, ul, li, h2, button, [data-channel-party]'))]
    .filter((el) => el.scrollWidth > el.clientWidth)
    .map((el) => `${el.tagName.toLowerCase()}${el.hasAttribute('data-channel-entry') ? `[${el.getAttribute('data-channel-entry')}]` : ''} "${(el.textContent ?? '').slice(0, 60)}" ${el.scrollWidth} > ${el.clientWidth}`);
}

// Every action under `root` that is not drawn whole: each is scrolled into view first (the stream scrolls, which is no
// fault), then its four edges must lie inside its entry (or card, else `root`), inside every ancestor that clips (an
// overflow other than visible), and inside the window. Each offender as `"<text>" <box> outside <what> <box>`.
function actionsNotWhole(root: Element): string[] {
  type Box = { left: number; top: number; right: number; bottom: number };
  const inside = (a: Box, b: Box) => a.left >= b.left - 0.5 && a.top >= b.top - 0.5 && a.right <= b.right + 0.5 && a.bottom <= b.bottom + 0.5;
  const shown = (b: Box) => `${Math.round(b.left)},${Math.round(b.top)}..${Math.round(b.right)},${Math.round(b.bottom)}`;
  return Array.from(root.querySelectorAll('button')).flatMap((button) => {
    button.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    const box = button.getBoundingClientRect();
    const name = `"${(button.textContent ?? '').trim().slice(0, 60)}" ${shown(box)}`;
    if (box.width === 0 || box.height === 0 || getComputedStyle(button).visibility !== 'visible') return [`${name} not drawn`];
    const bounds: Array<[string, Box]> = [
      ['its entry', (button.closest('[data-channel-entry], [data-channel-card]') ?? root).getBoundingClientRect()],
      ['the window', { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }],
    ];
    for (let el = button.parentElement; el !== null; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
      const r = el.getBoundingClientRect();
      const left = r.left + el.clientLeft;
      const top = r.top + el.clientTop;
      bounds.push([`clipping ${el.tagName.toLowerCase()}`, { left, top, right: left + el.clientWidth, bottom: top + el.clientHeight }]);
    }
    return bounds.filter(([, b]) => !inside(box, b)).map(([what, b]) => `${name} outside ${what} ${shown(b)}`);
  });
}

// Two actions clipped on purpose, one across and one down, appended to `root` as entries (each marked `data-probe`,
// removed after): the check above must name both, or it proves nothing about the tab.
function addClippedProbes(root: Element): void {
  root.insertAdjacentHTML(
    'beforeend',
    '<div data-probe data-channel-entry="probe" style="overflow:hidden;width:40px"><button type="button" style="width:120px">wide probe</button></div>' +
      '<div data-probe data-channel-entry="probe" style="overflow:hidden;height:8px"><button type="button" style="height:24px">tall probe</button></div>',
  );
}

const scrollLog = (page: Page, to: 'top' | 'foot') =>
  page.locator(`[data-channel="${PROJECT}"] [role="log"]`).evaluate((el, where) => {
    el.scrollTop = where === 'top' ? 0 : el.scrollHeight;
  }, to);

test.skip(!HARNESS_BUILT, "the seeded channel needs a harness build's main (pnpm e2e:settings)");

test('channel: a seeded project channel offline, its exchange of 40 opened, its words refused and not sent, its waiting cards; each photographed; nothing overflows and every action is whole', async () => {
  test.setTimeout(120_000);
  const userData = realpathSync(mkdtempSync(join(tmpdir(), 'maws-channel-')));
  try {
    const { status, answer, asOf } = seededChannel(Date.now());
    const fixture = join(userData, 'channel.json');
    writeFileSync(fixture, JSON.stringify({ status, project: PROJECT, answer }));
    const stub = join(userData, 'channel-scenario.json');
    writeFileSync(stub, JSON.stringify(scenario()));
    // Classic scrollbars, which take width from the view, as on any Mac with a mouse attached (org-page.spec.ts's reason).
    const maws = await launchMaws({ userData, env: { [FIXTURE_ENV]: fixture, MAWS_SESSION_SOURCE: `stub:${stub}` }, appKitDefaults: { AppleShowScrollBars: 'Always' } });
    try {
      const { page } = maws;
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light'); // the app's default
      // Opened as a person opens it: the project row's menu, Channel.
      const row = page.locator(`[data-menu="project:${await addressed(page, PROJECT_ID)}"]`).first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.click({ button: 'right' });
      await page.getByRole('menuitem', { name: CHANNEL.menuItem, exact: true }).click();
      const channel = page.locator(`[data-channel="${PROJECT}"]`);
      const log = channel.getByRole('log');

      // Ready: the stream as folded, the words' states, the label lines, the count held back, the offline line, the cards.
      const exchange = channel.locator(`[data-channel-entry="exchange"][data-channel-label="verified"][data-count="${EXCHANGE}"]`);
      await expect(exchange).toHaveCount(1);
      await expect(channel.locator('[data-channel-entry="exchange"][data-channel-label="migrated"][data-count="3"]')).toHaveCount(1);
      await expect(channel.locator('[data-channel-provenance="migrated"]').first()).toHaveText(CHANNEL.migrated('studio-mini'));
      await expect(channel.locator('[data-channel-provenance="legacy"]')).toHaveText(CHANNEL.legacy);
      await expect(channel.locator('[data-channel-entry="host"][data-host="question"]')).toHaveCount(1);
      await expect(channel.locator('[data-word-state="refused"]')).toContainText(CHANNEL.refused('not-reachable'));
      await expect(channel.locator('[data-word-state="not-sent"]')).toContainText(CHANNEL.notSent);
      await expect(channel.locator(`[data-channel-unverified="${answer.unverified}"]`)).toHaveText(CHANNEL.unverified(answer.unverified));
      await expect(channel.locator('[data-channel-offline]')).toContainText(CHANNEL.offline.unreachable);
      await expect(channel.locator(`[data-channel-as-of="${asOf}"]`)).toBeVisible();
      await expect(channel.locator('[data-channel-composer]')).toHaveCount(0); // withdrawn offline
      const waiting = channel.locator('[data-channel-waiting]');
      await expect(waiting.locator('[data-channel-card]')).toHaveCount(2);
      await expect(waiting.locator('[data-channel-card$="/att-3eb04b84-permission"]')).toBeVisible();
      await expect(waiting.locator('[data-channel-card$="/att-d095dc75-question"]')).toBeVisible();

      await expect.poll(() => log.evaluate((el) => (el as HTMLElement).offsetWidth - el.clientWidth), { message: "the stream's scrollbar takes width (classic scrollbars)" }).toBeGreaterThan(0);
      await test.info().attach('channel-window', { body: await page.screenshot(), contentType: 'image/png' });
      await scrollLog(page, 'foot');
      await test.info().attach('channel-foot', { body: await channel.screenshot(), contentType: 'image/png' });
      await scrollLog(page, 'top');
      await test.info().attach('channel-head', { body: await channel.screenshot(), contentType: 'image/png' });

      // The exchange opened in place: its 40 messages, each under its sender.
      await exchange.getByRole('button').first().click();
      await expect(exchange.getByRole('button').first()).toHaveAttribute('aria-expanded', 'true');
      await expect(exchange.locator('[data-channel-exchange-messages] > li')).toHaveCount(EXCHANGE);
      // The stream clips what it scrolls past, so the opened exchange is photographed at its head and at its foot.
      const said = exchange.locator('[data-channel-exchange-messages] > li');
      await exchange.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
      await test.info().attach('channel-exchange-head', { body: await page.screenshot(), contentType: 'image/png' });
      await said.last().evaluate((el) => el.scrollIntoView({ block: 'end', behavior: 'instant' }));
      await test.info().attach('channel-exchange-foot', { body: await page.screenshot(), contentType: 'image/png' });

      expect(await channel.evaluate(overflowing), 'nothing in the Channel tab is wider than its box').toEqual([]);
      expect(await channel.getByRole('button').count(), 'the seeded channel offers its actions').toBeGreaterThan(0);
      expect(await channel.evaluate(actionsNotWhole), 'every action is drawn whole inside its entry').toEqual([]);
      // ...and the check sees a clipped action when there is one
      await channel.evaluate(addClippedProbes);
      const probed = await channel.evaluate(actionsNotWhole);
      await channel.evaluate((root) => root.querySelectorAll('[data-probe]').forEach((probe) => probe.remove()));
      expect(probed.some((line) => line.startsWith('"wide probe"')) && probed.some((line) => line.startsWith('"tall probe"')), `the check names both probes: ${probed.join('; ')}`).toBe(true);
    } finally {
      await maws.cleanup();
    }
  } finally {
    rmSync(userData, { recursive: true, force: true });
  }
});
