// A `LaneAState` and a catalog for the renderer's lane A suites (P5 O9 M5): a live bridge with every op and control the
// fake bridge's full capabilities name (test/support/fake-bridge.ts `FULL_CAPABILITIES`), idle, with no override.
import type { AppSessionId } from '@shared/graph/ids';
import type { LaneACatalog, LaneAState } from '@shared/ipc/schema/lane-a';

export const LIVE_OPS = ['ping', 'steer', 'interrupt', 'stop', 'model', 'compact', 'deliver', 'answer', 'read', 'command', 'btw', 'stop-agent', 'tell', 'media'];

export const LIVE_CONTROLS: LaneAState['controls'] = {
  'read.usage': { available: true },
  'read.config': { available: true },
  'read.settings': { available: true },
  'read.mcp': { available: true },
  btw: { available: true },
  compact: { available: true },
  model: { available: true },
  'mcp.enable': { available: true },
  'mcp.disable': { available: false, reason: 'the route table drops /mcp disable on this engine' },
  'mcp.reconnect': { available: true },
  decide: { available: true },
  'decide.scope': { available: true },
  'decide.interrupt': { available: false, reason: 'deny-and-interrupt is answered in the terminal' },
  'decide.addDirectory': { available: true },
  'stop-agent': { available: true },
  tell: { available: true },
  media: { available: true },
  forget: { available: false, reason: 'forget runs in the terminal' },
  'rewind-files': { available: false, reason: 'file rollback runs in the terminal' },
  'elicitation.answer': { available: false, reason: 'answer this form in the terminal' },
};

export function laneAState(appSessionId: AppSessionId, over: Partial<LaneAState> = {}): LaneAState {
  return {
    appSessionId,
    engineSessionId: 'eng-1',
    bridge: 'live',
    reason: null,
    launch: 'launch-1',
    sminos: '1.25.0',
    ops: LIVE_OPS,
    reads: ['status', 'catalog', 'usage', 'config', 'settings', 'mcp'],
    controls: LIVE_CONTROLS,
    turn: { running: false, unknown: false },
    model: 'claude-opus-4-5',
    effort: null,
    override: null,
    mode: null,
    catalog: { fingerprint: 'fp-1' },
    pending: [],
    settled: [],
    deliveries: [],
    ...over,
  };
}

const run = { class: 'run', enabled: true, measured: 'M' } as const;

// A catalog with a runnable command, a command that takes arguments, a panel, a disabled one, `/mcp` whose argument form
// runs, and the model widgets' own names.
export function laneACatalog(over: Partial<LaneACatalog> = {}): LaneACatalog {
  return {
    fingerprint: 'fp-1',
    commands: [
      { name: 'rename', description: 'Rename the session', source: 'builtin', route: { ...run, forms: { args: 'required', hint: '<name>' } } },
      { name: 'cost', description: 'Show the cost', source: 'builtin', route: run },
      { name: 'config', description: 'Open config', source: 'builtin', route: { class: 'panel', enabled: true, measured: 'M' } },
      { name: 'doctor', description: 'Diagnose', source: 'builtin', route: { class: 'local', enabled: false, reason: 'runs only in the terminal', measured: 'M' } },
      { name: 'mcp', description: 'Manage MCP servers', source: 'builtin', route: { class: 'panel', enabled: true, measured: 'M' }, withArgs: { ...run, forms: { args: 'required', pattern: '(enable|disable|reconnect) .+' } } },
      { name: 'model', description: 'Set the model', source: 'builtin', route: { class: 'routed', to: 'model', enabled: true, measured: 'M' } },
      { name: 'compact', description: 'Compact', source: 'builtin', route: { class: 'routed', to: 'compact', enabled: true, measured: 'M' } },
      { name: 'review', description: 'Review a change', source: 'plugin', plugin: 'tools', route: { class: 'run-prompt', enabled: true, measured: 'M' } },
    ],
    models: { options: ['opus', 'sonnet', 'haiku'], aliases: { opus: 'claude-opus-4-5', sonnet: 'claude-sonnet-4-5', haiku: 'claude-haiku-4-5', default: null } },
    measured: '2.1.300',
    skills: [],
    ...over,
  };
}
