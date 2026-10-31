// P5 O4 M2 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, Interfaces §F, D8, D28): the app's report of each
// page's window to the connectors, which run with the spine. P3-H H4's window cases (the owner window's native
// visibility, read by main) moved here from the connector service's suite: the reporter reads the Electron window
// through `electronWindowShown` over a fake one, and what the machine is told is the evidence.
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { endableClientRef, type ClientRef, type EndableClientRef } from '@shared/ipc/client';
import type { CommandName } from '@shared/ipc/schema';
import { electronWindowShown } from '../client/window-shown';
import type { BeforeHook } from '../ipc/router';
import { LEASE_COMMANDS, startWindowReporter, WINDOW_RECHECK_MS, type WindowReporter } from './windows';

const ART = '11111111-1111-4111-8111-111111111111';

// An owner window as main reads it (shown, minimized) and the events it emits. `hide()` and the rest change the state
// and emit, as Electron's window does when its state changes; a test sets the fields alone for a change no event
// announced (on macOS the window's show and hide events follow its occlusion, not the calls).
class FakeWindow extends EventEmitter {
  visible = true;
  minimized = false;
  destroyed = false;
  isVisible = () => this.visible;
  isMinimized = () => this.minimized;
  isDestroyed = () => this.destroyed;
  hide(): void {
    this.visible = false;
    this.emit('hide');
  }
  show(): void {
    this.visible = true;
    this.emit('show');
  }
  minimize(): void {
    this.minimized = true;
    this.emit('minimize');
  }
  restore(): void {
    this.minimized = false;
    this.emit('restore');
  }
  listeners_(): number {
    return ['show', 'hide', 'minimize', 'restore'].reduce((sum, name) => sum + this.listenerCount(name), 0);
  }
}

let windows: Map<string, FakeWindow>; // by the page's client id: the window that shows it
let reports: [string, boolean][]; // what the machine was told, in order
let answers: ((client: ClientRef, shown: boolean) => Promise<boolean>) | null; // a test's own answer to a report
let hook: BeforeHook | null;
let hookedNames: readonly CommandName[];
let logged: string[];
let reporter: WindowReporter;
let me: EndableClientRef;

beforeEach(() => {
  vi.useFakeTimers();
  windows = new Map();
  reports = [];
  answers = null;
  hook = null;
  logged = [];
  me = endableClientRef('page:7.1');
  windows.set(me.id, new FakeWindow());
  reporter = startWindowReporter({
    windowShown: (client) => {
      const win = windows.get(client.id);
      return win ? electronWindowShown(win as never) : null;
    },
    report: (client, shown) => {
      reports.push([client.id, shown]);
      return answers ? answers(client, shown) : Promise.resolve(true);
    },
    before: (names, given) => {
      hookedNames = names;
      hook = given;
      return () => {
        hook = null;
      };
    },
    log: (line) => void logged.push(line),
  });
});
afterEach(() => {
  reporter.stop();
  vi.useRealTimers();
});

const win = () => windows.get(me.id)!;
// A page's lease command reaching the router's seam: it continues (undefined) once the hook let it go.
const lease = (client: ClientRef = me, name: CommandName = 'connectors.open') => hook!(name, { artifactId: ART }, client);
const settle = async () => {
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
};

