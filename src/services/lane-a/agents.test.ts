// The bridge's agents (UX wave U8d M2, decision 3), folded as sminos's bridge child folds them: the state stream's
// snapshot replaces the map, each `agent` event merges into it. The events are in the shape the bridge was recorded
// sending (spikes/protocol-probe/fixtures/uxwave/u8d-p2-*.terminal.json, key `bridge`); ids and text are invented.
import { describe, expect, it } from 'vitest';
import { BridgeAgents } from './agents';

const spawn = (agentId: string, over: Record<string, unknown> = {}) => ({
  n: 36, type: 'agent', phase: 'spawn', agentId, parentAgentId: null, subagentType: 'general-purpose', description: 'count the files', name: null, background: true,
  model: 'claude-haiku-4-5', toolUseId: `toolu_made_up_${agentId.slice(-3)}`, t: 1_794_741_208_926, ...over,
});
const stop = (agentId: string, over: Record<string, unknown> = {}) => ({ n: 86, type: 'agent', phase: 'stop', agentId, agentType: 'general-purpose', t: 1_794_741_218_026, ...over });

describe('the bridge’s agents', () => {
  it('holds nothing before the first snapshot, and an empty map from a snapshot with no agents', () => {
    const agents = new BridgeAgents();
    expect(agents.list()).toBeNull();
    expect(agents.event(spawn('a0b1c2d3e4f500001'))).toBe(false); // the stream opens with a snapshot: nothing before it
    agents.snapshot(undefined); // a bridge older than its agent reports
    expect(agents.list()).toEqual([]);
  });

  it('merges a spawn and its stop as the child does: every key but type, phase, n and t, running until the stop', () => {
    const agents = new BridgeAgents();
    agents.snapshot([]);
    expect(agents.event(spawn('a0b1c2d3e4f500001'))).toBe(true);
    expect(agents.list()).toEqual([{ agentId: 'a0b1c2d3e4f500001', parentAgentId: null, subagentType: 'general-purpose', description: 'count the files', name: null, background: true, model: 'claude-haiku-4-5', toolUseId: 'toolu_made_up_001', running: true }]);
    expect(agents.event(stop('a0b1c2d3e4f500001', { status: 'killed' }))).toBe(true);
    expect(agents.list()).toEqual([{ agentId: 'a0b1c2d3e4f500001', parentAgentId: null, subagentType: 'general-purpose', description: 'count the files', name: null, background: true, model: 'claude-haiku-4-5', toolUseId: 'toolu_made_up_001', agentType: 'general-purpose', status: 'killed', running: false }]);
  });

  it('says an event changed nothing when it merges to what was held, whatever its time', () => {
    const agents = new BridgeAgents();
    agents.snapshot([]);
    agents.event(spawn('a0b1c2d3e4f500001'));
    const version = agents.version;
    expect(agents.event(spawn('a0b1c2d3e4f500001', { n: 37, t: 1_794_741_209_000 }))).toBe(false);
    expect(agents.version).toBe(version);
    expect(agents.event({ type: 'agent', phase: 'stop', agentType: '' })).toBe(false); // no id: nobody's
  });

  it('keeps an id that is no agent as the child keeps it, not running (N10)', () => {
    const agents = new BridgeAgents();
    agents.snapshot([]);
    expect(agents.event(stop('a0b1c2d3e4f5000x9', { agentType: '' }))).toBe(true);
    expect(agents.list()).toEqual([{ agentId: 'a0b1c2d3e4f5000x9', agentType: '', running: false }]);
  });

  it('replaces the whole map at a fresh snapshot, and counts it a change only when it differs', () => {
    const agents = new BridgeAgents();
    agents.snapshot([{ agentId: 'a0b1c2d3e4f500001', running: true, t: 5 }]);
    agents.event(spawn('a0b1c2d3e4f500002'));
    const version = agents.version;
    agents.snapshot([{ agentId: 'a0b1c2d3e4f500002', running: false }]);
    expect(agents.version).toBe(version + 1);
    expect(agents.list()).toEqual([{ agentId: 'a0b1c2d3e4f500002', running: false }]);
    agents.snapshot([{ agentId: 'a0b1c2d3e4f500002', running: false, t: 9 }, { running: true }]); // the same, by every key it keeps
    expect(agents.version).toBe(version + 1);
  });

  it('lets the oldest agents that no longer run go past two hundred, as the child does', () => {
    const agents = new BridgeAgents();
    agents.snapshot([]);
    for (let i = 0; i < 200; i++) agents.event(stop(`a${String(i).padStart(16, '0')}`));
    agents.event(spawn('arunning000000001'));
    const ids = agents.list()!.map((a) => a.agentId);
    expect(ids).toHaveLength(200);
    expect(ids[0]).toBe('a0000000000000001');
    expect(ids.at(-1)).toBe('arunning000000001');
  });

  it('holds nothing again once cleared, a change only when it held something', () => {
    const agents = new BridgeAgents();
    agents.clear();
    expect(agents.version).toBe(0);
    agents.snapshot([]);
    agents.clear();
    expect(agents.list()).toBeNull();
    expect(agents.version).toBe(2);
  });
});
