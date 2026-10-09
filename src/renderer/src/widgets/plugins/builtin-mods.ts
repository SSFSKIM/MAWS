// MAWS's built-in mods as a session's plugin library reads them (X20; the P2-C document, §9; the P2-B execution document
// §5.12; the interface ledger §1 `mods.list` and §6's dated line of 2026-10-09). P2-B owns this hook's name and P2-C its
// body. `mods.list` with the session, read again when the app's switch moves (`settings.changed`), when the session's owner
// channel changes (its override, or a launch that applied it), and after this surface's own write. Main answers
// `internal` when it cannot (the index unavailable), which reads as `unavailable` with main's words: that is the
// registry's own state, not an engine read's (a session with no ready process still has its mods). Writes: the app's
// switch is `settings.set` on `mods.toHuman.enabled`, a session's override `mods.setSessionOverride`; a refused write is
// kept in main's words for the section to say, and the rows read again show what holds.
import { useCallback, useEffect, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { ModId, ModRow } from '@shared/mods/registry';
import type { LaneOverride } from '@shared/owner/state';
import { ipc } from '../../ipc/client';

export type ModRowsRead = { state: 'loading' } | { state: 'ready'; rows: ModRow[] } | { state: 'unavailable'; reason: string };

export interface BuiltInModsState {
  read: ModRowsRead;
  failure: string | null; // why this surface's last write was refused (main's words); cleared by the next write
  setEnabled(id: ModId, enabled: boolean): Promise<void>; // the app's switch
  setOverride(id: ModId, value: LaneOverride): Promise<void>; // this session's
}

export function useBuiltInMods(appSessionId: AppSessionId, client: MawsBridge = ipc): BuiltInModsState {
  const [read, setRead] = useState<ModRowsRead>({ state: 'loading' });
  const [asked, setAsked] = useState(0); // bumped to read again
  const [failure, setFailure] = useState<string | null>(null);
  const again = useCallback(() => setAsked((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    void client.invoke('mods.list', { appSessionId }).then((result) => {
      if (!live) return;
      setRead(result.ok ? { state: 'ready', rows: result.value } : { state: 'unavailable', reason: result.error.message });
    });
    return () => {
      live = false;
    };
  }, [appSessionId, asked, client]);

  useEffect(() => {
    const offs = [
      client.on('settings.changed', again),
      client.on('ownerChannel.changed', (event) => event.appSessionId === appSessionId && again()),
    ];
    return () => offs.forEach((off) => off());
  }, [appSessionId, again, client]);

  const setEnabled = useCallback(
    async (id: ModId, enabled: boolean) => {
      void id; // one mod today: the to-human lane's switch
      setFailure(null);
      const result = await client.invoke('settings.set', { mods: { toHuman: { enabled } } });
      if (!result.ok) setFailure(result.error.message);
      again();
    },
    [again, client],
  );
  const setOverride = useCallback(
    async (id: ModId, value: LaneOverride) => {
      setFailure(null);
      const result = await client.invoke('mods.setSessionOverride', { appSessionId, id, value });
      if (!result.ok) setFailure(result.error.message);
      again();
    },
    [again, appSessionId, client],
  );
  return { read, failure, setEnabled, setOverride };
}
