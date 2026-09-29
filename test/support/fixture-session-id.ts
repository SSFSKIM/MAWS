// The recorded identity of a replay fixture (C10 execution document, Repository map and M1 decisions): under replay a
// launch's engine id is the fixture's, so a setup pins that id and the first-send e2e sends exactly the recorded
// prompt. The id is the first `system/init` row's `session_id`; a no-turn fixture (a trust bootstrap) emits none, so
// its launch was pinned with `--session-id` and the `spawn` meta row's `args` carry it. Both present and different, or
// neither present, is an error: a fixture that cannot name its session must not stand in for one.
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { SessionId } from '../../src/shared/graph/ids';

const REPO_ROOT = join(__dirname, '../..');

export interface FixtureIdentity {
  sessionId: SessionId;
  firstPrompt: { content: unknown; display: string } | null; // the first `out` user frame's content and its text; null for a no-turn fixture
}

type Row = { direction?: string; frame?: { type?: string; subtype?: string; session_id?: unknown; event?: string; args?: unknown; message?: { content?: unknown } } };

function displayOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block): block is { type: 'text'; text: string } => (block as { type?: unknown })?.type === 'text' && typeof (block as { text?: unknown }).text === 'string')
    .map((block) => block.text)
    .join('\n');
}

// `path`: absolute, or relative to the repository root (`spikes/protocol-probe/fixtures/pass3/…`).
export function fixtureIdentity(path: string): FixtureIdentity {
  const file = isAbsolute(path) ? path : join(REPO_ROOT, path);
  const rows = readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Row);
  const init = rows.find((r) => r.direction === 'in' && r.frame?.type === 'system' && r.frame.subtype === 'init')?.frame?.session_id;
  const args = rows.find((r) => r.direction === 'meta' && r.frame?.event === 'spawn')?.frame?.args;
  const at = Array.isArray(args) ? args.indexOf('--session-id') : -1;
  const pin = at >= 0 && typeof (args as unknown[])[at + 1] === 'string' ? ((args as string[])[at + 1] as string) : null;
  const recorded = typeof init === 'string' && init.length > 0 ? init : null;
  if (recorded !== null && pin !== null && recorded !== pin) throw new Error(`${path}: system/init names ${recorded} but the spawn row pins ${pin}; the two disagree`);
  const sessionId = recorded ?? pin;
  if (sessionId === null) throw new Error(`${path}: no session id (no system/init row and no --session-id in the spawn row)`);
  const user = rows.find((r) => r.direction === 'out' && r.frame?.type === 'user')?.frame;
  return { sessionId: sessionId as SessionId, firstPrompt: user ? { content: user.message?.content, display: displayOf(user.message?.content) } : null };
}
