// E11's sitting S1 (docs/doperpowers/plans/2026-10-06-e11-finish.md, Design §5 S1, Task 6.2): the fixture E1 and the P1
// spec's §14 leave to E11, an interrupt during a blocking `maws` ask. The installed Claude Code (`binary: null`, as main
// configures a fresh install), driven through MAWS's own engine host (LiveHost) under the shared harness's scratch
// config home under /tmp, through ClaudeUsage's relay, on Haiku in default permission mode, every permission allowed once.
// The model is told to call mcp__maws__ask itself with one blocking choice question; the case sends `session.interrupt`
// and expects: the engine's `mcp_message` carrying `notifications/cancelled` whose `params.requestId` is the ask's
// JSON-RPC id, the host's `{result: {}, id: 0}` answer to it, no result written for the `tools/call`, the host's
// `maws_ask_cancelled` meta row with reason `withdrawn`, the `maws.ask.cancelled` event, and a later `maws.ask.answer`
// answered `not_pending`; then the turn ends and the session stops. Up to three attempts, each a fresh session, varying
// the interrupt's moment (Design §8): as soon as `maws.ask.opened` arrives; five seconds after it; during the model's
// streaming before the call (its first block delta). The first attempt that meets every expectation is exported as
// `p1-maws-ask-interrupt` (journal and engine transcript, provenance child E11, this document, the P1 spec's pin), the
// others as `p1-maws-ask-interrupt-attempt<n>` for the record; if none does, the negative stands in the log with the
// journals and the engine version (the unit proof in session-maws.test.ts stands; a tracker row follows). Each attempt's
// `--max-budget-usd` is what the sitting's US$0.15 cap leaves (LiveLedger.assertUnderCap() before each). The owner's
// ~/.claude.json is only read (the A-15 reading before the first launch and after every attempt). The log is
// `live-s1.txt` under MAWS_P1_LIVE_OUT (default /tmp/maws-e11-p1-live); the exports land under the run's
// `<userData>/exports/` (printed), copied into spikes/protocol-probe/fixtures/pass3/ and test/fixtures/transcripts/ by
// hand after a look.
// `MAWS_LIVE=1 pnpm exec vitest run --project live test/live/maws-ask-interrupt.live.test.ts`
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { JournalRow } from '@shared/wire/journal';
import { a15Line, a15Reading, liveOutDir, sittingLog, type A15Reading } from '../../e2e/support/p1-live';
import { LiveLedger, liveSpec } from './support/live';
import { LiveHost } from './support/live-host';
import { answerWhileRunning, closeSession, liveCase, openGate, readJournal, scratchRepo, type GateResult, type LiveGate } from './support/harness';

const CAP_USD = 0.15; // Design §5 S1 (recorded blocking asks cost US$0.019 to 0.026)
const TURN_MS = 300_000;
const CASE_MS = 1_500_000; // three attempts on a loaded machine
const PIN = 'e09d2564f53f167d08a82cc15582991198ea4ad4'; // the P1 spec's blob at E11's dispatch (the document's pins)
const DOCUMENT = 'docs/doperpowers/plans/2026-10-06-e11-finish.md';
const SCENARIO = 'p1-maws-ask-interrupt';
const PROMPT =
  'Call the mcp__maws__ask tool yourself, never through an agent, and do nothing else first: blocking true, one question with id "q1", ' +
  'modality "choice", options "Red", "Green" and "Blue", and the question "Which colour?". When it answers, reply with the colour.';

// The interrupt's moments, in the order tried.
const MOMENTS = [
  { name: 'at the ask', what: 'as soon as maws.ask.opened arrived' },
  { name: 'later', what: 'five seconds after maws.ask.opened' },
  { name: 'streaming', what: 'at the model’s first streamed block, before the call' },
] as const;

type Kind = SessionEvent['kind'];
type Ev<K extends Kind> = Extract<SessionEvent, { kind: K }>;
const ofKind = <K extends Kind>(events: SessionEvent[], kind: K): Ev<K>[] => events.filter((e): e is Ev<K> => e.kind === kind);
const mainTurnsEnded = (events: SessionEvent[]) => ofKind(events, 'turn.ended').filter((e) => e.parentToolUseId === null && !e.isEchoReceipt);
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Frame = { type?: string; request_id?: string; event?: string; request?: { subtype?: string; server_name?: string; message?: { id?: unknown; method?: string; params?: { requestId?: unknown } } }; response?: { request_id?: string; response?: { mcp_response?: unknown } } } & Record<string, unknown>;
const frameOf = (row: JournalRow) => row.frame as Frame;

