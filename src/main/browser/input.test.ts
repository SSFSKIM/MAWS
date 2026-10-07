import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { TabDebugger } from './debugger';
import { attachInputSeams, classify, FROM_DEBUGGER, TabInputSeam, type InputEmission } from './input';
import type { TabEntry } from './tabs';

// E4-0's recordings (`spikes/browser-probe/results/pass2/input.json`, `input2.json`; findings-pass2.txt:72-170): every
// hook's events as main saw them, with the CDP commands' send and reply times, on one relative clock per phase.
const pass2 = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../../spikes/browser-probe/results/pass2/${name}`, import.meta.url)), 'utf8'));
const run1 = pass2('input.json') as { meta: { electron: string }; input: { phases: Phase[] } };
const run2 = pass2('input2.json') as { meta: { electron: string }; input2: { phases: (Phase & { attributedEvents: { type: string; attributed: 'agent' | 'human' }[] })[] } };

interface Recorded {
  at: number;
  type: string;
  _modifiers?: number;
}
interface Phase {
  label: string;
  commands?: { method?: string; type: string; sendRel: number; replyRel: number }[];
  inputEvents?: Recorded[];
  beforeInputEvents?: Recorded[];
  beforeMouseEvents?: Recorded[];
}

const phase = (phases: Phase[], label: string) => phases.find((p) => p.label.startsWith(label))!;

// webContents.debugger, attached, whose every command waits for the replay to reply.
function fakeDebugger() {
  const dbg = Object.assign(new EventEmitter(), {
    attached: false,
    pending: [] as { params: { type?: string }; resolve(value: unknown): void }[],
    attach() {
      dbg.attached = true;
    },
    detach() {
      dbg.attached = false;
    },
    isAttached: () => dbg.attached,
    sendCommand(method: string, params: { type?: string }) {
      if (method === 'Page.getFrameTree') return Promise.resolve({ frameTree: { frame: { id: 'F' } } });
      return new Promise((resolve) => dbg.pending.push({ params, resolve }));
    },
  });
  return dbg;
}

// A tab entry as the seams see it: its view's webContents (the three hooks), its debugger and its input seam.
async function tabWithSeams(now = () => 0) {
  const webContents = Object.assign(new EventEmitter(), { debugger: fakeDebugger(), isDestroyed: () => false });
  const tabDebugger = new TabDebugger(webContents as never);
  await tabDebugger.attach();
  const entry = { view: { webContents }, debugger: tabDebugger, input: new TabInputSeam() } as unknown as TabEntry;
  attachInputSeams(entry, now);
  const emissions: string[] = [];
  entry.input.on((emission: InputEmission) => emissions.push(`${emission.kind}/${emission.source}`));
  return { entry, webContents, tabDebugger, emissions };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

// Replays one recorded phase in its own time order: each command sent through the TabDebugger (so it enters the
// in-flight table) and replied to, each event raised on its hook. On a tie the send goes first and the reply last.
// Answers each attribution as `kind/source`, or with `typed` as `<the event's type> kind/source`.
async function replay(recorded: Phase, typed = false): Promise<string[]> {
  const tab = await tabWithSeams();
  let raised = '';
  const attributed: string[] = [];
  tab.entry.input.on((emission) => attributed.push(`${typed ? `${raised} ` : ''}${emission.kind}/${emission.source}`));
  type Step = { at: number; rank: number; run(): void | Promise<void> };
  const steps: Step[] = [];
  const replies = new Map<number, () => void>();
  (recorded.commands ?? []).forEach((command, index) => {
    steps.push({
      at: command.sendRel,
      rank: 0,
      run: () => {
        void tab.tabDebugger.send(command.method ?? 'Input.dispatchMouseEvent', { type: command.type });
        // the command waits in the fake until its reply step
        const pending = (tab.webContents.debugger as ReturnType<typeof fakeDebugger>).pending.at(-1)!;
        replies.set(index, () => pending.resolve({}));
      },
    });
    steps.push({
      at: command.replyRel,
      rank: 2,
      run: async () => {
        replies.get(index)!();
        await settle();
      },
    });
  });
  const raise = (hook: string, events: Recorded[] | undefined) => {
    for (const event of events ?? []) {
      steps.push({
        at: event.at,
        rank: 1,
        run: () => {
          raised = event.type;
          tab.webContents.emit(hook, {}, event);
        },
      });
    }
  };
  raise('input-event', recorded.inputEvents);
  raise('before-input-event', recorded.beforeInputEvents);
  raise('before-mouse-event', recorded.beforeMouseEvents);
  steps.sort((a, b) => a.at - b.at || a.rank - b.rank);
  for (const step of steps) await step.run();
  return attributed;
}

