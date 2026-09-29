// The `sessionId ↔ appSessionId` pairs main's index allocated (C4 execution document, Terms "Binding"): the host
// discovers sessions by their engine id and stamps the app id on every renderer-facing payload once main has bound it
// (`fs.scan { known }` at startup, `fs.bind` afterwards). One pair per id on either side.
import type { AppSessionId, SessionId } from '@shared/graph/ids';

export class Bindings {
  private readonly bySession = new Map<SessionId, AppSessionId>();
  private readonly byApp = new Map<AppSessionId, SessionId>();

  bind(sessionId: SessionId, appSessionId: AppSessionId): void {
    const previousApp = this.bySession.get(sessionId);
    if (previousApp !== undefined) this.byApp.delete(previousApp);
    const previousSession = this.byApp.get(appSessionId);
    if (previousSession !== undefined) this.bySession.delete(previousSession);
    this.bySession.set(sessionId, appSessionId);
    this.byApp.set(appSessionId, sessionId);
  }

  // `fs.unbind` (C10's ask, M4): drops the app id's pair and answers the engine id it was paired with; null when unbound.
  unbind(appSessionId: AppSessionId): SessionId | null {
    const sessionId = this.byApp.get(appSessionId);
    if (sessionId === undefined) return null;
    this.byApp.delete(appSessionId);
    this.bySession.delete(sessionId);
    return sessionId;
  }

  appIdOf(sessionId: SessionId): AppSessionId | null {
    return this.bySession.get(sessionId) ?? null;
  }

  sessionIdOf(appSessionId: AppSessionId): SessionId | null {
    return this.byApp.get(appSessionId) ?? null;
  }

  get size(): number {
    return this.bySession.size;
  }
}
