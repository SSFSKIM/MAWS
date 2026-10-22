// The desk's DOM as the harness reads it: test ids and attributes the app sets for its own suites (apps/desk-web/e2e),
// so a rename shows there first.
export const DESK = {
  gridTile: '[data-testid="grid"] [data-project]',
  gridStatus: '[data-testid="grid-status"]',
  tile: (project) => `[data-project="${project}"]`,
  projectsButton: 'header button',
  projectView: '[data-testid="project-view"]',
  channels: 'nav[aria-label="Channels"]',
  sessionRow: (session) => `nav[aria-label="Channels"] [data-session="${session}"]`,
  anySessionRow: 'nav[aria-label="Channels"] [data-session]',
  liveSessionRow: (session) => `nav[aria-label="Channels"] section:not([data-group="ended"]) [data-session="${session}"]`,
  groupChannel: 'nav[aria-label="Channels"] > button',
  spawnButton: 'nav[aria-label="Channels"] > button:last-of-type',
  sessionView: (session) => `[data-testid="session-view"][data-session="${session}"]`,
  atRest: (session) => `[data-testid="session-view"][data-session="${session}"][data-at-rest]`,
  scroller: '[data-testid="session-view"] [data-transcript-scroller]',
  // A transcript row: the tail's own rows (a send not in the transcript yet, a pending request's card) are not history.
  row: '[data-testid="session-view"] [data-row-id]:not([data-row-id^="desk-tail:"])',
  rowOf: (session) => `[data-testid="session-view"][data-session="${session}"] [data-row-id]:not([data-row-id^="desk-tail:"])`,
  streamRow: '[data-testid="session-view"] [data-row-id^="desk-stream:"]',
  userRow: '[data-testid="session-view"] [data-kind="user"]',
  // An answer's text, streaming or settled (a live thinking row or a message tool's row is not).
  assistantRow: '[data-testid="session-view"] [data-kind="assistant_text"]',
  // The session view's Report · Transcript toggle; MAWS's label for the full transcript (`REPORT.transcript` in
  // src/renderer/src/owner/report/copy.ts), and the toggle once it shows it.
  viewToggle: '[data-testid="session-view-bar"] button',
  transcriptLabel: 'Transcript',
  transcriptShown: '[data-testid="session-view-bar"] button[aria-pressed="true"]',
  tailSend: '[data-testid="tail-send"]',
  delivered: '[data-testid="tail-send"] [data-testid="delivery-foot"][data-state="delivered"]',
  composer: '[data-testid="composer"] textarea',
  verb: (verb) => `[data-testid="composer"] button[data-verb="${verb}"]`,
  rpcDone: '[data-testid="composer"] [data-rpc-state="done"]',
  headerRpcDone: '[data-testid="channel-header"] [data-rpc-state="done"]',
  card: '[data-tail-request]',
  cardOf: (request) => `[data-tail-request="${request}"]`,
  cardButton: '[data-tail-request] button',
  cardRadio: (label) => `[data-tail-request] [role="radio"][aria-label="${label}"]`,
  headerButton: '[data-testid="channel-header"] button',
  spawnDialog: '[role="dialog"]',
  spawnBrief: '[role="dialog"] textarea[aria-label="Brief"]',
  spawnModel: '[role="dialog"] input[aria-label="Model"]',
  spawnMode: '[role="dialog"] select[aria-label="Permission mode"]',
  spawnMachine: '[role="dialog"] select[aria-label="Machine"]',
  spawnCheckout: '[role="dialog"] select[aria-label="Checkout"]',
  spawnStart: '[role="dialog"] button[type="submit"]',
  spawnDone: '[role="dialog"] [data-rpc-state="done"]',
  spawnFailed: '[role="dialog"] [data-rpc-state="failed"]',
};

/** The parts of a desk frame over the bound, by the frame's part id, until the last of them is in. */
const deskParts = new Map();

/**
 * The desk's frames, labelled for the joiner: each frame's type and the ids a load chains its hops by. A frame over the
 * bound (a large snapshot) comes in parts, in whatever order: its parts are held and joined when the last is in, and
 * the whole frame is labelled then, at that part's time, when the app can read it (with `parts`, how many it took).
 */
export function classifyDesk(direction, url, text) {
  if (direction === 'req' || direction === 'done') return /\/api\//.test(url) ? { type: text.split(' ')[0] } : null;
  if (direction !== 'in' && direction !== 'out') return null;
  let frame;
  try {
    frame = JSON.parse(text);
  } catch {
    return { type: 'unparsed' };
  }
  if (frame.t !== 'part') return labelDeskFrame(frame);
  const held = deskParts.get(frame.id) ?? { data: [], n: 0 };
  if (held.data[frame.index] === undefined) held.n++;
  held.data[frame.index] = frame.data;
  if (held.n < frame.count) {
    deskParts.set(frame.id, held);
    return null;
  }
  deskParts.delete(frame.id);
  try {
    return { ...labelDeskFrame(JSON.parse(held.data.join(''))), parts: frame.count };
  } catch {
    return { type: 'unparsed', parts: frame.count };
  }
}

function labelDeskFrame(frame) {
  const label = { type: frame.t ?? '?' };
  if (frame.t === 'session') {
    const m = frame.message ?? {};
    label.type = `session:${m.kind}`;
    if (m.session) label.session = m.session;
    if (m.sub) label.sub = m.sub;
    if (m.kind === 'chunk' && typeof m.body?.t === 'number') label.t = m.body.t;
    if (m.kind === 'raised' || m.kind === 'settled') label.request = m.body?.request;
    // A delivery names the owner's send by its event (the writer and seq its ack gave it).
    if (m.kind === 'delivery') {
      label.writer = m.body?.event?.writer;
      label.seq = m.body?.event?.seq;
      label.session = m.body?.session;
    }
  }
  if (frame.t === 'subscribe') {
    label.sub = frame.sub;
    label.session = frame.session;
  }
  if (frame.t === 'human') label.nonce = frame.event?.mac?.nonce;
  if (frame.t === 'human-ack') {
    label.nonce = frame.nonce;
    label.writer = frame.writer;
    label.seq = frame.seq;
  }
  if (frame.t === 'rpc') {
    label.nonce = frame.rpc?.nonce;
    label.rpc = frame.rpc?.rpc;
  }
  if (frame.t === 'rpc-state') {
    label.nonce = frame.nonce;
    label.state = frame.state;
  }
  return label;
}
