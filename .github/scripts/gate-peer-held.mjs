// Best-effort reuse of a peer check on the same tree. Lower run ids elect the holder even when sibling pushes share
// a timestamp. The API is only an optimization: an unreadable answer leaves gate-plan's automatic join intact.
import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import process from 'node:process';
import { URLSearchParams, fileURLToPath } from 'node:url';
import console from 'node:console';
import { planOf } from './gate-plan.mjs';
import { githubApi, jobsOf } from './gate-peer-api.mjs';

const active = new Set(['queued', 'in_progress', 'waiting']);
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const runId = (value) => {
  requireValue(/^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0, 'invalid run id');
  return Number(value);
};
const headOf = (head) => {
  requireValue(head && /^[0-9a-f]{40}$/.test(head.tree_id) && typeof head.message === 'string', 'invalid head commit');
  return head;
};

function heldState(jobs, groups) {
  const peerJobs = groups.map((group) => jobs.find((job) => job.name === `e2e:${group}`));
  // A visible failed/skipped peer job is definitive, even if the plan has not reported completion yet.
  const stateOf = (job) => active.has(job.status) ? job.status : job.status === 'completed' && job.conclusion === 'success' ? 'succeeded' : '';
  if (peerJobs.some((job) => job && !stateOf(job))) return '';
  if (peerJobs.every(Boolean)) return peerJobs.map(stateOf).find((state) => state !== 'succeeded') ?? 'succeeded';
  const plan = jobs.find((job) => job.name === 'plan');
  return plan && plan.status !== 'completed' ? `plan ${plan.status}` : '';
}

// api(path) returns parsed GitHub REST JSON; env is the same lists and repository variables gate-plan receives.
export async function peerHeldBy({ env, scripts, event, api, now = new Date(), warn = console.warn }) {
  try {
    if (env.EVENT !== 'push') return '';
    const head = headOf(event.head_commit);
    const planning = { ...env, HEAD_MESSAGE: head.message, PEER_HELD_BY: '' };
    const check = planOf(planning, scripts).peerCheck;
    if (!check.minorApart || check.groups.length === 0) return '';
    const current = runId(env.GITHUB_RUN_ID);
    const root = `/repos/${env.GITHUB_REPOSITORY}/actions`;
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const runs = [];
    // Bound the lookback work: absent candidates outside these two recent pages simply cause another check.
    for (let page = 1; page <= 2; page++) {
      const query = new URLSearchParams({ event: 'push', created: `>=${since}`, per_page: '100', page: String(page) });
      const data = await api(`${root}/workflows/gate.yml/runs?${query}`);
      requireValue(Array.isArray(data.workflow_runs), 'invalid workflow runs response');
      runs.push(...data.workflow_runs);
      if (data.workflow_runs.length < 100) break;
    }
    const candidates = runs.filter((run) => runId(run.id) < current).sort((a, b) => a.id - b.id);
    for (const run of candidates) {
      const candidateHead = headOf(run.head_commit);
      if (run.event !== 'push' || candidateHead.tree_id !== head.tree_id) continue;
      const candidate = planOf({ ...planning, HEAD_MESSAGE: candidateHead.message, GITHUB_REF: `refs/heads/${run.head_branch}`, GITHUB_REF_NAME: run.head_branch }, scripts).peerCheck;
      if (candidate.peer !== check.peer || !check.groups.every((group) => candidate.groups.includes(group))) continue;
      const jobs = await jobsOf(api, `${root}/runs/${run.id}`);
      const state = heldState(jobs, check.groups);
      if (state) return `${run.id} ${state}`;
    }
    return '';
  } catch (error) {
    warn(`gate-peer-held: warning: ${error.message}; peer groups will join normally`);
    return '';
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let held = '';
  try {
    const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    held = await peerHeldBy({ env: process.env, scripts, event, api: githubApi(process.env) });
  } catch (error) {
    console.warn(`gate-peer-held: warning: ${error.message}; peer groups will join normally`);
  }
  appendFileSync(process.env.GITHUB_ENV, `PEER_HELD_BY=${held}\n`);
}