describe('the window reporter', () => {
  it('stands before exactly a page’s lease commands, and lets each continue', async () => {
    expect([...hookedNames].sort()).toEqual(['connectors.call', 'connectors.close', 'connectors.declare', 'connectors.open', 'connectors.refresh', 'connectors.unwatch', 'connectors.visibility', 'connectors.watch']);
    expect(hookedNames).toEqual(LEASE_COMMANDS);
    for (const name of LEASE_COMMANDS) await expect(lease(me, name)).resolves.toBeUndefined();
  });

  it('holds a page’s first lease command until its window’s first report, made under the page’s own client, has landed', async () => {
    let land!: (ok: boolean) => void;
    answers = () => new Promise((resolve) => (land = resolve));
    let went = false;
    const going = lease().then(() => (went = true));
    await settle();
    expect(reports).toEqual([[me.id, true]]);
    expect(went).toBe(false);
    land(true);
    await going;
    answers = null;
    await lease(me, 'connectors.call');
    expect(reports).toEqual([[me.id, true]]); // reported once: later commands go at once
  });

  it('reports a window hidden when first followed as hidden, and its show as it happens', async () => {
    win().visible = false;
    await lease();
    expect(reports).toEqual([[me.id, false]]);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(reports).toEqual([[me.id, false]]);
    win().show();
    await settle();
    expect(reports).toEqual([[me.id, false], [me.id, true]]);
  });

  for (const [away, back] of [['hide', 'show'], ['minimize', 'restore']] as const) {
    it(`reports ${away} and ${back} as they happen, once each`, async () => {
      await lease();
      win()[away]();
      await settle();
      win()[back]();
      await settle();
      expect(reports).toEqual([[me.id, true], [me.id, false], [me.id, true]]);
    });
  }

  it('reads the window rather than trusting an event: a hide event while it is still shown reports nothing', async () => {
    await lease();
    win().emit('hide'); // macOS emits show and hide on occlusion changes; the window itself is still shown
    await vi.advanceTimersByTimeAsync(30_000);
    expect(reports).toEqual([[me.id, true]]);
  });

  it('reports a hide and a show no event announced within its re-read, shown or hidden', async () => {
    await lease();
    win().visible = false; // hidden, silently (the re-read now runs while shown too: P5 O4 D8)
    await vi.advanceTimersByTimeAsync(WINDOW_RECHECK_MS);
    expect(reports).toEqual([[me.id, true], [me.id, false]]);
    win().visible = true; // shown, silently
    await vi.advanceTimersByTimeAsync(WINDOW_RECHECK_MS);
    expect(reports).toEqual([[me.id, true], [me.id, false], [me.id, true]]);
    await vi.advanceTimersByTimeAsync(10 * WINDOW_RECHECK_MS);
    expect(reports).toHaveLength(3); // a re-read that finds no change reports nothing
    expect(vi.getTimerCount()).toBe(1); // the one re-read
  });

  it('keeps its reports in order: a change made while the first report is in flight follows it', async () => {
    let land!: (ok: boolean) => void;
    answers = () => new Promise((resolve) => (land = resolve));
    const going = lease();
    await settle();
    win().hide();
    await settle();
    expect(reports).toEqual([[me.id, true]]); // the hide waits for the report before it
    land(true);
    answers = null;
    await going;
    await settle();
    expect(reports).toEqual([[me.id, true], [me.id, false]]);
  });

  it('fails closed when no window shows the page: reports it hidden, says so, and follows nothing', async () => {
    windows.delete(me.id);
    await lease();
    expect(reports).toEqual([[me.id, false]]);
    expect(vi.getTimerCount()).toBe(0);
    expect(logged).toEqual([expect.stringContaining('no window shows client page:7.1')]);
  });

  it('when the page ends, lets go of its window and its re-reads; a reloaded page is followed afresh, once', async () => {
    await lease();
    expect(win().listeners_()).toBe(4);
    expect(vi.getTimerCount()).toBe(1);
    me.end();
    expect(win().listeners_()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    win().hide();
    await settle();
    expect(reports).toEqual([[me.id, true]]);
    const reloaded = endableClientRef('page:7.2');
    windows.set(reloaded.id, win());
    await lease(reloaded);
    await lease(reloaded, 'connectors.declare');
    expect(win().listeners_()).toBe(4);
    expect(reports).toEqual([[me.id, true], [reloaded.id, false]]);
  });

  it('follows nothing for a page that has already ended', async () => {
    me.end();
    await expect(lease()).resolves.toBeUndefined();
    expect(reports).toEqual([]);
    expect(win().listeners_()).toBe(0);
  });

  it('at stop, lets go of every window and its re-reads, and follows none after', async () => {
    const them = endableClientRef('page:8.1');
    windows.set(them.id, new FakeWindow());
    await lease(me);
    await lease(them);
    windows.get(them.id)!.hide();
    reporter.stop();
    expect([win().listeners_(), windows.get(them.id)!.listeners_(), vi.getTimerCount()]).toEqual([0, 0, 0]);
    expect(hook).toBeNull();
    reports = [];
  });

  // D28: a restarted mawsd holds no report; the rebuilt lease's first command reports the window again before it goes
  it('after reportAgain, a page’s next lease command reports its window again before it goes, once', async () => {
    await lease();
    win().visible = false; // silently: the next report must read the window now
    reporter.reportAgain();
    let land!: (ok: boolean) => void;
    answers = () => new Promise((resolve) => (land = resolve));
    let went = false;
    const going = lease().then(() => (went = true));
    await settle();
    expect(reports).toEqual([[me.id, true], [me.id, false]]);
    expect(went).toBe(false);
    land(true);
    await going;
    answers = null;
    await lease(me, 'connectors.declare');
    await vi.advanceTimersByTimeAsync(WINDOW_RECHECK_MS);
    expect(reports).toEqual([[me.id, true], [me.id, false]]);
  });

  it('does not count a report that landed under the connection before reportAgain', async () => {
    let land!: (ok: boolean) => void;
    answers = () => new Promise((resolve) => (land = resolve));
    const first = lease();
    await settle();
    reporter.reportAgain(); // the machine restarted while the first report was in flight
    const second = lease(me, 'connectors.declare');
    await settle();
    land(true); // the first report's answer
    await settle();
    expect(reports).toEqual([[me.id, true], [me.id, true]]); // made again for the new connection, which both commands wait for
    land(true);
    await Promise.all([first, second]);
    expect(reports).toHaveLength(2);
  });

  it('makes a report that did not land again at the page’s next lease command, and lets the command go regardless', async () => {
    answers = async () => false;
    await expect(lease()).resolves.toBeUndefined(); // the machine holds no report: the page reads hidden there
    expect(reports).toHaveLength(2); // asked once more before letting it go
    await lease(me, 'connectors.declare');
    expect(reports).toHaveLength(4);
    answers = null;
    await lease(me, 'connectors.call');
    expect(reports).toHaveLength(5);
    expect(logged).toEqual([expect.stringContaining('was not taken')]); // said once until a report lands
  });
});
