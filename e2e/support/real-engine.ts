// P4-AGG M1 (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, M1 Touches): the real engine the Discover e2e
// group runs, every plugin listing and mutation of its acceptance being the unmodified CLI's own. The binary is
// MAWS_E2E_ENGINE_BIN, which the job's provisioning step (scripts/provision-engine.sh) exports, else the installed
// ~/.local/share/claude/versions/2.1.309. Provisioning and this check are two steps on purpose: a job that skipped
// provisioning, or a machine holding another release, fails here at test time with the command that provisions it,
// never a skip (B1). The replay pin of the other groups (test/support/engine-pin) is not this.
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const REAL_ENGINE_VERSION = '2.1.309';
export const PROVISION_COMMAND = `eval "$(scripts/provision-engine.sh ${REAL_ENGINE_VERSION})"`;

export interface RealEngine {
  bin: string;
  version: string; // the version token the binary reports
}

export function realEngineCandidate(env: Record<string, string | undefined>, home: string): string {
  return env.MAWS_E2E_ENGINE_BIN || join(home, '.local/share/claude/versions', REAL_ENGINE_VERSION);
}

// `versionOf` answers the binary's `--version` output, or null when nothing at that path answers it.
export function verifyRealEngine(bin: string, versionOf: (bin: string) => string | null): RealEngine {
  const output = versionOf(bin);
  const version = output === null ? null : (/\d+\.\d+\.\d+\S*/.exec(output)?.[0] ?? null);
  const provision = `Provision it from the repository root with ${PROVISION_COMMAND}, or set MAWS_E2E_ENGINE_BIN to a ${REAL_ENGINE_VERSION} binary.`;
  if (version === null) throw new Error(`The Discover e2e group runs the real engine ${REAL_ENGINE_VERSION}, and no engine answers --version at ${bin}. ${provision}`);
  if (version !== REAL_ENGINE_VERSION) throw new Error(`The Discover e2e group runs the real engine ${REAL_ENGINE_VERSION}; ${bin} is ${version}, not ${REAL_ENGINE_VERSION}. ${provision}`);
  return { bin, version };
}

function versionOf(bin: string): string | null {
  try {
    return execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

// Resolved and verified once per worker, when a test first asks (never at import, so collecting a spec costs nothing).
let resolved: RealEngine | null = null;
export function realEngine(): RealEngine {
  resolved ??= verifyRealEngine(realEngineCandidate(process.env, homedir()), versionOf);
  return resolved;
}
