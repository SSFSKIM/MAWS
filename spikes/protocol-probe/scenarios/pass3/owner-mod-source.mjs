import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// Source selection belongs to the invocation, not the scrubbed engine environment.
const invocationEnv = { MAWS_OWNER_MOD_DIR: process.env.MAWS_OWNER_MOD_DIR };

// An exported plugin can carry an owner-commit file alongside its original manifest.
export function ownerModSource({ env = invocationEnv, cache = '/Users/new/.claude/plugins/cache/doperpowers/doperpowers' } = {}) {
  const version = env.MAWS_OWNER_MOD_DIR ? undefined : readdirSync(cache).filter(v => /^\d+\.\d+\.\d+$/.test(v)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
  const root = env.MAWS_OWNER_MOD_DIR || join(cache, version);
  const ownerSource = join(root, 'hooks/mods/to-human.tsx');
  const ownerVersion = JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8')).version;
  const commitFile = join(root, 'owner-commit');
  return { root, ownerSource, ownerVersion, ownerSha256: createHash('sha256').update(readFileSync(ownerSource)).digest('hex'), ...(existsSync(commitFile) ? { ownerCommit: readFileSync(commitFile, 'utf8').trim() } : {}) };
}
