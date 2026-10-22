// The two apps as the loads see them: one surface each, so every load runs the same steps against the desk and against
// claude.ai/code and the two numbers mean the same thing. A surface names the specs a load waits on (content, the
// controls that make it usable, a reply, a card) and the network frames that mark its hops. The desk's come from its
// test ids (desk-selectors.mjs); claude.ai/code's from rc-selectors.mjs, uncalibrated until the first live pass.
const SEND_ENABLED = '[data-testid="composer"] button[data-verb="send"]:not([disabled])';

export function deskSurface(config) {
  const base = String(config.url ?? '').replace(/\/$/, '');
  const project = config.project;
  const live = (session) => ({ selector: DESK.sessionView(session) });
  return {
    name: 'desk',
    base,
    urls: {
      app: `${base}/`,
      project: `${base}/p/${project}`,
      session: (session) => `${base}/p/${project}/s/${session}`,
    },
    // Opens: what is drawn, and when it is usable.
    app: {
      content: { selector: DESK.gridTile },
      useful: { all: [{ selector: DESK.gridTile }, { selector: DESK.gridStatus, text: 'Live' }] },
      down: { selector: DESK.gridStatus, text: 'Reconnecting' },
      extra: { shell: { selector: '[data-testid="top-bar"], header' } },
    },
    project: {
      content: { selector: DESK.anySessionRow },
      useful: { all: [{ selector: DESK.anySessionRow }, { selector: `${DESK.projectView}[data-connection="open"]` }] },
      down: { selector: `${DESK.projectView}[data-connection="connecting"]` },
      extra: { unlocked: { selector: '[data-testid="key-state"]', text: 'Unlocked' }, view: { selector: DESK.projectView } },
    },
    session: (session, variant) => ({
      content: { selector: DESK.rowOf(session) },
      useful: {
        all:
          variant === 'ended'
            ? [{ selector: DESK.rowOf(session) }, { any: [{ selector: `${DESK.headerButton}:not([disabled])`, text: 'Resume' }, { selector: '[data-testid="retired-by"]' }] }]
            : [{ selector: DESK.rowOf(session) }, { selector: SEND_ENABLED }, { selector: `${DESK.projectView}[data-connection="open"]` }, ...(variant === 'mid-turn' ? [{ selector: DESK.verb('interrupt') }] : [])],
      },
      // The hub's socket lost, or the session's subscription interrupted (its machine's stream recycled, its bridge
      // restarted): either way the transcript says it is not current.
      down: { any: [{ selector: `${DESK.projectView}[data-connection="connecting"]` }, { selector: '[data-testid="session-status"]', textMatch: 'Reconnecting' }] },
      extra: { view: live(session), unlocked: { selector: '[data-testid="key-state"]', text: 'Unlocked' }, ...(variant === 'mid-turn' && { streaming: { selector: DESK.streamRow } }) },
    }),
    // In-app moves.
    toApp: { selector: 'nav[aria-label="Where"] button', text: 'Projects' },
    toProject: { selector: DESK.tile(project) },
    toSession: (session) => ({ selector: DESK.sessionRow(session) }),
    scroller: { selector: DESK.scroller },
    // The composer and a turn.
    composer: DESK.composer,
    echo: (token) => ({ selector: `${DESK.tailSend}, ${DESK.userRow}`, text: token }),
    delivered: (token) => ({ selector: `[data-testid="tail-send"][data-state="delivered"], ${DESK.userRow}`, text: token }),
    row: (token) => ({ selector: DESK.userRow, text: token }),
    // A steer is drawn at once at the tail (its RPC in flight), and in the transcript once the bridge appended it.
    steered: (text) => ({ selector: DESK.userRow, text }),
    firstToken: { selector: `${DESK.streamRow}, ${DESK.assistantRow}`, fresh: true },
    reply: (token) => ({ selector: `${DESK.streamRow}, ${DESK.assistantRow}`, text: token }),
    running: { selector: DESK.verb('interrupt') },
    stop: { selector: DESK.verb('interrupt') },
    stopped: { selector: DESK.verb('interrupt'), gone: true },
    idle: (session) => ({ all: [{ selector: DESK.atRest(session) }, { selector: DESK.verb('interrupt'), gone: true }] }),
    changed: { selector: '[data-testid="session-view"]', changed: true },
    // A request's card at the transcript's tail.
    card: { selector: DESK.card, fresh: true },
    cardId: (attrs) => attrs?.['data-tail-request'] ?? null,
    cardGone: (id) => ({ selector: DESK.cardOf(id), gone: true }),
    allow: (id) => ({ selector: `${DESK.cardOf(id)} button`, text: 'Allow' }),
    deny: (id) => ({ selector: `${DESK.cardOf(id)} button`, text: 'Deny' }),
    option: (id, label) => ({ selector: `${DESK.cardOf(id)} [role="radio"][aria-label="${label}"]` }),
    submit: (id) => ({ selector: `${DESK.cardOf(id)} button`, text: 'Submit' }),
    /** The frames that mark a turn's hops after `since`: the send, the hub's ack, the delivery, the reply's first chunk. */
    hops(net, since, kind) {
      if (!net) return null;
      const ids = {};
      const at = (match, keep) => {
        const e = net.first(since, match);
        if (e && keep) for (const k of keep) if (e[k] !== undefined) ids[k] = e[k];
        return e?.at ?? null;
      };
      const out = (times) => ({ times, ids });
      if (kind === 'send')
        return out({
          sent: at((e) => e.dir === 'out' && e.type === 'human', ['nonce']),
          ack: at((e) => e.dir === 'in' && e.type === 'human-ack'),
          delivery: at((e) => e.dir === 'in' && e.type === 'session:delivery'),
          firstChunk: at((e) => e.dir === 'in' && e.type === 'session:chunk'),
        });
      if (kind === 'rpc' || kind === 'steer')
        return out({
          sent: at((e) => e.dir === 'out' && e.type === 'rpc', ['nonce', 'rpc']),
          forwarded: at((e) => e.dir === 'in' && e.type === 'rpc-state' && e.state === 'forwarded'),
          done: at((e) => e.dir === 'in' && e.type === 'rpc-state' && (e.state === 'done' || e.state === 'failed')),
        });
      if (kind === 'raise') return out({ raised: at((e) => e.dir === 'in' && e.type === 'session:raised', ['request']) });
      if (kind === 'open')
        return out({
          subscribe: at((e) => e.dir === 'out' && e.type === 'subscribe', ['sub']),
          snapshot: at((e) => e.dir === 'in' && (e.type === 'session:snapshot' || (e.type === 'part' && /"snapshot"/.test(e.head ?? '')))),
        });
      return null;
    },
  };
}

