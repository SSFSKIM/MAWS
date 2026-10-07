// Test engine selection (charter D-1, W13 and FX4). Fixtures retain their recording version even when the installer
// removes that binary. Live runs prefer an explicit override, then the retained pin, then the newest installed release.
// Node imports only: the probe runner's .mjs imports this module directly with Node's type stripping. It sits in its own
// directory beside a package.json declaring `"type": "module"`, so Node loads it as ESM without guessing (and without the
// MODULE_TYPELESS_PACKAGE_JSON warning); importers name the directory, which every resolver maps to this index.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const FIXTURE_ENGINE_VERSION = '2.1.283';
const versions = join(homedir(), '.local/share/claude/versions');
const pinned = join(versions, FIXTURE_ENGINE_VERSION);
function engineBin(): string {
  if (process.env.MAWS_E2E_ENGINE_BIN) return process.env.MAWS_E2E_ENGINE_BIN;
  if (existsSync(pinned)) return pinned;
  const newest = existsSync(versions)
    ? readdirSync(versions, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^\d+\.\d+\.\d+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))[0]
    : undefined;
  // Keep a missing path reportable by live gates; importing replay support must not require a local installation.
  return newest ? join(versions, newest) : pinned;
}
const candidate = engineBin();
// A moving installer link must not change the file behind the version cached below.
export const ENGINE_BIN = existsSync(candidate) ? realpathSync(candidate) : candidate;
export const ENGINE_VERSION = (() => {
  try {
    const output = execFileSync(ENGINE_BIN, ['--version'], { encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return /\d+\.\d+\.\d+[^\s]*/.exec(output)?.[0] ?? ''; // Same version token the product probe reports.
  } catch {
    return ''; // Missing, unexecutable or unversioned: the live gate reports it; no fixture-version impersonation.
  }
})();
