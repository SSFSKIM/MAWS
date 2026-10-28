// GitHub reads shared by the best-effort holder lookup and the verdict waiter. Their callers choose different error
// policies: the lookup fails open to another Mac job; a waiter retries and then fails rather than losing the check.
export const JOB_STATUSES = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested', 'completed']);

export function githubApi(env) {
  return async (path) => {
    const response = await globalThis.fetch(`${env.GITHUB_API_URL || 'https://api.github.com'}${path}`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${env.GITHUB_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28' },
      signal: globalThis.AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`GitHub API ${response.status} for ${path}`);
    return response.json();
  };
}

export async function jobsOf(api, runPath) {
  const jobs = [];
  for (let page = 1; ; page++) {
    const data = await api(`${runPath}/jobs?filter=latest&per_page=100&page=${page}`);
    if (!Array.isArray(data.jobs)) throw new Error('invalid jobs response');
    for (const job of data.jobs) {
      if (typeof job.name !== 'string' || !JOB_STATUSES.has(job.status) || (job.status === 'completed' && typeof job.conclusion !== 'string')) throw new Error('invalid job');
    }
    jobs.push(...data.jobs);
    if (data.jobs.length < 100) return jobs;
  }
}
