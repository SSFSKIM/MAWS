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
  assistantRow: '[data-testid="session-view"] [data-kind="assistant_text"]',
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

/** The desk's frames, labelled for the joiner: each frame's type and the ids a load joins on. */
export function classifyDesk(direction, url, text) {
  if (direction === 'req' || direction === 'done') return /\/api\//.test(url) ? { type: text.split(' ')[0] } : null;
  if (direction !== 'in' && direction !== 'out') return null;
  let frame;
  try {
    frame = JSON.parse(text);
  } catch {
    return { type: 'unparsed' };
  }
  const label = { type: frame.t ?? '?' };
  if (frame.t === 'session') {
    const m = frame.message ?? {};
    label.type = `session:${m.kind}`;
    if (m.sub) label.sub = m.sub;
    if (m.kind === 'chunk' && typeof m.body?.t === 'number') label.t = m.body.t;
    if (m.kind === 'raised') label.request = m.body?.request;
    if (m.kind === 'settled') label.request = m.body?.request;
  }
  if (frame.t === 'subscribe') label.sub = frame.sub;
  if (frame.t === 'human') label.nonce = frame.event?.mac?.nonce;
  if (frame.t === 'human-ack') label.nonce = frame.nonce;
  if (frame.t === 'rpc') {
    label.nonce = frame.rpc?.nonce;
    label.rpc = frame.rpc?.rpc;
  }
  if (frame.t === 'rpc-state') {
    label.nonce = frame.nonce;
    label.state = frame.state;
  }
  // A frame over the bound comes in parts (a large snapshot): the last part completes it, and its type is in the first
  // part's text.
  if (frame.t === 'part') return { type: 'part', part: frame.id, index: frame.index, count: frame.count, ...(frame.index === 0 && { head: String(frame.data).slice(0, 80) }) };
  return label;
}
