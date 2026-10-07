// E11 (tracker row E10 "14 will-quit listeners"): main's will-quit steps as one ordered list behind one listener, so a
// launch no longer trips Node's MaxListenersExceededWarning (which would also hide a real leak) and the order the
// services stop in is written down in one place: the order `add` was called in, which is the order the services start
// in `index.ts`. A step that throws is logged by name and the next one still runs; at will-quit nothing asynchronous
// finishes, so every step is synchronous.

export interface ShutdownSteps {
  add(name: string, step: () => void): void;
}

export function shutdownSteps(app: { on(event: 'will-quit', listener: () => void): unknown }): ShutdownSteps {
  const steps: { name: string; step: () => void }[] = [];
  app.on('will-quit', () => {
    for (const { name, step } of steps) {
      try {
        step();
      } catch (error) {
        console.error(`[shutdown] ${name} failed; going on`, error);
      }
    }
  });
  return { add: (name, step) => void steps.push({ name, step }) };
}
