// Sample with the caller's gh token: GITHUB_TOKEN cannot read runners or the account's private repositories.
// MAWS must be complete (undercounting EC2's queue favors EC2); other repos may be lower bounds at the call cap.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { backlogOf } from '../.github/scripts/gate-backlog.mjs';

const DEFAULT_REPOS = ['SSFSKIM/MAWS', 'SSFSKIM/cua', 'SSFSKIM/doperpowers', 'SSFSKIM/ci-kit', 'SSFSKIM/manim-master'];
const need = (condition, message) => { if (!condition) throw new Error(message); };
const apiOf = (path, timeout) => JSON.parse(execFileSync('gh', ['api', path], {
  encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: 16 << 20, stdio: ['ignore', 'pipe', 'pipe'],
}));

function quotaRepos(env) {
  const repo = env.REPO || 'SSFSKIM/MAWS';
  const repos = env.HOSTED_MAC_REPOS ? env.HOSTED_MAC_REPOS.split(/[\s,]+/).filter(Boolean) : DEFAULT_REPOS;
  const valid = (name) => /^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(name) && !['.', '..'].includes(name.split('/')[1]);
  need(valid(repo), 'REPO must name an owner/repository');
  need(repos.length > 0 && repos.every(valid), 'HOSTED_MAC_REPOS must list owner/repository names');
  // GitHub names are case-insensitive. Count our queue first, even if the quota list omits it.
  const seen = new Set();
  return { repo, repos: [repo, ...repos].filter((name) => !seen.has(name.toLowerCase()) && seen.add(name.toLowerCase())) };
}

