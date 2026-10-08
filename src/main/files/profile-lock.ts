import { launchedBuildOf, type MainBuild } from '../build-identity';

// The part of Electron's `app` the lock uses (a structural type, so a test stands in for it).
export interface LockingApp {
  requestSingleInstanceLock(additionalData?: Record<string, unknown>): boolean;
  hasSingleInstanceLock(): boolean;
  whenReady(): Promise<void>;
  quit(): void;
  on(event: 'second-instance', listener: (event: unknown, argv: string[], workingDirectory: string, additionalData: unknown) => void): unknown;
}

// What a second launch says to the running instance (E11 §2.7): its build rides on the lock request, and the running
// instance hears of every second launch with that build (null from a build that passes none), to focus itself and say
// when it is the older build, where before the second launch exited with no word.
export interface SecondInstanceHandoff {
  build: MainBuild;
  onSecondInstance(launched: MainBuild | null): void;
}

// Call after setting userData, before opening stores or starting hosts. Electron's ProcessSingleton uses that
// directory, so separate scratch profiles can run together. Never release it while the app is alive.
export function startWithProfileLock(app: LockingApp, start: () => void, handoff: SecondInstanceHandoff): Promise<void> {
  if (!app.requestSingleInstanceLock({ build: handoff.build })) {
    app.quit();
    return Promise.resolve();
  }
  app.on('second-instance', (_event, _argv, _cwd, additionalData) => handoff.onSecondInstance(launchedBuildOf(additionalData)));
  return app.whenReady().then(() => {
    if (!app.hasSingleInstanceLock()) {
      app.quit();
      return;
    }
    start();
  });
}
