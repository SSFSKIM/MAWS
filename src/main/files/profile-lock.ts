import type { App } from 'electron';

// Call after setting userData, before opening stores or starting hosts. Electron's ProcessSingleton uses that
// directory, so separate scratch profiles can run together. Never release it while the app is alive.
export function startWithProfileLock(app: Pick<App, 'requestSingleInstanceLock' | 'hasSingleInstanceLock' | 'whenReady' | 'quit'>, start: () => void): Promise<void> {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return Promise.resolve();
  }
  return app.whenReady().then(() => {
    if (!app.hasSingleInstanceLock()) {
      app.quit();
      return;
    }
    start();
  });
}
