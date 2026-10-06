// What gh says about a branch's pull request, read into what the PR row shows (E6 execution document, Design §6). Pure:
// the service runs gh (`runCollected`, the remote environment, the checkout as cwd) and hands the collected answers
// here. gh's exit codes carry state as well as failure (`pr checks` exits 8 while checks are pending and 1 when one
// failed, with its JSON on stdout all the same), so stdout's shape decides wherever it can; "no pull requests found" is
// an answer ("No PR for <branch>"), apart from a failure to ask ("PR state unavailable · <reason>").
import type { ScmCheck, ScmGhState, ScmPrState } from '@shared/ipc/schema/scm';
import type { CollectedRun } from './remote-runner';

export const GH_READ_TIMEOUT_MS = 30_000;
const PR_VIEW_FIELDS = 'number,url,title,state,isDraft,reviewDecision,baseRefName,headRefName,mergeStateStatus';
const PR_CHECKS_FIELDS = 'name,bucket,state,link,workflow';
const BUCKETS: ReadonlySet<string> = new Set<ScmCheck['bucket']>(['pass', 'fail', 'pending', 'skipping', 'cancel']);
const PR_STATES: ReadonlySet<string> = new Set(['OPEN', 'CLOSED', 'MERGED']);
const UNREADABLE = 'gh pr view answered something MAWS cannot read';

type Pr = NonNullable<ScmPrState['pr']>;
export type PrView = Omit<Pr, 'checks'>;
export type PrChecks = Pr['checks'];

export const prViewArgv = (branch: string) => ['pr', 'view', branch, '--json', PR_VIEW_FIELDS];
export const prChecksArgv = (branch: string) => ['pr', 'checks', branch, '--json', PR_CHECKS_FIELDS];

// `gh pr view <branch> --json …`: the PR, "no PR" (`pr: null, error: null`), or why there is no answer.
export function readPrView(run: CollectedRun): { pr: PrView | null; error: string | null } {
  if (run.exitCode !== 0) {
    if (run.failure === null && /no pull requests found/i.test(run.stderr)) return { pr: null, error: null };
    return { pr: null, error: reason(run, 'gh pr view') };
  }
  const answer = parse(run.stdout);
  if (!isRecord(answer)) return { pr: null, error: UNREADABLE };
  const { number, url, title, state, isDraft, reviewDecision, baseRefName, headRefName, mergeStateStatus } = answer;
  if (
    !Number.isInteger(number) || typeof url !== 'string' || typeof title !== 'string' || typeof state !== 'string' || !PR_STATES.has(state) ||
    typeof isDraft !== 'boolean' || typeof baseRefName !== 'string' || typeof headRefName !== 'string'
  ) {
    return { pr: null, error: UNREADABLE };
  }
  return {
    pr: {
      number: number as number, url, title, state: state as Pr['state'], isDraft, reviewDecision: textOrNull(reviewDecision), baseRefName,
      headRefName, mergeStateStatus: textOrNull(mergeStateStatus),
    },
    error: null,
  };
}

// `gh pr checks <branch> --json …`: a JSON array is the answer whatever the exit code; an empty one, or gh's "no checks
// reported", is `none` ("No checks reported yet"); anything else is `unknown` (the checks could not be read).
export function readChecks(run: CollectedRun): PrChecks {
  const answer = run.failure === null ? parse(run.stdout) : undefined;
  if (!Array.isArray(answer)) {
    const noChecks = run.failure === null && /no checks reported/i.test(run.stderr);
    return { summary: noChecks ? 'none' : 'unknown', items: [] };
  }
  // gh documents five buckets; an entry outside them is left out rather than guessed at
  const items = answer.filter(isRecord).flatMap((entry): ScmCheck[] => {
    const { name, bucket, state, link, workflow } = entry;
    if (typeof name !== 'string' || typeof bucket !== 'string' || !BUCKETS.has(bucket)) return [];
    return [{ name, bucket: bucket as ScmCheck['bucket'], state: typeof state === 'string' ? state : '', link: textOrNull(link), workflow: textOrNull(workflow) }];
  });
  return { summary: checksSummary(items), items };
}

// A failure or a cancel first, then anything pending, then a pass; skipped checks alone say nothing.
export function checksSummary(items: readonly Pick<ScmCheck, 'bucket'>[]): PrChecks['summary'] {
  const has = (...buckets: ScmCheck['bucket'][]) => items.some((item) => buckets.includes(item.bucket));
  if (has('fail', 'cancel')) return 'fail';
  if (has('pending')) return 'pending';
  if (has('pass')) return 'pass';
  return 'none';
}

// `gh --version` and `gh auth status --active`: ready only when gh answered both; otherwise unauthenticated with the
// reason the owner reads in the row (gh's own first line when it has one).
export function readGhProbe(path: string, version: CollectedRun, auth: CollectedRun): ScmGhState {
  const versionLine = version.exitCode === 0 ? firstLine(version.stdout) : null;
  if (auth.exitCode !== 0) return { state: 'unauthenticated', path, version: versionLine, detail: reason(auth, 'gh auth status') };
  if (versionLine === null) return { state: 'unauthenticated', path, version: null, detail: `gh --version failed: ${reason(version, 'gh --version')}` };
  return { state: 'ready', path, version: versionLine };
}

// Why a collected run gave no answer: its failure (a timeout, a program that could not start), else the first line it
// printed (stderr first), else its exit code.
function reason(run: CollectedRun, what: string): string {
  return run.failure ?? firstLine(run.stderr) ?? firstLine(run.stdout) ?? `${what} exited with code ${run.exitCode}`;
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const textOrNull = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null);
const firstLine = (text: string) => text.split('\n').find((line) => line.trim() !== '')?.trim() ?? null;
