// The live connection's client (§L's opening, §P; T28): the tab proves the server before it sends its credential
// anywhere. Each socket opens with the browser's id and a fresh nonce; the server answers a MAC only the `mawsd` this
// browser was paired with can make; the tab makes the same MAC from its credential and compares, and only when they are
// equal does it send the credential. A wrong MAC, a missing one, one that comes late, a `paired` before it, or any frame
// this opening does not have: the tab closes, sends nothing more, and tries again later. The tab holds the connection
// proven from that comparison until the socket closes. `proven()` answers the pairing that socket proved, and nothing
// else: it reads the socket's own state when asked, so a request that carries the credential (api.ts) is never made on
// a socket that is going, and it answers nothing once storage holds another pairing (another tab paired anew, or
// unpaired), which closes the connection so that it opens again and proves what is stored now: an old proof never
// authorizes a new credential.
//
// After a close it tries again after 1, 2, 5 and then every 10 seconds, a new nonce each time; the waits start again
// once a connection was paired. 4401 and 4403 read `unpaired`, which shows the pairing screen and deletes nothing (T19):
// the client goes on trying with what is stored, so a tab that a stranger on the port sent to the pairing screen comes
// back by itself when `mawsd` has the port again. The pairing is read when each socket opens, so a new one is used at
// once.
//
// After `paired` (§N) the server sends a snapshot, `ready`, and then one `changed` a change; each is handed on once it
// holds to its shape, and anything else is passed over. `unavailable` (the spine refused, yielded or left `loaded`)
// reads so, keeps the socket, which is still the tab's proof, and asks for the snapshot again after 5 and then every 10
// seconds until one comes.
import { DoorStateSchema, type DoorState } from '@shared/ipc/schema/sheet';
import { SheetSummarySchema, type SheetSummary } from '@shared/sheet/model';
import type { StoredPairing } from './credential';
import { freshNonce, macOf, macsEqual, proofKeyOf } from './proof';

export type Connection = 'connecting' | 'connected' | 'lost' | 'unavailable' | 'unpaired';

export interface Live {
  state(): Connection;
  proven(): StoredPairing | null; // the pairing this connection proved, while it is open and still the one stored
  ask(): void; // { t: 'list' }: a snapshot again
  close(): void; // the socket ended, and nothing tried again
}

// What the client needs of a socket: the browser's WebSocket has it
export interface LiveSocket {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: (() => void) | null;
  send(text: string): void;
  close(): void;
}

export const PROOF_WAIT_MS = 5_000; // each step of the opening, as the server's helloMs
export const RETRY_MS = [1_000, 2_000, 5_000, 10_000] as const; // then every 10 s
export const ASK_MS = [5_000, 10_000] as const; // after `unavailable`: then every 10 s
const SummariesSchema = SheetSummarySchema.array();
const SummarySchema = SheetSummarySchema.nullable();
const OPEN = 1;
const REFUSED = new Set([4401, 4403]); // not known, refused or late; unpaired while connected

export interface LiveDeps {
  url: string; // ws://sheet.localhost:<port>/live
  origin: string; // the tab's own location.origin, which the server's MAC must cover
  pairing(): StoredPairing | null;
  onPaired(): void;
  onReady?(sessions: SheetSummary[], door: DoorState): void; // a snapshot
  onChanged?(session: string, summary: SheetSummary | null): void; // one change, after a snapshot
  onState(state: Connection): void;
  open?(url: string): LiveSocket; // test seam: the browser's WebSocket
}

export function connect(deps: LiveDeps): Live {
  const open = deps.open ?? ((url: string) => new WebSocket(url) as unknown as LiveSocket);
  let state: Connection = 'connecting';
  let socket: LiveSocket | null = null;
  let proven: StoredPairing | null = null; // the pairing the open socket proved
  let tries = 0; // closes since the last paired connection
  let wait: ReturnType<typeof setTimeout> | null = null; // the opening's step, or the next try
  let asking: ReturnType<typeof setTimeout> | null = null; // the next ask for a snapshot, while unavailable
  let closed = false;

  const become = (next: Connection) => {
    if (state === next) return;
    state = next;
    deps.onState(next);
  };
  const clear = () => {
    if (wait !== null) clearTimeout(wait);
    wait = null;
    if (asking !== null) clearTimeout(asking);
    asking = null;
  };

  function start(): void {
    clear();
    const pairing = deps.pairing();
    if (closed || pairing === null) return;
    const key = proofKeyOf(pairing.credential);
    const nonce = freshNonce();
    let step: 'hello' | 'proof' | 'paired' | 'open' = 'hello';
    const here = open(deps.url);
    socket = here;
    const giveUp = () => here.close(); // its close event tries again
    here.onerror = () => {};
    here.onopen = () => {
      here.send(JSON.stringify({ t: 'hello', v: 1, id: pairing.id, nonce }));
      step = 'proof';
      wait = setTimeout(giveUp, PROOF_WAIT_MS);
    };
    here.onmessage = ({ data }) => {
      const message = typeof data === 'string' ? parsed(data) : null;
      if (message === null) return giveUp();
      if (step === 'proof') {
        if (message.t !== 'proof' || typeof message.mac !== 'string' || !macsEqual(message.mac, macOf(key, deps.origin, pairing.id, nonce))) return giveUp();
        proven = pairing;
        step = 'paired';
        here.send(JSON.stringify({ t: 'credential', credential: pairing.credential }));
        clear();
        wait = setTimeout(giveUp, PROOF_WAIT_MS);
        return;
      }
      if (step === 'paired') {
        if (message.t !== 'paired') return giveUp();
        clear();
        step = 'open';
        tries = 0;
        become('connected');
        deps.onPaired();
        return;
      }
      if (message.t === 'ready') {
        const sessions = SummariesSchema.safeParse(message.sessions);
        const door = DoorStateSchema.safeParse(message.door);
        if (!sessions.success || !door.success) return;
        if (asking !== null) clearTimeout(asking);
        asking = null;
        become('connected');
        deps.onReady?.(sessions.data, door.data);
      } else if (message.t === 'changed') {
        const summary = SummarySchema.safeParse(message.summary);
        if (typeof message.session === 'string' && summary.success) deps.onChanged?.(message.session, summary.data);
      } else if (message.t === 'unavailable') {
        become('unavailable');
        if (asking !== null) return;
        const ask = (at: number) => {
          asking = setTimeout(() => {
            if (socket !== here || here.readyState !== OPEN) return;
            here.send(JSON.stringify({ t: 'list' }));
            ask(1);
          }, ASK_MS[at]);
        };
        ask(0);
      }
    };
    here.onclose = ({ code }) => {
      if (socket !== here) return;
      socket = null;
      proven = null;
      clear();
      if (closed) return;
      become(REFUSED.has(code) ? 'unpaired' : 'lost');
      wait = setTimeout(start, RETRY_MS[Math.min(tries, RETRY_MS.length - 1)]);
      tries++;
    };
  }

  start();
  return {
    state: () => state,
    proven() {
      if (proven === null || socket === null || socket.readyState !== OPEN) return null;
      const stored = deps.pairing();
      if (stored?.id === proven.id && stored.credential === proven.credential) return proven;
      socket.close(); // what is stored is not what this socket proved: it goes, and the next one proves what is stored
      return null;
    },
    ask() {
      if (state === 'connected' && socket?.readyState === OPEN) socket.send(JSON.stringify({ t: 'list' }));
    },
    close() {
      closed = true;
      clear();
      const ending = socket;
      socket = null;
      proven = null;
      ending?.close();
    },
  };
}

// A text frame's one JSON object, or null
function parsed(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
