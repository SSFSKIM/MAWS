// P2-F L99's diagnosis (docs/doperpowers/plans/2026-10-09-p2-f-finish.md, M1 "L99"): which mode the engine runs in after
// a running session in auto mode is switched to a model that cannot hold auto (Haiku). No admitted fixture carries a
// `set_model` from auto to such a model (pass2/auto-routed and auto-unrouted set `default` first), so this one session
// records it: launched on Sonnet in auto (no turn on Sonnet), switched to Haiku through `session.setModel`, then one
// Haiku turn asking for a Bash command, so the turn's `system/init` and whether the Bash call asks for permission say
// the mode the engine runs in. Through MAWS's own engine host (LiveHost), under a scratch config home under /tmp,
// through ClaudeUsage's relay, capped at the engine (`--max-budget-usd 0.05`). The owner's ~/.claude.json is read only.
// It asserts (P2-F W-C review fix): the switch is accepted; MAWS's resolved model is the engine catalogue's `haiku` row;
// the next turn's `system/init` runs that model and carries a mode, `auto` exactly when that row holds auto; and MAWS's
// effective mode (`status.permissionMode.effective`, the value the composer's mode chip draws through
// `statusline/mode-menu.ts` `liveModeBinding`) is that init's mode after the turn.
// `MAWS_LIVE=1 pnpm exec vitest run --project live test/live/model-change-from-auto.live.test.ts`
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import { liveSpec } from './support/live';
import { LiveHost } from './support/live-host';
import { answerWhileRunning, closeSession, liveCase, openGate, readJournal, scratchRepo, type GateResult } from './support/harness';

const TURN_MS = 300_000;
const CASE_MS = 600_000;
const MAX_USD = 0.05;
const SCENARIO = 'p2f-model-change-from-auto';
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Kind = SessionEvent['kind'];
type Ev<K extends Kind> = Extract<SessionEvent, { kind: K }>;
const ofKind = <K extends Kind>(events: SessionEvent[], kind: K): Ev<K>[] => events.filter((e): e is Ev<K> => e.kind === kind);

let gate: GateResult;
const report: string[] = [];

beforeAll(async () => {
  gate = await openGate('p2f-l99', (line) => report.push(line));
  if ('skip' in gate) return;
  report.push(`engine ${gate.bin} (${gate.version}); scratch home ${gate.home}; userData ${gate.userData}`, `A-15 before: ${gate.a15Before.length} keys`);
}, 300_000);

afterAll(() => {
  for (const line of report) console.log(`   ${line}`);
});

