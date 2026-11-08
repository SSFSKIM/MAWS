// Both integration files use the real, checksum-pinned scanner. A cold cache
// fetches it; subsequent runs and sibling worktrees reuse that verified archive.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';

export const gitleaksTestCache = process.env.MAWS_APP_GITLEAKS_CACHE || join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'maws-app-gitleaks');

export function primeGitleaksTestCache() {
  // Prime before hosted-mac's fixtures substitute their fake API token. The scan
  // script validates the archive on every use and keys it by the pinned sha256.
  const empty = mkdtempSync(join(tmpdir(), 'gitleaks-test-prime-'));
  try {
    const run = spawnSync('bash', [fileURLToPath(new URL('./maws-app-scan.sh', import.meta.url)), empty], {
      env: { ...process.env, MAWS_APP_GITLEAKS_CACHE: gitleaksTestCache }, encoding: 'utf8',
    });
    if (run.status !== 0) throw new Error(`Cannot prime the pinned gitleaks: ${run.stdout}${run.stderr}`);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
}
