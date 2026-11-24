// The page (§P; T15, T19, T20, T28): which screen it shows is decided from two facts alone, whether the browser holds a
// credential and what the live connection's opening said of it. No credential: the pairing screen, with no request
// made and no socket opened. A credential: the connection opens, the frame shows at `paired`, and the pairing screen at
// a refusal, which deletes nothing, so the tab comes back by itself once the real `mawsd` answers again. Until the first
// `paired` the ground is blank, and after a second without a connection the frame stands with its band. Nothing else is
// asked of the server to find out, since any such request would carry the credential before the server had proven
// itself. The pairing screen keeps the address the browser asked for, and that place shows once paired. The page reads
// its path alone (T20).
//
// Once paired, the connection's snapshots and changes feed the store (store.ts), which reads the model of the session
// on screen; what the frame holds is the workspace, loaded apart (views/Workspace.tsx, below). The band under the bar says
// when the page is not connected, once a second has passed (availability.ts). A tab hidden for five minutes lets its
// connection go and opens it again when it is shown (T15), so a forgotten tab costs nothing.
import { useCallback, useEffect, useState, type ComponentType } from 'react';
import { createApi } from './api';
import { BAND_AFTER_MS, bandOf } from './availability';
import { PAGE } from './copy';
import { CREDENTIAL_KEY, forgetEverything, readPairing, writePairing, type StoredPairing } from './credential';
import { Frame } from './frame/Frame';
import { connect, type Connection, type Live } from './live';
import { useOutline } from './outline/state';
import { PairingScreen } from './pairing/PairingScreen';
import { pathOf, placeOf, type Place } from './route';
import { createStore } from './store';
import { unpairThisBrowser, type Unpaired } from './unpair';
import type { WorkspaceProps } from './views/Workspace';

// The workspace's code is loaded apart, so the pairing screen carries none of the Markdown stack. It is asked for with
// the page's own load where a pairing is stored, and otherwise at `paired`; a load that failed (mawsd went away while
// it was out) is asked for again at the next `paired` and at no other time, so an open tab loads code only from a
// server it has just proven, never from whatever holds the port meanwhile (T28).
type WorkspaceView = ComponentType<WorkspaceProps>;
let workspaceLoad: Promise<WorkspaceView> | null = null;
function loadWorkspace(): Promise<WorkspaceView> {
  workspaceLoad ??= import('./views/Workspace').then(
    (module) => module.default,
    (error: unknown) => {
      workspaceLoad = null;
      throw error;
    },
  );
  return workspaceLoad;
}
if (readPairing() !== null) void loadWorkspace().catch(() => {});

type Screen = 'waiting' | 'pairing' | 'frame';

export const HIDDEN_MS = 5 * 60_000; // a tab hidden this long lets its connection go (T15)

const liveUrl = () => `ws://${location.host}/live`;

// The page's one live connection, which every request that carries the credential asks first (api.ts)
const current: { live: Live | null; leaving: boolean } = { live: null, leaving: false };
addEventListener('pagehide', () => void (current.leaving = true));
addEventListener('pageshow', () => void (current.leaving = false));
const api = createApi({ proven: () => current.live?.proven() ?? null, leaving: () => current.leaving });
const store = createStore({ read: api.read });

// Whether the tab may hold its connection: not once it has been hidden for five minutes
function useAwake(): boolean {
  const [awake, setAwake] = useState(true);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const seen = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (document.visibilityState === 'hidden') timer = setTimeout(() => setAwake(false), HIDDEN_MS);
      else setAwake(true);
    };
    seen();
    document.addEventListener('visibilitychange', seen);
    return () => {
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener('visibilitychange', seen);
    };
  }, []);
  return awake;
}

// The band's sentence, which speaks only once a second has passed in a state that is not connected
function useBand(connection: { state: Connection; since: number }): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (connection.state === 'connected' || connection.state === 'unpaired') return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, connection.since + BAND_AFTER_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [connection]);
  return bandOf(connection.state, connection.since, now);
}