// The expectations, each with what the journal and the events showed.
function judge(rows: JournalRow[], events: SessionEvent[], answered: { outcome: string } | null): { name: string; ok: boolean; detail: string }[] {
  const opened = ofKind(events, 'maws.ask.opened')[0];
  if (opened === undefined) return [{ name: 'the ask opened', ok: false, detail: 'no maws.ask.opened: the interrupt came before the call' }];
  const call = rows.find((r) => r.direction === 'in' && frameOf(r).type === 'control_request' && frameOf(r).request_id === opened.requestId);
  const rpcId = frameOf(call!).request?.message?.id;
  const notice = rows.find((r) => {
    const request = frameOf(r).request;
    return r.direction === 'in' && frameOf(r).type === 'control_request' && request?.subtype === 'mcp_message' && request.server_name === 'maws' && request.message?.method === 'notifications/cancelled' && request.message.params?.requestId === rpcId;
  });
  const noticeAnswer = notice && rows.find((r) => r.direction === 'out' && frameOf(r).type === 'control_response' && frameOf(r).response?.request_id === frameOf(notice).request_id);
  const callAnswer = rows.find((r) => r.direction === 'out' && frameOf(r).type === 'control_response' && frameOf(r).response?.request_id === opened.requestId);
  const meta = rows.find((r) => r.direction === 'meta' && frameOf(r).event === 'maws_ask_cancelled' && (r.frame as { askId?: string }).askId === opened.askId);
  const cancelled = ofKind(events, 'maws.ask.cancelled').find((e) => e.askId === opened.askId);
  const mcpResponse = noticeAnswer ? (frameOf(noticeAnswer).response?.response?.mcp_response as { result?: unknown; id?: unknown } | undefined) : undefined;
  return [
    { name: 'the ask opened', ok: opened.blocking, detail: `askId ${opened.askId}, control request ${opened.requestId}, JSON-RPC id ${JSON.stringify(rpcId)}, blocking ${opened.blocking}` },
    { name: 'notifications/cancelled names the ask', ok: notice !== undefined, detail: notice ? `seq ${notice.seq}, request ${frameOf(notice).request_id}` : 'no notifications/cancelled naming the ask’s id' },
    { name: 'the host answered it {result: {}, id: 0}', ok: JSON.stringify(mcpResponse?.result) === '{}' && mcpResponse?.id === 0, detail: noticeAnswer ? `seq ${noticeAnswer.seq} ${JSON.stringify(mcpResponse)}` : 'no answer' },
    { name: 'no result for the tools/call', ok: callAnswer === undefined, detail: callAnswer ? `answered at seq ${callAnswer.seq}` : 'none written' },
    { name: 'maws_ask_cancelled withdrawn', ok: (meta?.frame as { reason?: string } | undefined)?.reason === 'withdrawn', detail: meta ? `seq ${meta.seq} ${JSON.stringify(meta.frame)}` : 'no meta row' },
    { name: 'maws.ask.cancelled withdrawn', ok: cancelled?.reason === 'withdrawn', detail: cancelled ? JSON.stringify({ askId: cancelled.askId, reason: cancelled.reason }) : 'no event' },
    { name: 'a later answer is not_pending', ok: answered?.outcome === 'not_pending', detail: JSON.stringify(answered) },
    { name: 'the turn ended', ok: mainTurnsEnded(events).length > 0, detail: JSON.stringify(mainTurnsEnded(events).map((t) => t.resultText)) },
  ];
}

let gate: GateResult;
const note = sittingLog(liveOutDir(), 's1');
const ledger = new LiveLedger(CAP_USD);
let a15First: A15Reading | null = null;

beforeAll(async () => {
  gate = await openGate('e11-s1', note);
  if ('skip' in gate) return;
  a15First = a15Reading();
  note(`==== S1, ${new Date().toISOString()}: an interrupt during a blocking maws ask (Design §5 S1)`);
  note(`engine ${gate.bin} (${gate.version}), unmodified, through the relay, Haiku, default permission mode; scratch home ${gate.home}; userData ${gate.userData}; cap US$${CAP_USD.toFixed(2)}`);
  note(a15Line('before the first launch', a15First, a15First, [gate.home, gate.userData]));
}, 300_000);

afterAll(() => {
  if ('skip' in gate) return;
  note(ledger.summary());
  if (a15First !== null) note(a15Line('after the sitting', a15First, a15Reading(), [gate.home, gate.userData]));
});

