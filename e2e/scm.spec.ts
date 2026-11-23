// E6's source control end to end (E6 execution document, acceptance item 2; Plan of Work T6.2), run by `pnpm e2e:scm`
// (MAWS_SCM_E2E=1; the spec skips itself otherwise, so `pnpm e2e` is unchanged). Every case launches the product app in
// stub mode over a fresh scratch from `buildScmScratch()` (a repository under /tmp, local bare remotes, a fake `gh`
// first on the captured login-shell PATH through the launcher's `prepare` seam, trust written into the launch's own
// config home), selects *Charter + research*, opens the Source control surface and reads it as a person does; what it
// asserts comes from the DOM and from the repository on disk. No engine runs; no remote command reaches a forge.
// When MAWS_E6_SHOTS names a directory, the page and themes cases write the evidence screenshots there.
//
// UX wave U5b-2 (docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md, M11; §H): Source control is a
// page to read and changes nothing (the owner's answer of 2026-11-13). The acting scenes left with the acting pane
// (stage, discard and commit; push; a reload during a push; the sheets' half of the pull request scene). *The page* reads
// its four parts over the scratch, follows a commit and a push made in the checkout, and at 360 and 280 px holds the
// frames' measured rulings (S4 to S7, S12, S13; Decision Log 30, 31 and 44), each by a measured rectangle, with a
// measured word (a span that draws its text by `::before`) asserted by its rectangle at each width, and two states the
// frames did not draw: a part whose first read is still out, and "Commits · latest" on a long branch at 280 px. Each
// measured pass first requires the states it measures drawn (a pull request with three phrases and three check counts, a
// commit 1,003 days old, gh's failure on a pass of its own for S7); the machine's label (S4) is measured where one is
// drawn, on B's page in e2e/remote.spec.ts. *A
// commit opens in Review* from its row. The pull request, untrusted and tokens scenes read the page; main still refuses
// a stage in an untrusted checkout, since the services keep serving the ten `scm.*` commands for a window of an older
// build.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import { isolatedGitEnv } from '../test/support/git-env';
import { menu, otherThemeColours } from './support/code-product';
import { launchMaws, test, type MawsLaunch } from './support/launch';
import { CHARTER } from './support/panel-support';
import { buildScmScratch, CHECKS_PASSED, prepareScm, scmLaunchEnv, type ScmScratch } from './support/scm-scratch';
import { sidebarOf, sidebarRow } from './support/sidebar';
import { mainTab, openSurface, sessionCard, sessionCards, showSessionCards, surface, unfoldSessionCard } from './support/shell';

test.skip(process.env.MAWS_SCM_E2E !== '1', 'the source control e2e runs under pnpm e2e:scm (MAWS_SCM_E2E=1)');

const SHOTS = process.env.MAWS_E6_SHOTS;

// ---- the product over a scratch ----------------------------------------------------------------------------------------------

interface Scm {
  maws: MawsLaunch;
  page: Page;
  scratch: ScmScratch;
}

interface ScmOptions {
  trust?: boolean; // default true
  gh?: 'fake' | 'none'; // default fake
  ghState?: 'ready' | 'unauthenticated' | 'missing'; // what scm.status must answer first; default: ready for fake, missing for none
  setup?(scratch: ScmScratch): void; // before the launch
}