export function App() {
  const [place, setPlace] = useState<Place>(() => placeOf(location.pathname));
  const [pairing, setPairing] = useState<StoredPairing | null>(() => readPairing());
  const [screen, setScreen] = useState<Screen>(() => (pairing === null ? 'pairing' : 'waiting'));
  const [unpaired, setUnpaired] = useState<Unpaired | null>(null);
  const [connection, setConnection] = useState<{ state: Connection; since: number }>(() => ({ state: 'connecting', since: Date.now() }));
  const [bar, setBar] = useState<{ title: string | null; stopped: boolean }>({ title: null, stopped: false });
  const [Workspace, setWorkspace] = useState<WorkspaceView | null>(null);
  const awake = useAwake();
  const outline = useOutline();
  const band = useBand(connection);

  useEffect(() => {
    const moved = () => setPlace(placeOf(location.pathname));
    addEventListener('popstate', moved);
    return () => removeEventListener('popstate', moved);
  }, []);
  useEffect(() => {
    store.show(place.at === 'sheet' ? place.session : null);
  }, [place]);
  useEffect(() => {
    if (screen !== 'frame') document.title = PAGE.name;
  }, [screen]);

  // Another tab of this browser paired anew or unpaired: this one follows what is stored (the connection it holds proves
  // only the pairing it opened with, live.ts), and a pairing no longer stored shows the pairing screen
  useEffect(() => {
    const stored = (event: StorageEvent) => {
      if (event.key !== CREDENTIAL_KEY && event.key !== null) return;
      const now = readPairing();
      setPairing(now);
      if (now !== null) return;
      setUnpaired('refused'); // the plain line: what became of it is the other tab's to say
      setScreen('pairing');
    };
    addEventListener('storage', stored);
    return () => removeEventListener('storage', stored);
  }, []);

  useEffect(() => {
    if (pairing === null || !awake) return;
    const live = connect({
      url: liveUrl(),
      pairing: readPairing, // read as each socket opens: what is stored now
      onPaired: () => {
        setUnpaired(null);
        setScreen('frame');
        loadWorkspace().then(
          (view) => setWorkspace(() => view),
          () => {}, // asked again at the next paired
        );
      },
      onReady: (sessions, door) => store.ready(sessions, door),
      onChanged: (session, summary) => store.changed(session, summary),
      onState: (state) => {
        setConnection({ state, since: Date.now() });
        if (state !== 'unpaired') return;
        setUnpaired('refused');
        setScreen('pairing');
      },
    });
    current.live = live;
    return () => {
      live.close();
      if (current.live === live) current.live = null;
      setConnection({ state: 'connecting', since: Date.now() }); // the next connection, or none while the tab sleeps
    };
  }, [pairing, awake]);

  const navigate = useCallback((next: Place) => {
    history.pushState(null, '', pathOf(next));
    setPlace(next);
  }, []);

  // The person's own Unpair (unpair.ts): told to mawsd only over a proven connection, forgotten here whatever the answer,
  // and the pairing screen says which of the three it was
  const unpair = async () => {
    const outcome = await unpairThisBrowser({ unpair: api.unpair, close: () => current.live?.close(), forget: forgetEverything });
    setPairing(null);
    setUnpaired(outcome);
    setScreen('pairing');
  };

  if (screen === 'pairing')
    return (
      <PairingScreen
        unpaired={unpaired}
        pair={api.pair}
        onPaired={(paired) => {
          writePairing(paired);
          setPairing(paired); // a new connection opens with it; the frame shows at its `paired`
        }}
      />
    );
  if (screen === 'waiting' && band === null) return null;
  const onSheet = place.at === 'sheet';
  return (
    <Frame
      place={place}
      title={onSheet ? bar.title : null}
      stopped={onSheet && bar.stopped}
      outline={{ open: outline.open, toggle: outline.toggle }}
      band={band}
      navigate={navigate}
      unpair={() => void unpair()}
    >
      {screen === 'frame' && Workspace !== null && <Workspace place={place} store={store} api={api} connection={connection.state} outline={outline} navigate={navigate} setBar={setBar} />}
    </Frame>
  );
}