describe('a model change from auto to Haiku, live (P2-F L99)', () => {
  it('runs the mode the engine reports after the change, and the chip reads it', async (ctx) => {
    const g = liveCase(gate, ctx);
    const host = new LiveHost({ userData: g.userData, configHome: g.home, binary: null });
    const repo = scratchRepo(g, 'p2f-l99');
    const spec = liveSpec(repo, { model: 'sonnet', permissionMode: 'auto', permissionFallback: 'acceptEdits', subagentModel: 'haiku', maxBudgetUsd: MAX_USD });
    const id = spec.appSessionId;
    const mode = () => JSON.stringify(host.status(id)?.permissionMode ?? null);
    let journalPath = '';
    let stopAnswering = () => {};
    try {
      const { status } = await host.launch(spec, 120_000);
      journalPath = status.journalPath;
      report.push(`ready: model ${JSON.stringify(status.model)}, mode ${mode()}`);
      const before = readJournal(journalPath).length;
      const set = await host.call('session.setModel', { appSessionId: id, model: 'haiku' });
      await delay(3_000);
      report.push(`session.setModel haiku: ${JSON.stringify(set)}; mode after ${mode()}`);
      expect(set).toEqual({ ok: true, error: null, code: null });
      const after = readJournal(journalPath).slice(before);
      report.push(`frames after set_model: ${JSON.stringify(after.map((r) => ({ seq: r.seq, direction: r.direction, frame: r.frame })))}`.slice(0, 4_000));

      const asked: string[] = [];
      stopAnswering = answerWhileRunning(host, id, [
        async () => {
          for (const e of ofKind(host.events(id), 'permission.requested')) if (!asked.includes(e.requestId)) asked.push(e.requestId);
        },
      ]);
      await host.call('session.send', { appSessionId: id, content: 'Use Bash to run exactly: git status --short. Then reply OK.' });
      const ended = await host.waitFor(() => ofKind(host.events(id), 'turn.ended').filter((e) => e.parentToolUseId === null && !e.isEchoReceipt)[0], 'the turn', TURN_MS);
      await host.waitFor(() => host.status(id)?.turn === null && host.status(id)?.pendingRequests === 0, 'idle with nothing pending', TURN_MS);
      stopAnswering();
      const rows = readJournal(journalPath);
      const inits = rows.filter((r) => r.direction === 'in' && (r.frame as { type?: string; subtype?: string }).type === 'system' && (r.frame as { subtype?: string }).subtype === 'init');
      const statuses = rows.filter((r) => r.direction === 'in' && (r.frame as { type?: string; subtype?: string }).type === 'system' && (r.frame as { subtype?: string }).subtype === 'status');
      report.push(
        `turn: ${JSON.stringify(ended.resultText)}`,
        `init frames' permissionMode and model: ${JSON.stringify(inits.map((r) => ({ seq: r.seq, permissionMode: (r.frame as { permissionMode?: unknown }).permissionMode, model: (r.frame as { model?: unknown }).model })))}`,
        `status frames: ${JSON.stringify(statuses.map((r) => ({ seq: r.seq, permissionMode: (r.frame as { permissionMode?: unknown }).permissionMode })))}`,
        `permission requests during the turn: ${asked.length} (${JSON.stringify(ofKind(host.events(id), 'permission.requested').map((e) => e.toolName))})`,
        `mode after the turn: ${mode()}`,
      );

      // The engine's own catalogue (the initialize response) says what `haiku` resolves to here and whether it holds auto.
      type CatalogueRow = { value?: unknown; resolvedModel?: unknown; supportsAutoMode?: unknown };
      const catalogue = rows
        .map((r) => (r.direction === 'in' ? (r.frame as { response?: { response?: { models?: CatalogueRow[] } } }).response?.response?.models : undefined))
        .find((models) => Array.isArray(models));
      const haiku = catalogue?.find((m) => m.value === 'haiku');
      report.push(`catalogue haiku row: ${JSON.stringify(haiku ?? null)}`);
      expect(haiku, 'the engine answered a catalogue with a haiku row').toBeDefined();
      const expected = haiku?.resolvedModel;
      expect(typeof expected).toBe('string');
      const turnInit = inits.find((r) => rows.indexOf(r) >= before); // the first init after set_model
      expect(turnInit, "the Haiku turn's system/init").toBeDefined();
      const engineMode = (turnInit?.frame as { permissionMode?: unknown }).permissionMode;
      expect(typeof engineMode, 'the init carries the mode the engine runs in').toBe('string');
      expect((turnInit?.frame as { model?: unknown }).model).toBe(expected);
      expect(engineMode === 'auto').toBe(haiku?.supportsAutoMode === true);
      const settled = host.status(id);
      expect(settled?.model.resolved).toBe(expected);
      expect(settled?.permissionMode.effective, "MAWS's effective mode (the chip's value) is the engine's").toBe(engineMode);
      report.push(`session.stop: ${JSON.stringify(await host.call('session.stop', { appSessionId: id, reason: 'stop' }))}`);
    } finally {
      stopAnswering();
      await closeSession(host, g, {
        appSessionId: id, journalPath, scenario: SCENARIO,
        provenance: { charter: 'docs/charter.md', child: 'P2-F', pin: 'ebcf71cba3c9', document: 'docs/doperpowers/plans/2026-10-08-p2-daily-driver.md', executionDocument: 'docs/doperpowers/plans/2026-10-09-p2-f-finish.md' },
      }, (line) => report.push(line));
    }
  }, CASE_MS);
});
