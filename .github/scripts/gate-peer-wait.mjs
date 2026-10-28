// A deferred peer group remains a required check: a cheap hosted job, named e2e:<group>, follows its holder's verdict.
// A failed-jobs rerun executes this again against the holder's latest attempt, so rerunning the holder can repair it.
import console from 'node:console';
import { realpathSync } from 'node:fs';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { JOB_STATUSES, githubApi, jobsOf } from './gate-peer-api.mjs';

function verdictOf(holder, jobs, group) {
  if (!JOB_STATUSES.has(holder.status) || (holder.status === 'completed' && typeof holder.conclusion !== 'string')) throw new Error('invalid holder run');
  const plan = jobs.find((job) => job.name === 'plan');
  const peer = jobs.find((job) => job.name === `e2e:${group}`);
  if (plan?.status === 'completed' && plan.conclusion !== 'success') return `holder plan ${plan.conclusion}`;
  if (peer?.status === 'completed') return peer.conclusion;
  if (holder.status === 'completed') return `holder ${holder.conclusion} without a completed e2e:${group}`;
  // GitHub can publish the downstream matrix after the successful plan. A missing peer job is not definitive
  // while the holder is active; the completed-run check above (or the polling deadline) supplies the bound.
  return null;
}

export async function waitForPeer({ repo, run, group, api, timeoutMs = 175 * 60_000, now = Date.now, sleep: pause = sleep, log = console.log }) {
  const lead = `held by run ${run}: `;
  const fail = (reason) => {
    log(`${lead}${reason}; relaunch with --gates e2e:${group} (explicit), or rerun ${run} and then this job`);
    return 1;
  };
  if (!/^\d+$/.test(String(run)) || typeof group !== 'string' || !group || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return fail('invalid peer waiter inputs');
  const deadline = now() + timeoutMs;
  const runPath = `/repos/${repo}/actions/runs/${run}`;
  let errors = 0;
  while (now() < deadline) {
    try {
      const holder = await api(runPath);
      const jobs = await jobsOf(api, runPath);
      const verdict = verdictOf(holder, jobs, group);
      errors = 0;
      if (verdict === 'success') {
        log(`${lead}success`);
        return 0;
      }
      if (verdict !== null) return fail(verdict);
    } catch (error) {
      errors++;
      log(`${lead}API attempt ${errors}/3 failed: ${error.message}`);
      if (errors === 3) return fail('could not read the holder after three API attempts');
    }
    // Each poll costs two requests from the repository's shared GITHUB_TOKEN budget (1,000/hour). Five deferred
    // siblings use 300/hour at this pace, leaving room for their plan lookups and other runs; errors retry sooner.
    await pause(Math.min(errors > 0 ? 30_000 : 120_000, Math.max(0, deadline - now())));
  }
  return fail('timed out; holder was still unfinished');
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await waitForPeer({
    repo: process.env.GITHUB_REPOSITORY, run: process.env.PEER_RUN, group: process.env.PEER_GROUP,
    timeoutMs: Number(process.env.PEER_WAIT_MINUTES || 175) * 60_000, api: githubApi(process.env),
  });
}
