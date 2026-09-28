// The live suite (C3 execution document, Acceptance item 3): the pinned binary through the gateway. Skipped, never
// failed, when the gate says so. Run with `MAWS_LIVE=1 pnpm test:live`; M1 carries only the free case below (no user
// turn, no model usage); M6 adds the numbered cases.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseJournalRow } from '@shared/wire/journal';
import { ENGINE_VERSION, RELAY_URL } from '../../src/engine-host/launch';
import { liveGate, liveSpec, withRawProcess } from './support/live';

interface StatusSection {
  title: string;
  rows: { label?: string; value: string }[];
}

describe('engine host live', () => {
  it('M1 initialize only, routed', async (ctx) => {
    const gate = await liveGate();
    if ('skip' in gate) {
      console.log(`↓ ${gate.skip}`);
      ctx.skip(gate.skip);
      return;
    }
    const spec = liveSpec(gate.scratch());
    const { journalPath, rows } = await withRawProcess(gate, spec, async (p) => {
      expect(p.plan.args).toContain('--session-id');
      expect(p.plan.env.ANTHROPIC_BASE_URL).toBe(RELAY_URL);

      const init = await p.request('initialize', {
        supportedDialogKinds: ['auto_mode_server_fallback', 'refusal_fallback_prompt'],
        perTaskStopAffordance: true,
      }, 15_000);
      expect(init.subtype).toBe('success');
      const initResponse = (init as { response: Record<string, unknown> }).response;
      expect(initResponse.current_permission_mode).toBe('auto');
      expect(Array.isArray(initResponse.models)).toBe(true);
      expect(Array.isArray(initResponse.commands)).toBe(true);

      const status = await p.request('get_status', {}, 15_000);
      expect(status.subtype).toBe('success');
      const sections = ((status as { response: { sections: StatusSection[] } }).response).sections;
      const session = sections.find((s) => s.title === 'Session');
      expect(session).toBeDefined();
      const baseUrl = session!.rows.find((r) => r.label === 'Anthropic base URL')?.value ?? null;
      console.log(`   get_status Anthropic base URL = ${baseUrl}`);
      expect(baseUrl).toBe(RELAY_URL);
      expect(session!.rows.find((r) => r.label === 'Session ID')?.value).toBe(spec.sessionId);
      expect(session!.rows.find((r) => r.label === 'Version')?.value).toBe(ENGINE_VERSION);
      const environment = sections.find((s) => s.title === 'Environment');
      expect(environment?.rows.find((r) => r.label === 'Auto mode server')?.value).toBe('Enabled');

      // No user frame was sent, so every `in` row is a control response or a startup system frame; no model turn ran.
      expect(p.rows.filter((r) => r.direction === 'out').every((r) => (r.frame as { type: string }).type === 'control_request')).toBe(true);
      expect(p.rows.some((r) => r.direction === 'in' && (r.frame as { type: string }).type === 'result')).toBe(false);
    });

    // The journal on disk: X8 rows with consecutive seq, the spawn meta row first, every frame in and out present.
    expect(journalPath).toContain(`/engine-host/journal/${spec.appSessionId}/`);
    const onDisk = readFileSync(journalPath, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => parseJournalRow(JSON.parse(line)));
    expect(onDisk.map((r) => r.seq)).toEqual(rows.map((r) => r.seq));
    expect(onDisk[0]).toMatchObject({ seq: 1, direction: 'meta', frame: { event: 'spawn', args: expect.arrayContaining(['--session-id', spec.sessionId]) } });
    const outbound = onDisk.filter((r) => r.direction === 'out').map((r) => (r.frame as { request: { subtype: string } }).request.subtype);
    expect(outbound).toEqual(['initialize', 'get_status']);
    expect(onDisk.at(-1)).toMatchObject({ direction: 'meta', frame: { event: 'exit' } });
  });
});
