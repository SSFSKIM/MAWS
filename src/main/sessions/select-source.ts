// The launch mode, decided once at app ready (C5 execution document, Terms and Main modules; residue *Read model and
// stub source*). `index` is the production wiring (C4's index source, discovery, C3's attention service); `scenario`
// plays a stub scenario and nothing else: the read model refuses every other source, so C4's index never scans.
import { isAbsolute, resolve } from 'node:path';

export type LaunchMode = 'index' | 'scenario';
export type ScenarioClock = { kind: 'wall' } | { kind: 'manual' };
type Env = Record<string, string | undefined>;

const STUB = 'stub:';

export function launchMode(env: Env, packaged: boolean): LaunchMode {
  const stub = env.MAWS_SESSION_SOURCE?.startsWith(STUB) ?? false;
  return stub && (!packaged || env.MAWS_E2E === '1') ? 'scenario' : 'index';
}

// `stub:<path>`: relative to the repository root in dev (the app path under electron-vite); a packaged app accepts a
// relative path only under the e2e switch, since its app path is the asar and a stray variable must not steer it.
export function scenarioPath(env: Env, where: { packaged: boolean; appRoot: string }): string {
  const given = (env.MAWS_SESSION_SOURCE ?? '').slice(STUB.length);
  if (isAbsolute(given)) return given;
  if (where.packaged && env.MAWS_E2E !== '1') throw new Error(`scenario path ${JSON.stringify(given)} is relative; a packaged app needs an absolute path`);
  return resolve(where.appRoot, given);
}

// The manual clock is a test instrument: honoured only with MAWS_E2E=1.
export function scenarioClock(env: Env): ScenarioClock {
  return env.MAWS_SCENARIO_CLOCK === 'manual' && env.MAWS_E2E === '1' ? { kind: 'manual' } : { kind: 'wall' };
}
