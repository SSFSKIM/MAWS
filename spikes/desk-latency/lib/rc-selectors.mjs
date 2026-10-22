// claude.ai/code as the harness reads it: every selector and endpoint pattern for the Remote Control side, in this one
// place. None has been seen live. The endpoints and frame shapes come from the static read of the web app
// (claude-code-bundle/2.1.300/notes/claude-ai-rc-client-protocol.md); the DOM is not in those notes at all, so each DOM
// entry is a guess from the app's copy strings and ARIA conventions until the first live pass calibrates it with
// `--load probe-page` (README.md, "Calibrating claude.ai/code"). An entry is a probe spec — a CSS selector (a comma
// list is CSS's own alternatives), with `text` to require — and `calibrate` says what to check.
export const RC = {
  /** A session in the sidebar list. */
  sessionRow: { selector: 'a[href*="/code/session_"]', calibrate: 'a sidebar row is a link to /code/session_…?' },
  sessionRowOf: (id) => ({ selector: `a[href*="${suffixOf(id)}"]` }),
  /** A message of the transcript: the user's and the assistant's. */
  userMessage: { selector: '[data-testid="user-message"], [data-message-author-role="user"]', calibrate: 'the user bubble; its optimistic echo and its confirmed copy the same element?' },
  assistantMessage: { selector: '[data-testid="assistant-message"], [data-message-author-role="assistant"], .font-claude-response, .font-claude-message', calibrate: 'the assistant text block; does the streaming row use the same element?' },
  /** Any row of the transcript, for "first rows painted" and "older rows came in". */
  anyMessage: { selector: '[data-testid="user-message"], [data-testid="assistant-message"], [data-message-author-role], .font-claude-response, .font-claude-message', calibrate: 'one selector for every transcript row' },
  /** The transcript's scrolling element, for the older page. */
  scroller: { selector: 'main [class*="overflow-y-auto"], main [class*="overflow-auto"]', calibrate: 'the element that scrolls the transcript; is the older page a scroll sentinel or a button?' },
  olderButton: { selector: 'button', text: 'Load earlier', calibrate: 'is there a button for earlier messages?' },
  /** A steered message once the session read it: its row's state words (P:455: "unread", then "read"/"Sent"). */
  steerRead: { selector: '[data-testid="user-message"], [data-message-author-role="user"]', textMatch: 'Sent|Read', calibrate: 'how a steered row says the session read it' },
  /** The composer and its controls. */
  composer: { selector: 'div[contenteditable="true"], textarea', calibrate: 'the prompt box (ProseMirror contenteditable?)' },
  stopButton: { selector: 'button[aria-label*="Stop" i], button[aria-label*="Interrupt" i]', calibrate: 'the Stop button while a turn runs' },
  /** Working indicators (copy: P:250-255). */
  working: { selector: 'main', textMatch: 'Waiting for Claude…|Thinking…|Running', calibrate: 'the working line while a turn runs' },
  /** A permission card's buttons (copy: P:358-360) and a question's options. */
  allowOnce: { selector: 'button', text: 'Allow once', calibrate: 'the card button; "Allow" alone on some cards?' },
  deny: { selector: 'button', text: 'Deny' },
  permissionCard: { selector: 'button', text: 'Allow once', calibrate: 'a card container to watch for removal (the button stands for it)' },
  questionOption: (label) => ({ selector: 'button, [role="radio"], [role="option"], label', text: label, calibrate: 'how AskUserQuestion options draw' }),
  questionSubmit: { selector: 'button', textMatch: '^(Submit|Send|Continue)$', calibrate: 'the question card submit' },
  /** The new-session view (spawn): its composer is the same `composer`. */
  newSessionUrl: (environment) => `/code?environment=${encodeURIComponent(environment)}`,
  /** Connection banners (copy: P:192, P:305-307). */
  disconnected: { selector: 'body', textMatch: 'Disconnected from the remote session|Reconnecting to your computer|Remote Control disconnected|Can’t reach your computer', calibrate: 'banner element' },
};

