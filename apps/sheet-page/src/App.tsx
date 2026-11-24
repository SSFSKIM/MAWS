// The page (§P; T19, T20, T28): which screen it shows is decided from two facts alone, whether the browser holds a
// credential and what the live connection's opening said of it. No credential: the pairing screen, with no request
// made and no socket opened. A credential: the connection opens, the frame shows at `paired`, and the pairing screen at
// a refusal, which deletes nothing, so the tab comes back by itself once the real `mawsd` answers again. Until the first
// `paired` the ground is blank. Nothing else is asked of the server to find out, since any such request would carry
// the credential before the server had proven itself. The pairing screen keeps the address the browser asked for, and
// that place shows once paired. The page reads its path alone (T20).
import { useEffect, useState } from 'react';
import { createApi } from './api';
import { forgetEverything, readPairing, writePairing, type StoredPairing } from './credential';
import { Frame } from './frame/Frame';
import { connect, type Live } from './live';
import { PairingScreen } from './pairing/PairingScreen';
import { pathOf, placeOf, type Place } from './route';

type Screen = 'waiting' | 'pairing' | 'frame';

const liveUrl = () => `ws://${location.host}/live`;

// The page's one live connection, which every request that carries the credential asks first (api.ts)
const current: { live: Live | null } = { live: null };
const api = createApi({ proven: () => current.live?.proven() ?? false, pairing: readPairing });

export function App() {
  const [place, setPlace] = useState<Place>(() => placeOf(location.pathname));
  const [pairing, setPairing] = useState<StoredPairing | null>(() => readPairing());
  const [screen, setScreen] = useState<Screen>(() => (pairing === null ? 'pairing' : 'waiting'));
  const [notPaired, setNotPaired] = useState(false);

  useEffect(() => {
    const moved = () => setPlace(placeOf(location.pathname));
    addEventListener('popstate', moved);
    return () => removeEventListener('popstate', moved);
  }, []);

  useEffect(() => {
    if (pairing === null) return;
    const connection = connect({
      url: liveUrl(),
      pairing: readPairing, // read as each socket opens: what is stored now
      onPaired: () => {
        setNotPaired(false);
        setScreen('frame');
      },
      onState: (state) => {
        if (state !== 'unpaired') return;
        setNotPaired(true);
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

  // The person's own Unpair: told to mawsd only over a proven connection, then forgotten here whatever the answer (§P)
  const unpair = async () => {
    await api.unpair();
    current.live?.close();
    forgetEverything();
    setPairing(null);
    setNotPaired(true);
    setScreen('pairing');
  };

  if (screen === 'pairing')
    return (
      <PairingScreen
        notPaired={notPaired}
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
