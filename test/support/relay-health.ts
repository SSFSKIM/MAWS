import { execFileSync } from 'node:child_process';

// Called during live-spec collection, outside Playwright's per-test timeout.
export function relaySkipReason(url: string, timeoutMs = 5_000): string | null {
  try {
    const code = execFileSync('/usr/bin/curl', ['--silent', '--max-time', String(timeoutMs / 1000), '-o', '/dev/null', '-w', '%{http_code}', `${url}/api/hello`], {
      encoding: 'utf8', timeout: timeoutMs + 1_000, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return code === '200' ? null : `relay at ${url} answered ${code}: start ClaudeUsage`;
  } catch {
    return `relay at ${url} unavailable or timed out: start ClaudeUsage`;
  }
}
