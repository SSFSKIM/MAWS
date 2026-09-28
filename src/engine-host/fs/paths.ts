// Where the engine's store lives and how a working directory maps to its project slug (C4 execution document,
// "Filesystem service internals"; SPEC 35.1.1 and 35.2.1). Pure functions: no filesystem access here.
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface StorePaths {
  configHome: string;
  projects: string;
  sessions: string;
  jobs: string;
  tasks: string;
}

// `CLAUDE_CONFIG_DIR` if set, otherwise `~/.claude`, NFC-normalised, exactly as the engine resolves it (SPEC 35.1.1).
export function resolveStorePaths(env: NodeJS.ProcessEnv): StorePaths {
  const configHome = (env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')).normalize('NFC');
  return {
    configHome,
    projects: join(configHome, 'projects'),
    sessions: join(configHome, 'sessions'),
    jobs: join(configHome, 'jobs'),
    tasks: join(configHome, 'tasks'),
  };
}

const SLUG_MAX = 200;

// The engine's classic 32-bit string hash (SPEC 35.2.1, `oJ`).
function hash32(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  return hash;
}

// SPEC 35.2.1 exactly: every character outside [A-Za-z0-9] becomes `-` (no lowercasing, no run collapsing); past 200
// characters the slug is cut and suffixed with `-` plus the base-36 hash of the *original* path.
export function slugOf(realpath: string): string {
  const slug = realpath.replace(/[^a-zA-Z0-9]/g, '-');
  if (slug.length <= SLUG_MAX) return slug;
  return `${slug.slice(0, SLUG_MAX)}-${Math.abs(hash32(realpath)).toString(36)}`;
}
