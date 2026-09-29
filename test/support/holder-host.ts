// A stand-in for the two engine-host commands holder authority reads (C10 execution document, Interfaces "Holder
// authority"): C3's `engine.sessions` (the process table, each status carrying its launch spec's `cwd`) and C4's
// `fs.holders` (a fresh registry read, fail-closed). The registry rows are what C4's `HolderRegistry.liveNow` would
// answer for live `sessions/<pid>.json` records; C4's own suites pin that mapping, so the fake answers at the X2 seam,
// filtering exactly as C4 does (a listed session id, or a cwd equal to a listed directory, both as NFC realpaths).
import { realpath } from 'node:fs/promises';
import type { AppSessionId, SessionId } from '../../src/shared/graph/ids';
import type { Holder as SessionHolder } from '../../src/shared/wire/store';
import type { EngineSessionStatus } from '../../src/shared/engine/status';
import type { FsHoldersAnswer, FsHoldersQuery } from '../../src/shared/ipc/schema/fs';
import type { HostDispatch } from '../../src/main/ipc/router';
import { status } from './builders';

type RegistryRow = { sessionId: SessionId; holder: Exclude<SessionHolder, { kind: 'self' | 'none' }>; cwd: string | null; appSessionId?: AppSessionId | null };

async function canonical(path: string): Promise<string> {
  try {
    return (await realpath(path)).normalize('NFC');
  } catch {
    return path.normalize('NFC');
  }
}

export class FakeHolderHost {
  readonly reservations: EngineSessionStatus[] = [];
  readonly registry: RegistryRow[] = [];
  // C4's fail-closed answer: `holder registry unreadable: <code>` as an `internal` failure of `fs.holders`
  registryFailure: string | null = null;
  readonly queries: FsHoldersQuery[] = [];

  // A MAWS process reservation: C3's status for `appSessionId`, launched in `cwd`.
  reserve(appSessionId: string, cwd: string, over: Partial<EngineSessionStatus> = {}): EngineSessionStatus {
    const entry = { ...status(appSessionId), cwd, engineSessionId: null, ...over };
    this.reservations.push(entry);
    return entry;
  }

  // A live registry record (an interactive `claude` or a `--bg` job) for `sessionId`, running in `cwd`.
  hold(sessionId: string, holder: RegistryRow['holder'], cwd: string | null, appSessionId: string | null = null): void {
    this.registry.push({ sessionId: sessionId as SessionId, holder, cwd, appSessionId: appSessionId as AppSessionId | null });
  }

  readonly dispatch: HostDispatch = async (owner, name, input) => {
    if (owner !== 'engine-host') throw new Error(`unexpected owner ${owner}`);
    if (name === 'engine.sessions') return { ok: true, value: this.reservations };
    if (name === 'fs.holders') {
      const query = input as FsHoldersQuery;
      this.queries.push(query);
      if (this.registryFailure !== null) return { ok: false, error: { code: 'internal', message: this.registryFailure } };
      return { ok: true, value: await this.answer(query) };
    }
    throw new Error(`unexpected command ${name}`);
  };

  private async answer(query: FsHoldersQuery): Promise<FsHoldersAnswer> {
    const ids = query.sessionIds === null ? null : new Set<string>(query.sessionIds);
    const directories = query.directories === null ? null : new Set(await Promise.all(query.directories.map(canonical)));
    const holders: FsHoldersAnswer['holders'] = [];
    for (const row of this.registry) {
      const cwd = row.cwd === null ? null : await canonical(row.cwd);
      const matches = (ids === null && directories === null) || ids?.has(row.sessionId) || (cwd !== null && directories?.has(cwd));
      if (matches) holders.push({ sessionId: row.sessionId, appSessionId: row.appSessionId ?? null, holder: row.holder, cwd });
    }
    return { refreshedAt: new Date().toISOString(), holders };
  }
}