/** The two spellings of a session id (`session_…` in the page URL, `cse_…` in v2 paths) share the part after the last `_`. */
export function suffixOf(id) {
  const at = String(id).lastIndexOf('_');
  return at < 0 ? String(id) : String(id).slice(at + 1);
}

/** The endpoints the page uses (P:35, P:90-101, P:199): matched by path, since the API host is not in the notes. */
export const RC_NET = {
  subscribe: /\/v1\/sessions\/ws\/[^/]+\/subscribe/,
  events: /\/v1\/(code\/)?sessions\/[^/]+\/events/,
  list: /\/v1\/code\/sessions(\?|$)/,
  watch: /\/v1\/code\/sessions\/watch/,
  meta: /\/v1\/(code\/)?sessions\/[^/?]+(\?|$)/,
  environments: /\/v1\/environment_providers\//,
  create: /\/v1\/code\/sessions$/,
};

/**
 * The RC frames, labelled: each NDJSON line of a WebSocket message by its type and the ids a load joins on (a user
 * event's `uuid`, a control request's `request_id`, a delta's kind), and each POST to the events endpoint by the event
 * types it carries. Envelope fields that carry the server's clock (`created_at`) are kept for a skew estimate.
 */
export function classifyRc(direction, url, text) {
  if (direction === 'req' || direction === 'done') {
    const known = Object.entries(RC_NET).find(([, re]) => re.test(url));
    if (!known) return null;
    const label = { type: `${direction}:${known[0]}`, method: text.split(' ')[0] };
    if (direction === 'req' && known[0] === 'events') {
      try {
        const body = JSON.parse(text.slice(text.indexOf(' ') + 1));
        const payloads = (body.events ?? []).map((e) => e.payload ?? e);
        label.events = payloads.map((p) => `${p.type}${p.request?.subtype ? `:${p.request.subtype}` : ''}${p.response?.subtype ? `:${p.response.subtype}` : ''}`);
        // A batch may carry settings ahead of its message: the ids are the user event's and the control's own.
        const user = payloads.find((p) => p.type === 'user');
        if (user?.uuid) label.uuid = user.uuid;
        const control = payloads.find((p) => p.request_id || p.response?.request_id);
        if (control) label.request_id = control.request_id ?? control.response.request_id;
        if (control?.request?.subtype) label.subtype = control.request.subtype;
      } catch {
        // not JSON
      }
    }
    return label;
  }
  if (direction !== 'in' && direction !== 'out' && direction !== 'sse') return null;
  const out = [];
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    let f;
    try {
      f = JSON.parse(line);
    } catch {
      out.push({ type: 'unparsed' });
      continue;
    }
    const p = f.payload && typeof f.payload === 'object' ? f.payload : f;
    const label = { type: p.type ?? f.type ?? f.event_type ?? '?' };
    if (p.subtype) label.subtype = p.subtype;
    if (p.uuid) label.uuid = p.uuid;
    if (p.isReplay) label.replay = true;
    if (p.request_id) label.request_id = p.request_id;
    if (p.request?.subtype) label.subtype = p.request.subtype;
    if (p.request?.tool_use_id) label.tool_use_id = p.request.tool_use_id;
    if (p.response?.request_id) label.request_id = p.response.request_id;
    if (p.event?.type) label.event = p.event.type;
    if (p.event?.delta?.type) label.delta = p.event.delta.type;
    if (p.parent_tool_use_id !== undefined) label.main = p.parent_tool_use_id === null;
    if (p.status) label.status = p.status;
    if (f.created_at) label.created_at = f.created_at;
    if (p.timestamp) label.timestamp = p.timestamp;
    if (f.sequence_num !== undefined) label.seq = f.sequence_num;
    out.push(label);
  }
  return out.length ? out : null;
}
