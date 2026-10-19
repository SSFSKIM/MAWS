// A session's liveness as the shell reads it (2026-10-18, owner): an async question its log holds open waits on you
// until the plane settles it, as the hub's waiting count has it, whether or not the log has its `answered` yet.
import { describe, expect, it } from 'vitest';
import type { LogEvent, Raised, Settled } from 'desk-hub/protocol';
import { openQuestions, projectSessions, groupOf } from '../log/projection';
import type { LiveState } from '../project/connection';
import { requestKey, type ConversationState, type RequestRecord } from '../project/conversation';
import { livenessOf } from './sessions';

const S1 = '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b';
const mac = { nonce: 'n', value: 'v' };
let offset = 0;
const ev = (kind: string, fields: Record<string, unknown>) => ({ offset: ++offset, event: { ts: '2026-10-18T08:00:00.000Z', writer: `mini/${S1}`, seq: offset, kind, mac, ...fields } as LogEvent });

const entries = [
  ev('joined', { session: S1, alias: 'maws-45', name_source: 'user', machine: 'mini', cwd: '/w/maws', worktree: '', role: '', seat: '', by: '' }),
  ev('question', { from: 'maws-45', to: 'host', text: ['Ship it?'], choices: ['Yes', 'No'], src: 'toolu_bridge' }),
];
const session = projectSessions(entries).get(S1)!;
const asking = openQuestions(entries);
const live: LiveState = {
  status: 'open',
  connected: true,
  caughtUp: true,
  presence: { [S1]: { record: { status: 'busy' }, bridge: true } },
  machines: { mini: { online: true, policy: { read_only: false, ceiling: 'default' }, checkouts: [] } },
  pending: [],
  audit: [],
} as unknown as LiveState;

/** The conversation's record of the ask's request, raised by the bridge, settled or not. */
function requests(settled: Settled | null): ConversationState['requests'] {
  const raised = { request: 'toolu_bridge', session: S1, tool: 'mcp__doperpowers__AskUserQuestion', input: {}, async: true, mac } as Raised;
  const key = requestKey({ machine: 'mini', session: S1, request: 'toolu_bridge' });
  return { [key]: { key, request: 'toolu_bridge', machine: 'mini', raised, at: 2, pending: settled === null, terminalOnly: false, settled } satisfies RequestRecord };
}

describe('livenessOf', () => {
  it("counts an open log question, and leaves out one the plane settled before the log's answered", () => {
    expect(livenessOf(live, {}, asking, session)).toMatchObject({ pending: 0, questions: 1 });
    expect(groupOf(session, livenessOf(live, {}, asking, session))).toBe('waiting');
    expect(livenessOf(live, requests(null), asking, session).questions).toBe(1);
    const settled = { request: 'toolu_bridge', winner: 'web', outcome: 'answered', by: 'm', mac } as Settled;
    expect(livenessOf(live, requests(settled), asking, session).questions).toBe(0);
    // Settled, it waits on nobody: its busy presence reads as working.
    expect(groupOf(session, livenessOf(live, requests(settled), asking, session))).toBe('working');
  });
});
