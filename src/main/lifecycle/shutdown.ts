// E11 (tracker row E10 "14 will-quit listeners"): main's will-quit steps as one ordered list behind one listener, so a
// launch no longer trips Node's MaxListenersExceededWarning (which would also hide a real leak) and the order the
// services stop in is written down in one place: the order `add` was called in, which is the order the services start
// in `index.ts`. A step that throws is logged by name and the next one still runs.
// E11 (E10 keep-quit drain, W-A row 128 follow-up): a step may answer a promise, as the hosts' stop does while a
// detached engine host's socket drains the supervisor's last lines. If any step answered a promise, the quit is held
// (will-quit prevented) until each has settled or `boundMs` has passed, and ends with `app.exit(0)`, which runs
// Electron's own shutdown without emitting will-quit again. A will-quit that comes meanwhile is held too and runs
// nothing twice.
// P4 W2-B (tracker 2026-10-07 "The keep-quit drain…"): a drain (`drain`, the hosts' stop) runs before every step, and the
// steps run only once each drain has settled or the bound has passed, so the lines a draining close still reads reach
// the services that fold them (the index, side threads, attention) before they stop. The bound counts from the quit, for
// the drain and for any step's promise after it together. A drain that answers no promise holds nothing: the steps then
// run at once, in the same will-quit, as before.
// W-B review M6: `quitting()` reads true from the moment the steps begin, so what may open a window (the dock's
// activate) does not, during the hold, over services already stopped.

export interface ShutdownApp {
  on(event: 'will-quit', listener: (event: { preventDefault(): void }) => void): unknown;
  exit(code?: number): void;
}

export interface ShutdownSteps {
  add(name: string, step: () => void | Promise<void>): void;
  drain(name: string, step: () => void | Promise<void>): void; // P4 W2-B: runs before every step `add` lists
  quitting(): boolean;
}

interface Step {
  name: string;
  step: () => void | Promise<void>;
}

export function shutdownSteps(app: ShutdownApp, boundMs: number): ShutdownSteps {
  const drains: Step[] = [];
  const steps: Step[] = [];
  const failed = (name: string) => (error: unknown) => console.error(`[shutdown] ${name} failed; going on`, error);
  // runs each step in order and answers the promises of those that answered one
  const run = (list: Step[]): Promise<void>[] => {
    const waits: Promise<void>[] = [];
    for (const { name, step } of list) {
      try {
        // only a thenable holds: a step written as an expression body may answer any value its call returns (M7)
        const answer: unknown = step();
        if (typeof (answer as PromiseLike<void> | null)?.then === 'function') waits.push(Promise.resolve(answer as PromiseLike<void>).catch(failed(name)));
      } catch (error) {
        failed(name)(error);
      }
    }
    return waits;
  };
  let holding = false;
  let quitting = false;
  app.on('will-quit', (event) => {
    if (holding) return event.preventDefault();
    quitting = true;
    const draining = run(drains);
    const waits = draining.length === 0 ? run(steps) : [];
    if (draining.length === 0 && waits.length === 0) return;
    holding = true;
    event.preventDefault();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bound = new Promise<void>((resolve) => (timer = setTimeout(resolve, boundMs)));
    void (async () => {
      if (draining.length > 0) {
        await Promise.race([Promise.all(draining), bound]);
        waits.push(...run(steps));
      }
      await Promise.race([Promise.all(waits), bound]);
      clearTimeout(timer);
      app.exit(0);
    })();
  });
  return {
    add: (name, step) => void steps.push({ name, step }),
    drain: (name, step) => void drains.push({ name, step }),
    quitting: () => quitting,
  };
}
