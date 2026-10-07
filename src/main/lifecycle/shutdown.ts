// E11 (tracker row E10 "14 will-quit listeners"): main's will-quit steps as one ordered list behind one listener, so a
// launch no longer trips Node's MaxListenersExceededWarning (which would also hide a real leak) and the order the
// services stop in is written down in one place: the order `add` was called in, which is the order the services start
// in `index.ts`. A step that throws is logged by name and the next one still runs.
// E11 (E10 keep-quit drain, W-A row 128 follow-up): a step may answer a promise, as the hosts' stop does while a
// detached engine host's socket drains the supervisor's last lines. Every step still runs at once, in order; then, if
// any answered a promise, the quit is held (will-quit prevented) until each has settled or `boundMs` has passed, and
// ends with `app.exit(0)`, which runs Electron's own shutdown without emitting will-quit again. A will-quit that comes
// meanwhile is held too and runs nothing twice.

export interface ShutdownApp {
  on(event: 'will-quit', listener: (event: { preventDefault(): void }) => void): unknown;
  exit(code?: number): void;
}

export interface ShutdownSteps {
  add(name: string, step: () => void | Promise<void>): void;
}

export function shutdownSteps(app: ShutdownApp, boundMs: number): ShutdownSteps {
  const steps: { name: string; step: () => void | Promise<void> }[] = [];
  const failed = (name: string) => (error: unknown) => console.error(`[shutdown] ${name} failed; going on`, error);
  let holding = false;
  app.on('will-quit', (event) => {
    if (holding) return event.preventDefault();
    const waits: Promise<void>[] = [];
    for (const { name, step } of steps) {
      try {
        const answer = step();
        if (answer) waits.push(answer.catch(failed(name)));
      } catch (error) {
        failed(name)(error);
      }
    }
    if (waits.length === 0) return;
    holding = true;
    event.preventDefault();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bound = new Promise<void>((resolve) => (timer = setTimeout(resolve, boundMs)));
    void Promise.race([Promise.all(waits), bound]).then(() => {
      clearTimeout(timer);
      app.exit(0);
    });
  });
  return { add: (name, step) => void steps.push({ name, step }) };
}