// One attempt: a fresh session, the prompt, the interrupt at its moment, the checks; exported, costed and its A-15
// reading checked by the shared harness's closeSession whatever happens. Answers whether every expectation held.
async function attempt(g: LiveGate, n: number, moment: (typeof MOMENTS)[number], exported: { done: boolean }): Promise<boolean> {
  ledger.assertUnderCap();
  const remaining = Number((CAP_USD - ledger.total).toFixed(4));
  const host = new LiveHost({ userData: g.userData, configHome: g.home, binary: null });
  const repo = scratchRepo(g, 'e11-s1');
  const spec = liveSpec(repo, { model: 'haiku', permissionMode: 'default', subagentModel: null, maxBudgetUsd: remaining });
  const id = spec.appSessionId;
  const events = () => host.events(id);
  let journalPath = '';
  let met = false;
  let stopAnswering = () => {};
  note(`attempt ${n} (${moment.what}): ${id}, maxBudgetUsd ${remaining.toFixed(4)}`);
  try {
    const { status } = await host.launch(spec, 120_000);
    journalPath = status.journalPath;
    stopAnswering = answerWhileRunning(host, id);
    await host.call('session.send', { appSessionId: id, content: PROMPT });
    if (moment.name === 'streaming') {
      await host.waitFor(() => ofKind(events(), 'assistant.block.delta')[0] ?? ofKind(events(), 'maws.ask.opened')[0], `${id} the model streaming`, TURN_MS);
    } else {
      await host.waitFor(() => ofKind(events(), 'maws.ask.opened')[0], `${id} maws.ask.opened`, TURN_MS);
      if (moment.name === 'later') await delay(5_000);
    }
    const opened = ofKind(events(), 'maws.ask.opened')[0];
    const interrupted = await host.call('session.interrupt', { appSessionId: id, cancelEngineQueued: false });
    note(`  interrupted ${opened ? 'with the ask open' : 'before the ask opened'}: ${JSON.stringify(interrupted)}`);
    await host.waitFor(() => host.status(id)?.turn === null && host.status(id)?.pendingRequests === 0, `${id} idle with nothing pending`, TURN_MS);
    const askId = ofKind(events(), 'maws.ask.opened')[0]?.askId;
    const answered = askId === undefined ? null : await host.call('maws.ask.answer', { appSessionId: id, askId, answers: [{ id: 'q1', question: 'Which colour?', status: 'answered', value: ['Blue'] }] });
    await delay(3_000); // the host's own reads after the turn answered (E1's idle-then-3-s)
    stopAnswering();
    note(`  session.stop: ${JSON.stringify(await host.call('session.stop', { appSessionId: id, reason: 'stop' }))}`);
    await host.waitFor(() => host.status(id)?.process === 'exited', `${id} exited`, 30_000);
    const checks = judge(readJournal(journalPath), events(), answered);
    for (const check of checks) note(`  ${check.ok ? 'ok  ' : 'FAIL'} ${check.name}: ${check.detail}`);
    met = checks.every((check) => check.ok);
  } catch (error) {
    note(`  attempt ${n} failed: ${String(error)}`);
  } finally {
    stopAnswering();
    // the first attempt to meet every expectation is the fixture; the others are kept under their attempt's name
    const scenario = met && !exported.done ? SCENARIO : `${SCENARIO}-attempt${n}`;
    const provenance = { charter: 'docs/charter.md', child: 'E11', pin: PIN, document: DOCUMENT };
    await closeSession(host, g, { appSessionId: id, journalPath, scenario, provenance, transcript: { name: `${scenario}-transcript`, engineSessionId: spec.sessionId! } }, (line) => note(`  ${line}`));
    if (journalPath) ledger.add(`attempt ${n}`, journalPath, readJournal(journalPath));
    if (met) exported.done = true;
    note(`  attempt ${n}: ${met ? 'every expectation met' : 'not met'}; ${ledger.summary()}; ${a15Line(`after attempt ${n}`, a15First!, a15Reading(), [g.home, g.userData])}`);
  }
  return met;
}

describe('an interrupt during a blocking maws ask, live (E11 S1)', () => {
  it('the engine cancels the ask’s tools/call with notifications/cancelled and the host withdraws the ask', async (ctx) => {
    const g = liveCase(gate, ctx);
    const exported = { done: false };
    let met: number | null = null;
    for (const [k, moment] of MOMENTS.entries()) {
      if (ledger.total >= CAP_USD) {
        note(`attempt ${k + 1}: not run (budget): ${ledger.summary()}`);
        break;
      }
      if (await attempt(g, k + 1, moment, exported)) {
        met = k + 1;
        break;
      }
    }
    note(met === null ? `S1: no live reproduction on ${g.version} in ${MOMENTS.length} attempts (the journals are under ${g.userData}/exports); the unit proof stands (src/engine-host/session-maws.test.ts) and the item goes to the tracker` : `S1: attempt ${met} met every expectation; the fixture is ${g.userData}/exports/${SCENARIO}.jsonl`);
    expect(met, `an attempt met every expectation on ${g.version}`).not.toBeNull();
  }, CASE_MS);
});
