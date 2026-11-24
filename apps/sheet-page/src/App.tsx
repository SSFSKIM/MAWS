// The page (§P; T19, T20, T28): which screen it shows is decided from two facts alone, whether the browser holds a
// credential and what the live connection's opening said of it. No credential: the pairing screen, with no request
// made and no socket opened. A credential: the connection opens, the frame shows at `paired`, and the pairing screen at
// a refusal, which deletes nothing, so the tab comes back by itself once the real `mawsd` answers again. Until the first
// `paired` the ground is blank. Nothing else is asked of the server to find out, since any such request would carry
// the credential before the server had proven itself. The pairing screen keeps the address the browser asked for, and
// that place shows once paired. The page reads its path alone (T20).
import { useEffect, useState } from 'react';
import { createApi } from './api';
import { CREDENTIAL_KEY, forgetEverything, readPairing, writePairing, type StoredPairing } from './credential';
import { Frame } from './frame/Frame';
import { connect, type Live } from './live';
import { PairingScreen } from './pairing/PairingScreen';
import { pathOf, placeOf, type Place } from './route';
import { unpairThisBrowser, type Unpaired } from './unpair';

type Screen = 'waiting' | 'pairing' | 'frame';

const liveUrl = () => `ws://${location.host}/live`;

// The page's one live connection, which every request that carries the credential asks first (api.ts)
const current: { live: Live | null } = { live: null };
const api = createApi({ proven: () => current.live?.proven() ?? null });

export function App() {
  const [place, setPlace] = useState<Place>(() => placeOf(location.pathname));
  const [pairing, setPairing] = useState<StoredPairing | null>(() => readPairing());
  const [screen, setScreen] = useState<Screen>(() => (pairing === null ? 'pairing' : 'waiting'));
  const [unpaired, setUnpaired] = useState<Unpaired | null>(null);

  useEffect(() => {
    const moved = () => setPlace(placeOf(location.pathname));
    addEventListener('popstate', moved);
    return () => removeEventListener('popstate', moved);
  }, []);

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
    if (pairing === null) return;
    const connection = connect({
      url: liveUrl(),
      pairing: readPairing, // read as each socket opens: what is stored now
      onPaired: () => {
        setUnpaired(null);
        setScreen('frame');
      },
      onState: (state) => {
        if (state !== 'unpaired') return;
        setUnpaired('refused');
        setScreen('pairing');
      },
    });
    current.live = connection;
    return () => {
      connection.close();
      if (current.live === connection) current.live = null;
    };
  }, [pairing]);

  const navigate = (next: Place) => {
    history.pushState(null, '', pathOf(next));
    setPlace(next);
  };

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
  if (screen === 'waiting') return null;
  return <Frame place={place} navigate={navigate} unpair={() => void unpair()} />;
}