export function rcSurface(config) {
  const base = String(config.url ?? 'https://claude.ai').replace(/\/$/, '');
  return {
    name: 'rc',
    base,
    urls: {
      app: `${base}/code`,
      project: null,
      session: (session) => `${base}/code/${session}`,
    },
    app: {
      content: RC.sessionRow,
      useful: { all: [RC.sessionRow, { ...RC.disconnected, gone: true }] },
      down: RC.disconnected,
      extra: {},
    },
    project: null,
    // Rows name no session here: after an in-app switch the content is the rows that were not there before it.
    session: (session, variant, cohort) => ({
      content: cohort === 'warm' ? { ...RC.anyMessage, fresh: true } : RC.anyMessage,
      useful: cohort === 'warm' ? { ...RC.anyMessage, fresh: true } : { all: [RC.anyMessage, RC.composer, ...(variant === 'mid-turn' ? [RC.stopButton] : []), { ...RC.disconnected, gone: true }] },
      down: RC.disconnected,
      extra: variant === 'mid-turn' ? { streaming: { ...RC.assistantMessage, changed: true } } : {},
    }),
    toApp: null,
    toProject: null,
    toSession: (session) => RC.sessionRowOf(session),
    scroller: RC.scroller,
    composer: RC.composer.selector,
    echo: (token) => ({ ...RC.userMessage, text: token }),
    delivered: null,
    row: (token) => ({ ...RC.userMessage, text: token }),
    steered: (text) => ({ ...RC.steerRead, text }),
    firstToken: { ...RC.assistantMessage, fresh: true, minText: 1 },
    reply: (token) => ({ ...RC.assistantMessage, text: token }),
    running: RC.stopButton,
    stop: RC.stopButton,
    stopped: { ...RC.stopButton, gone: true },
    idle: () => ({ ...RC.stopButton, gone: true }),
    changed: { selector: 'main', changed: true },
    card: { ...RC.permissionCard, fresh: true },
    cardId: (attrs) => attrs?.['data-tool-use-id'] ?? 'card',
    cardGone: () => ({ ...RC.permissionCard, gone: true }),
    allow: () => RC.allowOnce,
    deny: () => RC.deny,
    option: (_id, label) => RC.questionOption(label),
    submit: () => RC.questionSubmit,
    questionCard: (label) => ({ ...RC.questionOption(label), fresh: true }),
    questionGone: (label) => ({ ...RC.questionOption(label), gone: true }),
    hops(net, since, kind) {
      if (!net) return null;
      const ids = {};
      const at = (match, keep) => {
        const e = net.first(since, match);
        if (e && keep) for (const k of keep) if (e[k] !== undefined) ids[k] = e[k];
        return e?.at ?? null;
      };
      const out = (times) => ({ times, ids });
      if (kind === 'send')
        return out({
          post: at((e) => e.dir === 'req' && e.type === 'req:events' && (e.events ?? []).some((x) => x.startsWith('user')), ['uuid']),
          posted: at((e) => e.dir === 'done' && e.type === 'done:events'),
          echo: at((e) => e.dir === 'in' && e.type === 'user'),
          delivery: at((e) => e.dir === 'in' && (e.type === 'delivery_update' || (e.type === 'system' && e.subtype === 'status' && e.status === 'requesting'))),
          firstDelta: at((e) => e.dir === 'in' && e.type === 'stream_event' && e.delta && e.main !== false),
          result: at((e) => e.dir === 'in' && e.type === 'result'),
        });
      if (kind === 'steer')
        return out({
          post: at((e) => e.dir === 'req' && e.type === 'req:events', ['uuid']),
          posted: at((e) => e.dir === 'done' && e.type === 'done:events'),
          consumed: at((e) => e.dir === 'in' && e.type === 'user' && e.replay === true),
          firstDelta: at((e) => e.dir === 'in' && e.type === 'stream_event' && e.delta && e.main !== false),
        });
      if (kind === 'rpc')
        return out({
          post: at((e) => e.dir === 'req' && e.type === 'req:events', ['request_id']),
          posted: at((e) => e.dir === 'done' && e.type === 'done:events'),
          response: at((e) => e.dir === 'in' && (e.type === 'control_response' || e.type === 'control_cancel_request')),
          result: at((e) => e.dir === 'in' && e.type === 'result'),
        });
      if (kind === 'raise') return out({ raised: at((e) => e.dir === 'in' && e.type === 'control_request' && e.subtype === 'can_use_tool', ['request_id', 'tool_use_id']) });
      if (kind === 'open')
        return out({
          history: at((e) => e.dir === 'done' && e.type === 'done:events'),
          socket: at((e) => e.dir === 'ws-open'),
          initialized: at((e) => e.dir === 'in' && e.type === 'control_response'),
        });
      return null;
    },
  };
}