export async function sampleBacklog({ api = apiOf, now = Date.now, maxCalls = 60, budgetMs = 45_000, env = process.env } = {}) {
  const { repo: ownRepo, repos } = quotaRepos(env);
  const start = now();
  let calls = 0;
  const read = async (path) => {
    need(calls < maxCalls, 'backlog call cap reached');
    const remaining = budgetMs - (now() - start);
    need(remaining > 0, 'backlog timeout');
    calls++;
    return api(path, Math.min(10_000, remaining));
  };
  const pages = async (path, key, visit) => {
    for (let page = 1; ; page++) {
      const data = await read(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      need(Array.isArray(data[key]) && Number.isSafeInteger(data.total_count) && data.total_count >= 0, `invalid ${key} response`);
      // Every MAWS page must be complete: missing its EC2-compatible jobs would favor overflow incorrectly.
      // Other repositories contribute only hosted counts, where a lower bound favors normal placement.
      const expected = Math.min(100, Math.max(0, data.total_count - (page - 1) * 100));
      if (path.startsWith(`repos/${ownRepo}/`)) need(data[key].length === expected,
        `incomplete ${key} response at ${path} page ${page}: expected ${expected}, got ${data[key].length}`);
      await visit(data[key]);
      if (page * 100 >= data.total_count) return;
      need(data[key].length === 100, `incomplete ${key} response`);
    }
  };
  let runner;
  await pages(`repos/${ownRepo}/actions/runners`, 'runners', (rows) => { runner ??= rows.find((r) => r.name === 'ci-kit-mac-ec2'); });
  need(runner && ['online', 'offline'].includes(runner.status) && typeof runner.busy === 'boolean' && Array.isArray(runner.labels), 'EC2 runner unreadable');
  const labels = new Set(runner.labels.map((label) => label.name?.toLowerCase()));
  need(['self-hosted', 'macos', 'arm64', 'ci-kit-mac-ec2'].every((label) => labels.has(label)), 'EC2 labels unreadable');
  const result = { v: 1, at: new Date(start).toISOString(), hostedQueued: 0, hostedRunning: 0, ec2: runner.status === 'offline' ? 'offline' : runner.busy ? 'busy' : 'idle', ec2Queued: 0, partial: [] };
  for (const repo of repos) {
    // Reserve no estimate of missing EC2 work: only the hosted-only repositories can truncate at the cap.
    if (calls >= maxCalls) {
      need(repo !== ownRepo, 'backlog call cap reached before MAWS was counted');
      result.partial.push(repo);
      continue;
    }
    const runs = new Set();
    try {
      for (const status of ['queued', 'in_progress']) {
        await pages(`repos/${repo}/actions/runs?status=${status}`, 'workflow_runs', (rows) => {
          for (const run of rows) { need(Number.isSafeInteger(run.id) && run.id > 0, 'invalid run id'); runs.add(run.id); }
        });
      }
      for (const run of runs) {
        const seen = new Set();
        await pages(`repos/${repo}/actions/runs/${run}/jobs?filter=latest`, 'jobs', (rows) => {
          for (const job of rows) {
            need(Number.isSafeInteger(job.id) && typeof job.status === 'string' && Array.isArray(job.labels) && job.labels.every((label) => typeof label === 'string'), 'invalid job');
            if (seen.has(job.id)) continue;
            seen.add(job.id);
            if (!['queued', 'in_progress'].includes(job.status)) continue;
            const requested = job.labels.map((label) => label.toLowerCase());
            if (requested.some((label) => label.startsWith('macos-'))) result[job.status === 'queued' ? 'hostedQueued' : 'hostedRunning']++;
            else if (repo === ownRepo && job.status === 'queued' && requested.length > 0 && requested.every((label) => labels.has(label))) result.ec2Queued++;
          }
        });
      }
    } catch (error) {
      if (repo !== ownRepo && error.message === 'backlog call cap reached') result.partial.push(repo);
      else throw error;
    }
  }
  return result;
}

// A lock prevents simultaneous callers from spending the same API budget. A sibling never waits for it: without a
// fresh completed sample it simply uses today's placement. Cache failures too, so a denied read is not a stampede.
export async function cachedBacklog({ cache, collect = sampleBacklog, now = Date.now }) {
  const cached = () => {
    try {
      const value = JSON.parse(readFileSync(cache, 'utf8'));
      if (now() - value.at >= 0 && now() - value.at < 60_000) return { sample: backlogOf(JSON.stringify(value.sample), now()) };
    } catch { /* missing or corrupt cache */ }
    return null;
  };
  const previous = cached();
  if (previous) return previous.sample;
  mkdirSync(dirname(cache), { recursive: true });
  const lock = `${cache}.lock`;
  try {
    // Two minutes exceeds the sampler's 45-second deadline. mtime also covers a crash before writing at.
    let at;
    try { at = Number(readFileSync(join(lock, 'at'), 'utf8')); } catch { try { at = statSync(lock).mtimeMs; } catch { /* no lock */ } }
    if (now() - at > 120_000) rmSync(lock, { recursive: true, force: true });
    mkdirSync(lock);
  } catch { return null; }
  try {
    writeFileSync(join(lock, 'at'), String(now()));
    const latest = cached();
    if (latest) return latest.sample;
    let sample = null;
    try { sample = backlogOf(JSON.stringify(await collect()), now()); } catch { /* fail open; retry after the cache expires */ }
    const temp = join(lock, 'sample.json');
    writeFileSync(temp, JSON.stringify({ at: now(), sample }));
    renameSync(temp, cache);
    return sample;
  } finally { rmSync(lock, { recursive: true, force: true }); }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Invalid configuration is a refusal, not an unavailable advisory sample.
  let quota;
  try { quota = quotaRepos(process.env); } catch (error) {
    process.stderr.write(`ci-gate: ${error.message}\n`);
    process.exitCode = 2;
  }
  if (quota) try {
    // Default callers keep sharing the sample and lock with older launchers; changed quotas are isolated.
    const key = createHash('sha256').update(JSON.stringify(quota)).digest('hex').slice(0, 16);
    const defaults = quota.repo === DEFAULT_REPOS[0] && JSON.stringify(quota.repos) === JSON.stringify(DEFAULT_REPOS);
    const cache = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'maws-ci', defaults ? 'mac-backlog-v1.json' : `mac-backlog-v1-${key}.json`);
    const sample = await cachedBacklog({ cache });
    if (sample) process.stdout.write(`Mac-Backlog: ${JSON.stringify(sample)}\n`);
    else process.stderr.write('ci-gate: Mac backlog unavailable; keeping normal placement\n');
  } catch {
    process.stderr.write('ci-gate: Mac backlog cache unreadable; keeping normal placement\n');
  }
}