describe('classify: the decision table (E4a Design §11; A-33)', () => {
  const none = () => false;
  const pressed = (kind: string) => kind === 'mousePressed';
  const released = (kind: string) => kind === 'mouseReleased';

  it('keys: the first hook\'s keyDown is the human\'s; an input-event keyDown or rawKeyDown with bit 23 the agent\'s; nothing else counts', () => {
    expect(classify('before-input-event', { type: 'keyDown' }, none)).toEqual({ kind: 'key', source: 'human' });
    expect(classify('before-input-event', { type: 'keyUp' }, none)).toBeNull();
    for (const type of ['keyDown', 'rawKeyDown']) expect(classify('input-event', { type, _modifiers: FROM_DEBUGGER }, none)).toEqual({ kind: 'key', source: 'agent' });
    for (const type of ['keyUp', 'char']) expect(classify('input-event', { type, _modifiers: FROM_DEBUGGER | 8 }, none)).toBeNull();
    for (const type of ['keyDown', 'rawKeyDown', 'keyUp', 'char']) expect(classify('input-event', { type, _modifiers: 0 }, none)).toBeNull();
    expect(classify('input-event', { type: 'keyDown' }, none)).toBeNull(); // no raw modifiers at all: not the agent's
  });

  it('wheels: input-event alone, the bit deciding', () => {
    expect(classify('input-event', { type: 'mouseWheel', _modifiers: FROM_DEBUGGER }, none)).toEqual({ kind: 'wheel', source: 'agent' });
    expect(classify('input-event', { type: 'mouseWheel', _modifiers: 0 }, none)).toEqual({ kind: 'wheel', source: 'human' });
    expect(classify('before-mouse-event', { type: 'mouseWheel' }, none)).toBeNull();
    for (const type of ['gestureScrollBegin', 'gestureScrollUpdate', 'gestureScrollEnd']) expect(classify('input-event', { type, _modifiers: FROM_DEBUGGER }, none)).toBeNull();
  });

  it('mouse buttons: before-mouse-event against the in-flight command of the matching type, which it consumes', () => {
    expect(classify('before-mouse-event', { type: 'mouseDown' }, pressed)).toEqual({ kind: 'mouse', source: 'agent', consumes: 'mousePressed' });
    expect(classify('before-mouse-event', { type: 'mouseDown' }, released)).toEqual({ kind: 'mouse', source: 'human' });
    expect(classify('before-mouse-event', { type: 'mouseUp' }, released)).toEqual({ kind: 'mouse', source: 'agent', consumes: 'mouseReleased' });
    expect(classify('before-mouse-event', { type: 'mouseUp' }, pressed)).toEqual({ kind: 'mouse', source: 'human' });
    for (const type of ['mouseMove', 'mouseEnter', 'mouseLeave', 'contextMenu']) expect(classify('before-mouse-event', { type }, pressed)).toBeNull();
    for (const type of ['mouseDown', 'mouseUp', 'mouseMove']) expect(classify('input-event', { type }, pressed)).toBeNull();
  });
});