async function withScm(options: ScmOptions, body: (p: Scm) => Promise<void>): Promise<void> {
  const scratch = buildScmScratch();
  const gh = options.gh ?? 'fake';
  let maws: MawsLaunch | null = null;
  try {
    options.setup?.(scratch);
    maws = await launchMaws({ env: scmLaunchEnv(scratch, gh), prepare: prepareScm(scratch, { trust: options.trust ?? true, gh }) });
    const { page } = maws;
    await expect(sidebarOf(page).locator('[data-kind="project"]').first()).toBeVisible({ timeout: 10_000 });
    await (await sidebarRow(page, CHARTER)).click();
    await expect(mainTab(page, CHARTER)).toHaveAttribute('aria-selected', 'true');
    const p = { maws, page, scratch };
    // UX wave U8b (A1): on a fresh profile Environment is open before anything unfolds it; its fold is then remembered.
    await showSessionCards(page);
    await expect(sessionCard(page, 'Environment').getByRole('button').first()).toHaveAttribute('aria-expanded', 'true');
    await showEnvironment(p);
    await expectGh(p, options.ghState ?? (gh === 'fake' ? 'ready' : 'missing'));
    await body(p);
    expect(maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
  } finally {
    await maws?.cleanup();
    scratch.cleanup();
  }
}

const invoke = (page: Page, name: 'scm.status' | 'scm.stage', input: Record<string, unknown>) =>
  page.evaluate(([name, input]) => window.maws.invoke(name as never, input as never), [name, input] as const) as Promise<{ ok: boolean; value?: unknown; error?: unknown }>;

// The gh MAWS resolved on the captured PATH: the scratch's fake (by path) before anything asks it about a PR, or none.
async function expectGh({ page, scratch }: Scm, state: 'ready' | 'unauthenticated' | 'missing'): Promise<void> {
  const result = await invoke(page, 'scm.status', { appSessionId: scratch.appSessionId });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  const gh = (result.value as { gh: { state: string; path?: string } }).gh;
  expect(gh.state, JSON.stringify(gh)).toBe(state);
  if (state === 'missing') expect(gh.path).toBeUndefined();
  else expect(gh.path, 'the fake gh, never the owner’s').toBe(scratch.ghPath);
}

// Push and PR state live inside Environment now, not in a separate Push state region.
const environment = (p: Scm) => sessionCards(p.page).getByRole('region', { name: 'Environment', exact: true });
const page = (p: Scm) => surface(p.page, 'source-control').locator('[data-scm-page]');
const part = (p: Scm, name: 'uncommitted' | 'commits' | 'pr') => page(p).locator(`[data-scm-part="${name}"]`);
const where = (p: Scm) => page(p).locator('[data-scm-where]');
const commitsHeading = (p: Scm) => part(p, 'commits').locator('[data-scm-commits-heading]').last();
const commitRows = (p: Scm) => part(p, 'commits').locator('button[data-scm-commit]');
const group = (p: Scm, kind: 'not-pushed' | 'pushed') => part(p, 'commits').locator(`[data-scm-commit-group="${kind}"]`);
const button = (scope: Locator, name: string) => scope.getByRole('button', { name, exact: true });
// What a locator reads as a person reads it: its text with its pieces' spaces folded (a measured word has no text)
const words = (target: Locator) => target.evaluate((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim());

async function showEnvironment(p: Scm): Promise<void> {
  await expect(await unfoldSessionCard(p.page, 'Environment')).toBeVisible();
}

async function openPage(p: Scm): Promise<void> {
  await openSurface(p.page, 'Source control');
  await expect(page(p)).toBeVisible();
}

async function shot(target: Locator, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await target.screenshot({ path: join(SHOTS, name) });
}

// The side column dragged to `width` by its divider (the column grows as the divider moves left), as
// document-narrow.spec.ts drags it
async function columnAt(p: Scm, width: 360 | 280): Promise<void> {
  const divider = p.page.locator('[data-region="panel"]').getByRole('separator', { name: 'Resize right panel' });
  const now = Number(await divider.getAttribute('aria-valuenow'));
  const grip = (await divider.boundingBox())!;
  const [x, y] = [grip.x + grip.width / 2, grip.y + grip.height / 2];
  await p.page.mouse.move(x, y);
  await p.page.mouse.down();
  await p.page.mouse.move(x - (width - now), y, { steps: 8 });
  await p.page.mouse.up();
  await expect.poll(async () => Number(await divider.getAttribute('aria-valuenow')), `the column at ${width} px`).toBe(width);
}

// The scratch given a branch of its own, so the page has "Not pushed" and "Pushed to" (invented notes): `origin/main`
// first moves one commit past the merge base (the branch one behind), a commit made by `commit-tree` and pushed by its
// id, so neither the checkout's index nor its working tree is touched (a commit there would take the staged file with
// it, and switching back would delete it); then `feature/page` from `main`, carrying the uncommitted entries, its
// upstream `origin/feature/page` at `main`'s commit ahead of the old `origin/main`, and two commits not pushed, each one
// new note. A path-limited commit takes only its own path, so the staged file stays staged.
const NOTES = ['Add the first note', 'Add the second note', 'Add the third note'];
// `at`: the commit's author and committer date, for a commit made long ago (the age column's widest age, frames' S12).
function noteCommit(scratch: ScmScratch, n: number, at?: Date): string {
  const path = `notes/note-${n + 1}.md`;
  mkdirSync(scratch.path('notes'), { recursive: true });
  writeFileSync(scratch.path(path), `# Note ${n + 1}\n\nAn invented note for the page.\n`);
  scratch.git('add', path);
  const args = ['commit', '--quiet', '--no-verify', '-m', NOTES[n]!, '--', path];
  if (at === undefined) scratch.git(...args);
  else execFileSync('git', args, { cwd: scratch.dir, env: { ...isolatedGitEnv(), GIT_AUTHOR_DATE: at.toISOString(), GIT_COMMITTER_DATE: at.toISOString() } });
  return scratch.git('rev-parse', 'HEAD');
}
// The first note's age: 1,003 days and two hours back, so it reads "1003d", five characters, the widest age drawn
const OLD_AGE = '1003d';
const OLD_DAYS = 1003;
function featureBranch(scratch: ScmScratch): void {
  const upstream = scratch.git('commit-tree', 'origin/main^{tree}', '-p', 'origin/main', '-m', 'An upstream change');
  scratch.git('push', '--quiet', 'origin', `${upstream}:refs/heads/main`);
  scratch.git('fetch', '--quiet', 'origin');
  scratch.git('switch', '--quiet', '-c', 'feature/page');
  scratch.git('push', '--quiet', '-u', 'origin', 'feature/page');
  noteCommit(scratch, 0, new Date(Date.now() - (OLD_DAYS * 24 + 2) * 3_600_000));
  noteCommit(scratch, 1);
}

// The pull request the page scene reads (frames' S5, S6): open on feature/page with a review decision and a merge state,
// and checks in all five of gh's buckets. The word cut (N72, N75): an open PR's state is not said, and the counts line
// counts the three buckets listed under it, so the state line holds three phrases and the counts line three counts; at
// 280 px the state line wraps, the counts line breaks or stands whole inside the page, and the rulings hold.
const PAGE_PR = {
  number: 7, url: 'https://github.com/o/r/pull/7', title: 'Page PR', state: 'OPEN', isDraft: false, reviewDecision: 'CHANGES_REQUESTED',
  baseRefName: 'main', headRefName: 'feature/page', mergeStateStatus: 'BLOCKED',
};
const PAGE_PR_PHRASES = 'into main · Changes requested · Merging is blocked'; // the word cut (N72): an open PR's state is not said
const pageCheck = (name: string, bucket: string, state: string) => ({ name, bucket, state, link: `https://github.com/o/r/actions/runs/1/job/${name}`, workflow: 'CI' });
const PAGE_CHECKS = [
  pageCheck('typecheck', 'pass', 'SUCCESS'), pageCheck('lint', 'pass', 'SUCCESS'), pageCheck('test', 'fail', 'FAILURE'),
  pageCheck('e2e', 'cancel', 'CANCELLED'), pageCheck('docs', 'pending', 'IN_PROGRESS'), pageCheck('deploy', 'skipping', 'SKIPPED'),
];
const PAGE_CHECK_COUNTS = '1 failed · 1 cancelled · 1 pending'; // the word cut (N75): what is listed under the line

// ---- the measured rulings (frames' S4 to S7, S12, S13), read off the page as drawn ------------------------------------------

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
type Sized = Box & { full: number }; // `full`: the element's scroll width, the width its words take drawn in full
interface Measures {
  page: Box;
  where: { line: Box; branch: Sized; branchMin: number; measuredBranch: number; measuredBranchText: string; worktree: Sized | null; machine: Box | null; below: Box | null };
  uncommitted: { line: Box | null; counts: Sized | null; conflicts: (Sized & { lines: number }) | null };
  heading: { line: Box; since: (Sized & { fit: string; text: string }) | null; sinceMin: number; measuredSince: number; behind: (Sized & { lines: number }) | null; latest: (Sized & { text: string }) | null; review: boolean };
  phrases: { text: string; lines: number; top: number }[];
  checkCounts: { text: string; lines: number; top: number; right: number }[];
  messages: (Box & { full: number; client: number })[];
  ages: { text: string; box: Box; textLeft: number; textRight: number; textWidth: number }[];
  fourDigits: number;
  controls: { name: string; height: number }[];
}

// Everything one width's assertions read, in one pass in the page
function measure(p: Scm): Promise<Measures> {
  return page(p).evaluate((root): Measures => {
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const one = (sel: string, scope: Element = root) => scope.querySelector<HTMLElement>(sel);
    const sized = (el: HTMLElement | null): Sized | null => (el === null ? null : { ...box(el), full: el.scrollWidth });
    // The lines an inline element is drawn on: its client rects grouped by line. Chromium gives an inline one rect for each
    // run of its content between child elements, so "2 passed" in a span and " ·" beside it are two rects on one line
    const lines = (el: Element) => {
      let count = 0;
      let bottom = -Infinity;
      for (const r of Array.from(el.getClientRects()).sort((a, b) => a.top - b.top)) {
        if (r.top >= bottom - 1) {
          count += 1; // below the line so far: a line of its own
          bottom = r.bottom;
        } else bottom = Math.max(bottom, r.bottom);
      }
      return count;
    };
    const measured = (scope: Element, name: string) => scope.querySelector(`[data-scm-measure="${name}"]`)?.getBoundingClientRect().width ?? 0;
    const whereLine = one('[data-scm-where]')!;
    const uncommittedLine = one('[data-scm-uncommitted]');
    const headingLine = Array.from(root.querySelectorAll<HTMLElement>('[data-scm-commits-heading]')).at(-1)!;
    const since = one('[data-scm-since]', headingLine);
    const latest = Array.from(headingLine.querySelectorAll<HTMLElement>('span')).find((s) => (s.textContent ?? '').startsWith('· latest')) ?? null;
    const conflicts = uncommittedLine ? one('[data-scm-conflicts]', uncommittedLine) : null;
    const behind = one('[data-scm-behind]', headingLine);
    const machine = one('[data-scm-where-machine]', whereLine);
    const below = one('[data-scm-where-below]', whereLine);
    const ages = Array.from(root.querySelectorAll<HTMLElement>('[data-scm-age]')).map((age) => {
      const range = document.createRange();
      range.selectNodeContents(age);
      const text = range.getBoundingClientRect();
      return { text: age.textContent ?? '', box: box(age), textLeft: text.left, textRight: text.right, textWidth: text.width };
    });
    // four digits in the age's own type: the column's least width (frames' S12)
    const firstAge = root.querySelector<HTMLElement>('[data-scm-age]');
    let fourDigits = 0;
    if (firstAge) {
      const probe = document.createElement('span');
      probe.className = firstAge.className;
      probe.textContent = '0000';
      firstAge.parentElement!.appendChild(probe);
      fourDigits = probe.getBoundingClientRect().width;
      probe.remove();
    }
    // a control's hit area: its own box, or its ::after where one is drawn over it (frames' S13)
    const hit = (el: HTMLElement) => {
      const after = getComputedStyle(el, '::after');
      const drawn = after.content !== 'none' && after.content !== 'normal' ? parseFloat(after.height) || 0 : 0;
      return Math.max(el.getBoundingClientRect().height, drawn);
    };
    return {
      page: box(root),
      where: {
        line: box(whereLine),
        branch: sized(one('[data-scm-where-branch]', whereLine))!,
        branchMin: measured(whereLine, 'branch-min'),
        measuredBranch: measured(whereLine, 'branch'),
        measuredBranchText: one('[data-scm-measure="branch"]', whereLine)?.getAttribute('data-text') ?? '',
        worktree: sized(one('[data-scm-where-worktree]', whereLine)),
        machine: machine === null ? null : box(machine),
        below: below === null ? null : box(below),
      },
      uncommitted: {
        line: uncommittedLine === null ? null : box(uncommittedLine),
        counts: uncommittedLine === null ? null : sized(one('[data-scm-counts]', uncommittedLine)),
        conflicts: conflicts === null ? null : { ...box(conflicts), full: conflicts.scrollWidth, lines: lines(conflicts) },
      },
      heading: {
        line: box(headingLine),
        since: since === null ? null : { ...box(since), full: since.scrollWidth, fit: since.getAttribute('data-fit') ?? '', text: since.textContent ?? '' },
        sinceMin: measured(headingLine, 'since-min'),
        measuredSince: measured(headingLine, 'since'),
        behind: behind === null ? null : { ...box(behind), full: behind.scrollWidth, lines: lines(behind) },
        latest: latest === null ? null : { ...box(latest), full: latest.scrollWidth, text: latest.textContent ?? '' },
        review: Array.from(headingLine.querySelectorAll('button')).some((b) => (b.textContent ?? '').trim() === 'Review ›'),
      },
      phrases: Array.from(root.querySelectorAll<HTMLElement>('[data-scm-phrase]')).map((el) => ({ text: el.textContent ?? '', lines: lines(el), top: Math.round(el.getBoundingClientRect().top) })),
      checkCounts: Array.from(root.querySelectorAll<HTMLElement>('[data-scm-check-count]')).map((el) => ({ text: (el.parentElement!.textContent ?? '').trim(), lines: lines(el.parentElement!), top: Math.round(el.parentElement!.getBoundingClientRect().top), right: el.parentElement!.getBoundingClientRect().right })),
      messages: Array.from(root.querySelectorAll<HTMLElement>('[data-scm-pr-line], [data-scm-failure]')).map((el) => ({ ...box(el), full: el.scrollWidth, client: el.clientWidth })),
      ages,
      fourDigits,
      controls: Array.from(root.querySelectorAll<HTMLElement>('button')).map((el) => ({ name: el.getAttribute('aria-label') ?? (el.textContent ?? '').trim(), height: hit(el) })),
    };
  });
}

const inside = (inner: Box, outer: Box) => inner.left >= outer.left - 1 && inner.right <= outer.right + 1;
const drawnWhole = (el: Sized) => el.full <= el.right - el.left + 1; // as wide as its words: nothing of it cut

// What a pass stages and so requires drawn before it measures it, so no ruling holds over a state that is absent: the
// state line's phrases and the checks' counts (S5, S6), the git or GitHub CLI messages (S7), the widest age's words
// (S12), and whether the state line must break at this width. A pass that leaves a part out (the "latest" pass) names
// nothing for it, and those loops then read whatever is drawn.
interface Staged {
  phrases?: number;
  checkCounts?: number;
  messages?: number;
  widestAge?: string;
  wraps?: boolean;
}

// The frames' measured rulings at one width (Decision Log 30, 31 and 44), by rectangles; each holds whichever way the
// line chose to give way. Answers what was read, for the report.
async function expectMeasuredRulings(p: Scm, width: 360 | 280, staged: Staged = {}): Promise<string> {
  const m = await measure(p);
  const at = `at ${width} px`;
  // The staged states, present before anything of them is measured
  if (staged.phrases !== undefined) expect(m.phrases.map((phrase) => phrase.text).length, `${at}: the state line's phrases drawn`).toBe(staged.phrases);
  if (staged.checkCounts !== undefined) expect(m.checkCounts.length, `${at}: the checks' counts drawn`).toBe(staged.checkCounts);
  if (staged.messages !== undefined) expect(m.messages.length, `${at}: the messages drawn`).toBe(staged.messages);
  if (staged.widestAge !== undefined) expect(m.ages.map((age) => age.text), `${at}: the widest age drawn`).toContain(staged.widestAge);
  if (staged.wraps) {
    expect(new Set(m.phrases.map((phrase) => phrase.top)).size, `${at}: the state line breaks (between its phrases)`).toBeGreaterThan(1);
  }
  // the word cut (N75) left the counts line three counts, which may fit at a narrow width: it breaks between them or
  // stands whole on one line; wrapped or not, at every width, no count passes the page's right edge
  for (const count of m.checkCounts) expect(count.right, `${at}: the count "${count.text}" inside the page`).toBeLessThanOrEqual(m.page.right + 1);
  // Decision Log 44: a measured word, drawn by its ::before, is as wide as the words it measures: the Where line's
  // branch word against the branch drawn in full (the drawn span's scroll width), and "since <base>" where it is whole
  expect(m.where.measuredBranch, `${at}: the measured branch word is laid out`).toBeGreaterThan(0);
  expect(Math.abs(m.where.measuredBranch - m.where.branch.full), `${at}: the measured word "${m.where.measuredBranchText}" (${m.where.measuredBranch} px) is as wide as the branch drawn in full (${m.where.branch.full} px)`).toBeLessThanOrEqual(1);
  if (m.heading.since !== null) {
    expect(m.heading.measuredSince, `${at}: the measured "since" word is laid out`).toBeGreaterThan(0);
    if (m.heading.since.fit === 'whole') expect(Math.abs(m.heading.measuredSince - m.heading.since.full), `${at}: "since <base>" measured as drawn`).toBeLessThanOrEqual(1);
  }
  // S4: the Where line's end whole: the branch inside the line and never under eight characters and an ellipsis;
  // "· worktree" whole where it stands; the machine's label (another machine's only) inside the line, unbroken
  expect(inside(m.where.branch, m.where.line), `${at}: the branch inside the Where line`).toBe(true);
  expect(m.where.branch.right - m.where.branch.left, `${at}: the branch keeps at least eight characters`).toBeGreaterThanOrEqual(Math.min(m.where.branchMin, m.where.branch.full) - 1);
  if (m.where.worktree !== null) expect(drawnWhole(m.where.worktree), `${at}: "· worktree" whole where it stands`).toBe(true);
  if (m.where.machine !== null) expect(inside(m.where.machine, m.where.line), `${at}: the machine's label inside the line`).toBe(true);
  if (m.where.below !== null) expect(inside(m.where.below, m.where.line), `${at}: the machine's label below, inside the line`).toBe(true);
  // S6: "· N conflicts" and "· N behind" whole; the counts leave first, whole; "since" whole, or the base shortened to
  // eight characters, or the phrase left out whole; the checks' counts each whole on one line
  if (m.uncommitted.conflicts !== null) {
    expect(drawnWhole(m.uncommitted.conflicts) && m.uncommitted.conflicts.lines === 1, `${at}: the conflicts whole on one line`).toBe(true);
    expect(inside(m.uncommitted.conflicts, m.uncommitted.line!), `${at}: the conflicts inside the line`).toBe(true);
  }
  if (m.uncommitted.counts !== null) expect(drawnWhole(m.uncommitted.counts), `${at}: the counts whole where they stand`).toBe(true);
  if (m.heading.behind !== null) {
    expect(drawnWhole(m.heading.behind) && m.heading.behind.lines === 1, `${at}: "· N behind" whole on one line`).toBe(true);
    expect(inside(m.heading.behind, m.heading.line), `${at}: "· N behind" inside the heading`).toBe(true);
  }
  if (m.heading.since !== null) {
    expect(m.heading.since.text.startsWith('since '), `${at}: the word "since" stands whole`).toBe(true);
    if (m.heading.since.fit === 'shortened') expect(m.heading.since.right - m.heading.since.left, `${at}: the base keeps eight characters`).toBeGreaterThanOrEqual(m.heading.sinceMin - 1);
    else expect(drawnWhole(m.heading.since), `${at}: "since <base>" whole`).toBe(true);
  }
  for (const count of m.checkCounts) expect(count.lines, `${at}: the check count "${count.text}" on one line`).toBe(1);
  // S5: the state line breaks only between its phrases
  for (const phrase of m.phrases) expect(phrase.lines, `${at}: the phrase "${phrase.text}" whole on one line`).toBe(1);
  // S7: a git or GitHub CLI message breaks anywhere inside its box and is never clipped at the column's edge
  for (const message of m.messages) {
    expect(message.full, `${at}: a message wraps inside its box`).toBeLessThanOrEqual(message.client + 1);
    expect(inside(message, m.page), `${at}: a message inside the page`).toBe(true);
  }
  // S12: the age column as wide as the widest age drawn, at least four characters, right-aligned. Each age's own words
  // (a Range over its text) stand inside the column's rectangle, so a column narrower than the widest age fails here
  // (its overflow would leave by the left edge); and the column is no wider than the widest words or four characters
  // need, within half a character, so a column fixed wider fails too
  if (m.ages.length > 0) {
    expect(new Set(m.ages.map((age) => Math.round(age.box.right - age.box.left))).size, `${at}: one width for every age`).toBe(1);
    const column = m.ages[0]!.box.right - m.ages[0]!.box.left;
    const widest = Math.max(...m.ages.map((age) => age.textWidth));
    const char = m.fourDigits / 4;
    for (const age of m.ages) {
      expect(age.textLeft, `${at}: the age "${age.text}" inside its column on the left`).toBeGreaterThanOrEqual(age.box.left - 0.5);
      expect(age.textRight, `${at}: the age "${age.text}" inside its column on the right`).toBeLessThanOrEqual(age.box.right + 0.5);
      expect(Math.abs(age.textRight - age.box.right), `${at}: the age "${age.text}" right-aligned`).toBeLessThanOrEqual(1);
    }
    expect(column, `${at}: the age column at least four characters`).toBeGreaterThanOrEqual(m.fourDigits - 0.5);
    expect(column - Math.max(widest, m.fourDigits), `${at}: the age column as wide as the widest age (${Math.round(widest)} px) or four characters, no wider`).toBeLessThanOrEqual(char / 2);
  }
  // S13: every control's hit area at least 24 px tall
  for (const control of m.controls) expect(control.height, `${at}: "${control.name}" is at least 24 px tall`).toBeGreaterThanOrEqual(23.5);
  return `${at}: branch word ${Math.round(m.where.measuredBranch)} px, since ${m.heading.since?.fit ?? 'not drawn'}, ${m.ages.length} ages, ${m.controls.length} controls`;
}

// ---- the cases ---------------------------------------------------------------------------------------------------------------

test.describe('source control over a scratch repository', () => {
  test('the page: Where, Uncommitted, Commits and Pull request over the scratch, a commit and a push followed without a reload, and the frames’ measured rulings at 360 and 280 px', async () => {
    test.setTimeout(180_000);
    await withScm(
      {
        setup: (scratch) => {
          featureBranch(scratch);
          // the branch's pull request, open, with checks in every bucket (frames' S5, S6); gh exits 1 when one failed
          scratch.gh('view.none', null);
          scratch.gh('view.json', JSON.stringify(PAGE_PR));
          scratch.gh('checks.json', JSON.stringify(PAGE_CHECKS));
          scratch.gh('checks.exit', '1');
          scratch.holdReads();
        },
      },
      async (p) => {
        const { scratch } = p;
        const said: string[] = [];
        await openPage(p);
        await expect(where(p).locator('[data-scm-where-branch]')).toHaveText('⎇ feature/page');
        await expect(where(p), 'the folder’s path, the Where line’s tooltip and description (the word cut, N57)').toHaveAccessibleDescription(scratch.dir);

        // A part whose first read is still out (frames' S9): its heading alone, no count and no rows. The scratch's git
        // (MAWS_GIT, which main's env carries to mawsd's git service) holds the branch read's own `rev-list` until the
        // scene has looked, so the state is staged by construction: a read never held, or a row drawn while it is, fails.
        try {
          await expect.poll(() => scratch.readsHeld(), { timeout: 20_000, message: 'the branch read reaches the scratch’s git and is held' }).toBe(true);
          expect(await words(commitsHeading(p)), 'the first read out: the heading alone').toBe('Commits');
          await expect(commitsHeading(p).locator('[data-scm-count]')).toHaveCount(0);
          await expect(commitRows(p), 'no row while the read is held').toHaveCount(0);
          // the word cut (N63): the wait is the quiet spinner under the heading, named by it
          await expect(part(p, 'commits').getByRole('progressbar', { name: 'Commits', exact: true })).toBeVisible();
          await expect(part(p, 'commits').locator('[data-scm-commit-group]')).toHaveCount(0);
          said.push('first read out: "Commits" alone');
        } finally {
          scratch.releaseReads(); // a failed step leaves no git process held behind it
        }

        // The parts in order under the Where line
        expect(await page(p).locator('[data-scm-part]').evaluateAll((parts) => parts.map((el) => el.getAttribute('data-scm-part')))).toEqual(['uncommitted', 'commits', 'pr']);
        // Uncommitted: the card's change line (src/app.ts and src/staged.ts a line each; untracked.txt and udir/ listed)
        await expect.poll(() => words(part(p, 'uncommitted'))).toBe('Uncommitted 4 +2 −0 Review ›');
        // Commits: three since origin/main, one behind; two not pushed and one pushed, newest first
        await expect.poll(() => words(commitsHeading(p)), { timeout: 20_000 }).toBe('Commits 3 since origin/main · 1 behind Review ›');
        await expect(commitRows(p)).toHaveCount(3);
        for (const [i, subject] of [NOTES[1]!, NOTES[0]!, 'ahead'].entries()) await expect(commitRows(p).nth(i)).toContainText(subject);
        await expect.poll(() => words(group(p, 'not-pushed'))).toBe('Not pushed 2');
        await expect.poll(() => words(group(p, 'pushed'))).toBe('Pushed to origin/feature/page 1');
        // The first note was made 1,003 days ago: its age is five characters, the widest the column draws (frames' S12)
        await expect(commitRows(p).nth(1).locator('[data-scm-age]')).toHaveText(OLD_AGE);
        // Pull request: #7, its three phrases and its three counts
        const pr = part(p, 'pr');
        await expect(pr.locator('[data-scm-pr-number]')).toHaveText('#7', { timeout: 20_000 });
        await expect.poll(() => words(pr.locator('[data-scm-pr-state]'))).toBe(PAGE_PR_PHRASES);
        await expect.poll(() => words(pr.locator('[data-scm-checks]'))).toBe(`Checks ${PAGE_CHECK_COUNTS}`);

        // A commit made in the checkout appears first, without a reload; a push moves the branch's commits under
        // "Pushed to …" (one group when the other is empty)
        const third = noteCommit(scratch, 2);
        await expect(commitRows(p).first()).toHaveAccessibleName(`Open commit ${third.slice(0, 7)} in Review`, { timeout: 20_000 });
        await expect(commitRows(p).first()).toContainText(NOTES[2]!);
        await expect.poll(() => words(group(p, 'not-pushed'))).toBe('Not pushed 3');
        scratch.git('push', '--quiet', 'origin', 'feature/page');
        await expect(group(p, 'not-pushed')).toHaveCount(0, { timeout: 20_000 });
        await expect.poll(() => words(group(p, 'pushed'))).toBe('Pushed to origin/feature/page 4');
        await expect.poll(() => words(commitsHeading(p))).toBe('Commits 4 since origin/main · 1 behind Review ›');

        // One conflict in the index (frames' S6 and S14): "· 1 conflict"
        scratch.conflict('conflicted.txt');
        await expect(part(p, 'uncommitted').locator('[data-scm-conflicts]')).toHaveText('· 1 conflict', { timeout: 20_000 });

        // The frames' measured rulings, at 360 and at 280 px, over the staged pull request (S5, S6), the old commit's age
        // (S12) and no message; at 280 px the state line and the counts line each break
        for (const width of [360, 280] as const) {
          await columnAt(p, width);
          await expect(commitRows(p).first()).toBeVisible();
          said.push(await expectMeasuredRulings(p, width, { phrases: 3, checkCounts: 3, messages: 0, widestAge: OLD_AGE, wraps: width === 280 }));
          await shot(surface(p.page, 'source-control'), `scm-page-${width}.png`);
        }

        // S7 on its own pass: gh's message, a long word with no break in it, breaks inside its box at 280 and at 360 px
        scratch.gh('view.fail', `GraphQL: Could not resolve to a PullRequest for the branch, in a repository named ${'x'.repeat(120)} (pullRequest)`);
        await pr.getByRole('button', { name: 'Refresh PR state' }).click();
        await expect(pr.locator('[data-scm-pr-line]')).toContainText('PR state unavailable · GraphQL: Could not resolve', { timeout: 20_000 });
        for (const width of [280, 360] as const) {
          await columnAt(p, width);
          said.push(await expectMeasuredRulings(p, width, { phrases: 0, checkCounts: 0, messages: 1 }));
          await shot(surface(p.page, 'source-control'), `scm-page-${width}-message.png`);
        }
        await columnAt(p, 280);

        // "Commits · latest" on a long branch at 280 px (frames' S8): a branch that shares no commit with the default
        // branch has no base. The word cut (N62): the heading no longer names the branch, which the Where line does; its
        // "· latest" stands whole inside the heading, with no "Review ›"; the Where line's branch keeps its eight
        // characters (the rulings again)
        const long = 'feature/an-orphaned-line-of-work-with-a-very-long-name-for-the-narrow-column';
        scratch.git('update-index', '--force-remove', 'conflicted.txt'); // the index resolved, so a branch can start
        scratch.git('checkout', '--quiet', '--orphan', long);
        scratch.git('commit', '--quiet', '--no-verify', '-m', 'A history of its own');
        await expect(where(p).locator('[data-scm-where-branch]')).toHaveText(`⎇ ${long}`, { timeout: 20_000 });
        await expect.poll(async () => (await measure(p)).heading.latest?.text ?? '', { timeout: 20_000 }).toBe('· latest');
        const m = await measure(p);
        expect(m.heading.review, 'no "Review ›" without a base').toBe(false);
        expect(drawnWhole(m.heading.latest!), '"· latest" whole').toBe(true);
        expect(inside(m.heading.latest!, m.heading.line), '"· latest" inside the heading').toBe(true);
        said.push(await expectMeasuredRulings(p, 280));
        said.push(`at 280 px: "· latest" on a long branch, ${Math.round(m.heading.latest!.right - m.heading.latest!.left)} px drawn`);
        await shot(surface(p.page, 'source-control'), 'scm-page-280-latest.png');
        test.info().annotations.push({ type: 'measured', description: said.join('; ') });
      },
    );
  });

  test('a commit opens in Review from its row: the chip, the totals and the footer; This branch and back', async () => {
    test.setTimeout(120_000);
    await withScm({ setup: (scratch) => featureBranch(scratch) }, async (p) => {
      const { scratch } = p;
      await openPage(p);
      const second = scratch.git('rev-parse', 'HEAD');
      const row = commitRows(p).first();
      await expect(row).toHaveAccessibleName(`Open commit ${second.slice(0, 7)} in Review`, { timeout: 20_000 });
      await row.focus();
      await p.page.keyboard.press('Enter'); // a row is reached by Tab and acts on Enter (UC-6)
      const review = surface(p.page, 'review');
      await expect(review).toBeVisible();
      const chip = review.locator('[data-chip="commit"]');
      await expect(chip).toHaveText(`Commit ${second.slice(0, 7)}`);
      await expect(chip).toHaveAttribute('aria-pressed', 'true');
      await expect(review.locator('[data-review-header]')).toHaveText('1 file · +3 −0', { timeout: 20_000 }); // the word cut (T356)
      await expect(review.locator('[data-review-file="notes/note-2.md"]')).toBeVisible();
      // the word cut (T357): the foot line is gone; the commit's chip, which says its hash, carries its subject as its
      // tooltip and description
      await expect(review.locator('[data-review-footer]')).toHaveCount(0);
      await expect(chip).toHaveAccessibleDescription(NOTES[1]!);

      // This branch: every change since the merge base with origin/main, the working tree and the new file included
      await review.locator('[data-chip="branch"]').click();
      await expect(review.locator('[data-chip="branch"]')).toHaveAttribute('aria-pressed', 'true');
      await expect(review.locator('[data-chip="branch"]'), 'what the pressed scope reads, its tooltip and description').toHaveAccessibleDescription('feature/page · Since origin/main', { timeout: 20_000 });
      for (const path of ['notes/note-1.md', 'notes/note-2.md', 'README.md', 'src/app.ts', 'src/staged.ts', 'untracked.txt']) await expect(review.locator(`[data-review-file="${path}"]`), path).toBeVisible();
      // and back to the commit, kept
      await chip.click();
      await expect(chip).toHaveAttribute('aria-pressed', 'true');
      await expect(review.locator('[data-review-header]')).toHaveText('1 file · +3 −0');
      await expect(chip).toHaveAccessibleDescription(NOTES[1]!);
    });
  });

  test('a pull request gh already has: its number, title, state and checks on the page, then Refresh and three passed, then a failed check’s row first', async () => {
    test.setTimeout(120_000);
    await withScm({ setup: (scratch) => scratch.git('push', '--quiet', 'origin', 'main') }, async (p) => {
      const { scratch } = p;
      await expect(environment(p)).toContainText('Up to date with origin/main');
      // the word cut (P43): a branch with no PR draws no PR row on the card, so no Refresh there; the page still says so,
      // beside its own Refresh, whose answer the card's row shares by key
      const line = environment(p).getByTestId('pr-line');
      await expect(line).toHaveCount(0);
      await openPage(p);
      const pr = part(p, 'pr');
      await expect(pr.locator('[data-scm-pr-line]')).toHaveText('No PR for main', { timeout: 20_000 });
      scratch.gh('view.none', null); // from now on gh has the PR: #7, BLOCKED, two checks passed and one pending
      await pr.getByRole('button', { name: 'Refresh PR state' }).click();
      await expect(pr.locator('[data-scm-pr-number]')).toHaveText('#7', { timeout: 20_000 });
      await expect(pr.locator('[data-scm-pr-title]')).toHaveText('Panel PR');
      // the word cut (N72): an open PR's state is not said; (N75) the counts line counts what is listed under it
      await expect.poll(() => words(pr.locator('[data-scm-pr-state]'))).toBe('into main · Merging is blocked');
      await expect.poll(() => words(pr.locator('[data-scm-checks]'))).toBe('Checks 1 pending');
      await expect(pr.locator('[data-scm-check]')).toHaveCount(1);
      await expect(pr.locator('[data-scm-check][data-bucket="pending"]')).toContainText('test');
      // the card's row, read where it is drawn (P44: an open PR and passed checks say nothing there)
      await showEnvironment(p);
      await expect(line).toHaveText('PR #7 · 1 pending');
      await openPage(p);

      scratch.gh('checks.json', JSON.stringify(CHECKS_PASSED));
      scratch.gh('checks.exit', '0');
      await pr.getByRole('button', { name: 'Refresh PR state' }).click();
      await expect(pr.locator('[data-scm-checks]'), 'nothing listed: the folded line stands alone').toHaveCount(0, { timeout: 20_000 });
      await expect.poll(() => words(pr.locator('[data-scm-fold-line]'))).toBe('Checks › 3 passed');
      // The card's line, read where it is drawn: Session cards in the side column, where the page stood
      await showEnvironment(p);
      await expect(line, 'nothing to say beyond the number (P44)').toHaveText('PR #7');
      await openPage(p);

      scratch.gh('checks.json', JSON.stringify([CHECKS_PASSED[0], { ...CHECKS_PASSED[2], bucket: 'fail', state: 'FAILURE' }, CHECKS_PASSED[1]]));
      scratch.gh('checks.exit', '1');
      await pr.getByRole('button', { name: 'Refresh PR state' }).click();
      const failed = pr.locator('[data-scm-check]').first();
      await expect(failed).toHaveAttribute('data-bucket', 'fail', { timeout: 20_000 });
      await expect(failed).toContainText('test');
      await expect(failed.locator('[data-scm-check-word]')).toHaveClass(/text-danger/);
      await expect(failed.getByRole('button', { name: 'Open test on GitHub' })).toBeVisible();
      await expect.poll(() => words(pr.locator('[data-scm-checks]'))).toBe('Checks 1 failed');
    });
  });

  test('without gh the row offers the install', async () => {
    await withScm({ gh: 'none' }, async (p) => {
      await expect(environment(p).getByTestId('pr-line')).toHaveText('GitHub CLI not installed · Install');
      await expect(button(environment(p), 'Install')).toBeVisible();
    });
  });

  test('with gh signed out the row offers the sign-in', async () => {
    await withScm({ ghState: 'unauthenticated', setup: (scratch) => scratch.gh('auth.exit', '1') }, async (p) => {
      await expect(environment(p).getByTestId('pr-line')).toHaveText('GitHub CLI not signed in · Sign in');
      await expect(button(environment(p), 'Sign in')).toBeVisible();
    });
  });

  test('an untrusted checkout: the page’s last part asks for trust, and main refuses a stage', async () => {
    await withScm({ trust: false }, async (p) => {
      const { scratch } = p;
      await expect(environment(p)).toContainText('Trust this folder to see PR state');
      await openPage(p);
      await expect(part(p, 'pr').locator('[data-scm-pr-line]')).toHaveText('Trust this folder to see PR state');
      await expect.poll(() => words(part(p, 'uncommitted'))).toMatch(/^Uncommitted 4\b/);
      await expect(page(p).locator('input, textarea, select'), 'nothing to type into or tick').toHaveCount(0);

      const before = scratch.git('status', '--porcelain', '--untracked-files=normal');
      const result = await invoke(p.page, 'scm.stage', { appSessionId: scratch.appSessionId, paths: ['src/app.ts'] });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      expect(result.value).toMatchObject({ refused: 'untrusted' });
      expect(scratch.git('status', '--porcelain', '--untracked-files=normal'), 'nothing staged').toBe(before);
    });
  });

  test('the page and Review’s commit scope use tokens only in both themes', async () => {
    test.setTimeout(150_000);
    const themes = ['light', 'dark'] as const;
    const setTheme = async (p: Scm, theme: (typeof themes)[number]) => {
      await menu(p.maws, `theme.${theme}`);
      await expect(p.page.locator('html')).toHaveAttribute('data-theme', theme);
    };
    const scan = async (p: Scm, what: string) => expect(await otherThemeColours(p.page), what).toEqual([]);
    await withScm({ setup: (scratch) => scratch.gh('view.none', null) }, async (p) => {
      await openPage(p);
      // main is one commit ahead of origin/main ("ahead"); gh has the PR
      await expect(commitRows(p)).toHaveCount(1, { timeout: 20_000 });
      await expect(part(p, 'pr').locator('[data-scm-pr-number]')).toHaveText('#7', { timeout: 20_000 });
      for (const theme of themes) {
        await setTheme(p, theme);
        await scan(p, `${theme}: the page`);
        await shot(surface(p.page, 'source-control'), `scm-page-${theme}.png`);
      }
      await commitRows(p).first().click();
      const review = surface(p.page, 'review');
      await expect(review.locator('[data-chip="commit"]')).toHaveAttribute('aria-pressed', 'true');
      await expect(review.locator('[data-review-file="README.md"] [data-review-block]').first()).toBeVisible({ timeout: 20_000 });
      for (const theme of themes) {
        await setTheme(p, theme);
        await scan(p, `${theme}: Review on a commit`);
        await shot(review, `review-commit-${theme}.png`);
      }
      await showEnvironment(p);
      await expect(environment(p).getByTestId('pr-line')).toHaveText('PR #7 · 1 pending'); // the word cut (P44)
      await p.page.mouse.move(0, 0); // the row as it rests, Refresh neither hovered nor focused
      await p.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      for (const theme of themes) {
        await setTheme(p, theme);
        await scan(p, `${theme}: Environment with the PR line`);
        await shot(environment(p), `pr-state-row-${theme}.png`);
      }
    });
  });
});
