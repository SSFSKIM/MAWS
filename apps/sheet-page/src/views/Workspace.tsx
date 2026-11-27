// What the page draws in its frame once paired (§P): the overview at `/`, a session's sheet at `/s/<session>`. It
// reads the store, says the session's title and whether it is stopped to the bar, writes the browser tab's title (F8),
// and sweeps the memory's old entries once when it first loads (T19).
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Api } from '../api';
import { pageSheetHost } from '../host';
import type { Connection } from '../live';
import { sweepMemory } from '../memory';
import type { Outline } from '../outline/state';
import type { Place } from '../route';
import type { SheetStore } from '../store';
import { titleNameOf, titleOf } from '../summaries';
import { Overview } from './Overview';
import { SheetView } from './SheetView';

export interface WorkspaceProps {
  place: Place;
  store: SheetStore;
  api: Api;
  connection: Connection;
  outline: Outline;
  navigate(place: Place): void;
  setBar(bar: { title: string | null; stopped: boolean }): void;
}

export default function Workspace({ place, store, api, connection, outline, navigate, setBar }: WorkspaceProps) {
  const state = useSyncExternalStore(store.subscribe, store.state);
  const host = useMemo(() => pageSheetHost({ api }), [api]);
  useEffect(() => sweepMemory(Date.now()), []);

  const session = place.at === 'sheet' ? place.session : null;
  const summary = session === null ? undefined : state.sessions?.find((entry) => entry.session === session);
  const title = summary ? titleNameOf(summary) : null;
  const stopped = summary?.live === false;
  useEffect(() => setBar({ title, stopped }), [setBar, title, stopped]);
  const tab = titleOf(place, state.sessions);
  useEffect(() => {
    document.title = tab;
  }, [tab]);

  if (place.at === 'overview') return <Overview sessions={state.sessions} open={(next) => navigate({ at: 'sheet', session: next })} />;
  if (state.shown === null || state.shown.session !== place.session) return null;
  return <SheetView shown={state.shown} door={state.door} connection={connection} host={host} outline={outline} navigate={navigate} />;
}