describe('the input seams over E4-0\'s recordings (findings-pass2.txt:72-170)', () => {
  const phases = run1.input.phases;

  it('a native key on both hooks counts once, as the human\'s', async () => {
    expect(await replay(phase(phases, 'sendInputEvent key d'))).toEqual(['key/human']);
  });

  it('CDP keys carry bit 23 and are the agent\'s, one per key press', async () => {
    expect(await replay(phase(phases, 'playwright keyboard.press a'))).toEqual(['key/agent']);
    expect(await replay(phase(phases, 'playwright keyboard.type bc'))).toEqual(['key/agent', 'key/agent']);
    expect(await replay(phase(phases, 'playwright locator.fill'))).toEqual([]); // Input.insertText raises no input event
  });

  it('a CDP wheel is the agent\'s and a human wheel the human\'s; derived gestures are nothing', async () => {
    expect(await replay(phase(phases, 'playwright mouse.wheel'))).toEqual(['wheel/agent', 'wheel/agent']);
    expect(await replay(phase(phases, 'sendInputEvent mouseWheel'))).toEqual(['wheel/human', 'wheel/human']);
  });

  it('mouse input-events are never attributed (the buttons are the next hook\'s)', async () => {
    for (const label of ['playwright locator.click', 'playwright mouse.click', 'raw CDP', 'sendInputEvent mouse, no global', 'sendInputEvent mouse, globalX']) {
      expect(await replay(phase(phases, label))).toEqual([]);
    }
  });

  // E4-0 classified with a 0.05 ms tolerance on each window over two clocks up to 0.25 ms apart, so where two events of
  // one type fall inside one window, which of them takes the slot can differ from a replay in recorded order; what the
  // rule promises, and what is compared, is how many events of each type go to each side (so exactly one human press in
  // each collision).
  it('mouse buttons go to each side as E4-0 attributed them, in every run-two phase: agent, human, iframe, zoom, both collisions', async () => {
    for (const recorded of run2.input2.phases) {
      const buttons = recorded.attributedEvents.filter((e) => e.type === 'mouseDown' || e.type === 'mouseUp').map((e) => `${e.type} mouse/${e.attributed}`);
      const keys = (recorded.beforeInputEvents ?? []).filter((e) => e.type === 'keyDown').map(() => 'keyDown key/human');
      const emitted = await replay(recorded, true);
      expect({ label: recorded.label, emitted: emitted.sort() }).toEqual({ label: recorded.label, emitted: [...buttons, ...keys].sort() });
    }
  });

  it('a press at the same pixel inside the agent\'s press leaves exactly one human press, so the takeover still fires', async () => {
    const emitted = await replay(phase(run2.input2.phases, 'interleaved: agent click on the top button while the stand-in presses at the same pixel'));
    expect(emitted).toEqual(['mouse/agent', 'mouse/human', 'mouse/human', 'mouse/agent']);
  });

  it('the bit is pinned to the Electron the recordings were made on: an upgrade fails here until E4-0\'s probe is re-run', () => {
    const installed = JSON.parse(readFileSync(fileURLToPath(new URL('../../../node_modules/electron/package.json', import.meta.url)), 'utf8')) as { version: string };
    expect(run1.meta.electron).toBe(installed.version);
    expect(run2.meta.electron).toBe(installed.version);
    expect(FROM_DEBUGGER).toBe(8388608); // WebInputEvent::kFromDebugger, 1 << 23, at Chromium 152.0.7977.130
    const agentKey = phase(run1.input.phases, 'playwright keyboard.press a').inputEvents![0]!;
    expect(agentKey._modifiers! & FROM_DEBUGGER).toBe(FROM_DEBUGGER);
  });
});

describe('TabInputSeam and attachInputSeams', () => {
  it('records when the human, and when anyone, last gave input, and tells its listeners', async () => {
    let clock = 100;
    const tab = await tabWithSeams(() => clock);
    expect(tab.entry.input).toMatchObject({ lastHumanAt: null, lastInputAt: null });
    tab.webContents.emit('input-event', {}, { type: 'keyDown', _modifiers: FROM_DEBUGGER });
    expect(tab.entry.input).toMatchObject({ lastHumanAt: null, lastInputAt: 100 });
    clock = 250;
    tab.webContents.emit('before-mouse-event', {}, { type: 'mouseDown' });
    expect(tab.entry.input).toMatchObject({ lastHumanAt: 250, lastInputAt: 250 });
    tab.webContents.emit('before-mouse-event', {}, { type: 'mouseMove' });
    expect(tab.emissions).toEqual(['key/agent', 'mouse/human']);
  });

  it('a listener can unsubscribe, and a throwing one stops neither the record nor the others', () => {
    const seam = new TabInputSeam();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const heard: string[] = [];
    seam.on(() => {
      throw new Error('listener bug');
    });
    const stop = seam.on((e) => heard.push(e.source));
    seam.emit({ kind: 'key', source: 'human', at: 5 });
    stop();
    seam.emit({ kind: 'key', source: 'agent', at: 6 });
    expect(heard).toEqual(['human']);
    expect(seam).toMatchObject({ lastHumanAt: 5, lastInputAt: 6 });
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it('without a debugger every press is the human\'s; a view no longer the tab\'s records nothing', async () => {
    const tab = await tabWithSeams();
    void tab.tabDebugger.send('Input.dispatchMouseEvent', { type: 'mousePressed' });
    (tab.entry as { debugger: TabDebugger | null }).debugger = null;
    tab.webContents.emit('before-mouse-event', {}, { type: 'mouseDown' });
    expect(tab.emissions).toEqual(['mouse/human']);
    (tab.entry as { view: unknown }).view = null; // suspended or closed
    tab.webContents.emit('before-input-event', {}, { type: 'keyDown' });
    expect(tab.emissions).toEqual(['mouse/human']);
  });
});
