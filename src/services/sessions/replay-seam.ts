// The end-to-end seam (C10 execution document, M3 decisions): under `MAWS_E2E=1` with
// `MAWS_E2E_REPLAY_FIXTURES=<path>[,<path>…]`, each `session.launch` the service makes, bootstraps and forks included,
// takes the next path as its `replay` (C3's transport, `MAWS_ENGINE_REPLAY=1`) and pins that fixture's recorded
// session id, so every launch binds a distinct id its frames carry. The list is consumed once; a launch past its end is
// refused, so a test that launches more than it planned fails loudly.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SessionId } from '@shared/graph/ids';

type Row = { direction?: string; frame?: { type?: string; subtype?: string; session_id?: unknown; event?: string; args?: unknown } };

// A fixture's recorded session id: the first `system/init` row's, else the `--session-id` its `spawn` row's `args`
// carry (a no-turn trust bootstrap emits no `system/init`). Both present and different, or neither, is an error.
// (test/support/fixture-session-id.ts reads the same rule for the tests, with the first prompt beside it.)
export function fixtureSessionId(file: string): SessionId {
  const rows = readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Row);
  const init = rows.find((r) => r.direction === 'in' && r.frame?.type === 'system' && r.frame.subtype === 'init')?.frame?.session_id;
  const args = rows.find((r) => r.direction === 'meta' && r.frame?.event === 'spawn')?.frame?.args;
  const at = Array.isArray(args) ? args.indexOf('--session-id') : -1;
  const pin = at >= 0 && typeof (args as unknown[])[at + 1] === 'string' ? ((args as string[])[at + 1] as string) : null;
  const recorded = typeof init === 'string' && init.length > 0 ? init : null;
  if (recorded !== null && pin !== null && recorded !== pin) throw new Error(`${file}: system/init names ${recorded} but the spawn row pins ${pin}`);
  const id = recorded ?? pin;
  if (id === null) throw new Error(`${file}: no session id (no system/init row and no --session-id in the spawn row)`);
  return id as SessionId;
}

export class ReplaySeam {
  private next_ = 0;

  // `paths` as the environment lists them (absolute, or relative to `cwd`, which is also where C3's launcher resolves
  // a relative replay path: both processes start in the app's working directory).
  constructor(
    private readonly paths: readonly string[],
    private readonly cwd: string,
  ) {}

  static fromEnv(env: NodeJS.ProcessEnv, cwd: string): ReplaySeam | null {
    if (env.MAWS_E2E !== '1' || !env.MAWS_E2E_REPLAY_FIXTURES) return null;
    return new ReplaySeam(env.MAWS_E2E_REPLAY_FIXTURES.split(',').map((p) => p.trim()).filter((p) => p.length > 0), cwd);
  }

  // The next launch's fixture and its pin, or null when the list is spent.
  take(): { path: string; sessionId: SessionId } | null {
    const path = this.paths[this.next_];
    if (path === undefined) return null;
    this.next_ += 1;
    return { path, sessionId: fixtureSessionId(resolve(this.cwd, path)) };
  }
}
