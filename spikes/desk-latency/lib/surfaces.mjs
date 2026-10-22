// The two apps as the loads see them: one surface each, so every load runs the same steps against the desk and against
// claude.ai/code and the two numbers mean the same thing. A surface names the specs a load waits on (content, the
// controls that make it usable, a reply, a card) and the network frames that mark its hops. The desk's come from its
// test ids (desk-selectors.mjs); claude.ai/code's from rc-selectors.mjs, uncalibrated until the first live pass.
const SEND_ENABLED = '[data-testid="composer"] button[data-verb="send"]:not([disabled])';

/** A control's spec narrowed to its enabled elements (each of a selector list's alternatives). */
const enabled = (spec) => ({ ...spec, selector: spec.selector.split(',').map((s) => `${s.trim()}:not([disabled])`).join(', ') });

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
    // Opens: what is drawn, and when it is usable. A drop leaves the rows and tiles in place, and the socket's open (the
    // "Live" word, `data-connection="open"`) comes before its welcome and backlog, so a return is fresh only at the
    // desk's own sample of it (`fresh`: the paths of `window.deskLatency.samples`).
    app: {
      content: { selector: DESK.gridTile },
      useful: { all: [{ selector: DESK.gridTile }, { selector: DESK.gridStatus, text: 'Live' }] },
      down: { selector: DESK.gridStatus, text: 'Reconnecting' },
      extra: { shell: { selector: '[data-testid="top-bar"], header' } },
      fresh: ['grid.socket'],
    },
    project: {
      content: { selector: DESK.anySessionRow },
      useful: { all: [{ selector: DESK.anySessionRow }, { selector: `${DESK.projectView}[data-connection="open"]` }] },
      down: { selector: `${DESK.projectView}[data-connection="connecting"]` },
      extra: { unlocked: { selector: '[data-testid="key-state"]', text: 'Unlocked' }, view: { selector: DESK.projectView } },
      fresh: ['online.caught-up', 'socket.gap'],
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
      // A fresh snapshot merged into the transcript.
      fresh: ['resume.gap'],
    }),
    // A wake that needed a reconnect: caught up and verified after it.
    wakeFresh: ['wake.caught-up'],
    /** When the first of `paths` was sampled after `sinceWall` (wall ms; a drawn path's at the frame that paints it), or null. */
    async freshAt(ctx, paths, sinceWall) {
      const samples = await ctx.deskSamples(sinceWall);
      return samples?.find((s) => paths.includes(s.path))?.at ?? null;
    },
    // In-app moves.
    toApp: { selector: 'nav[aria-label="Where"] button', text: 'Projects' },
    toProject: { selector: DESK.tile(project) },
    toSession: (session) => ({ selector: DESK.sessionRow(session) }),
    scroller: { selector: DESK.scroller },
    // The session view as its whole transcript (an action's setup switches to it): the Report view folds a turn's
    // unmarked text into a collapsed working record, so an answer streaming there may never be drawn.
    fullView: { selector: DESK.viewToggle, text: DESK.transcriptLabel },
    fullViewShown: { selector: DESK.transcriptShown, text: DESK.transcriptLabel },
    // The composer and a turn.
    composer: DESK.composer,
    // Usable again after a return (a disabled button takes no click): Send, and Interrupt, which the desk disables
    // while it is disconnected.
    sendReady: { selector: SEND_ENABLED },
    stopReady: enabled({ selector: DESK.verb('interrupt') }),
    echo: (token) => ({ selector: `${DESK.tailSend}, ${DESK.userRow}`, text: token }),
    delivered: (token) => ({ selector: `[data-testid="tail-send"][data-state="delivered"], ${DESK.userRow}`, text: token }),
    row: (token) => ({ selector: DESK.userRow, text: token }),
    // A steer is drawn at once at the tail (its RPC in flight), and in the transcript once the bridge appended it.
    steered: (text) => ({ selector: DESK.userRow, text }),
    // The answer's first text drawn; `firstActivity` is any streaming row (a thinking label, a message tool's). Fresh by
    // the row's id: a resume's snapshot draws the old rows again, in new elements.
    firstToken: { selector: DESK.assistantRow, fresh: true, freshBy: 'data-row-id', minText: 1 },
    firstActivity: { selector: DESK.streamRow, fresh: true, freshBy: 'data-row-id' },
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
    /**
     * The frames that mark an item's hops after `since`, each found by the ids the hop before it gave and in `session`
     * where a frame names one: a send (its nonce; the event its ack names, writer and seq; that event's delivery; the
     * session's first chunk after it), an RPC (its nonce), a raise, an open (the subscription's id). The ids come along.
     */
    hops(net, since, kind, session) {
      if (!net) return null;
      const mine = (e) => !session || e.session === session;
      const first = (after, match) => net.first(after?.at ?? since, match);
      const t = (e) => e?.at ?? null;
      if (kind === 'send') {
        const sent = first(null, (e) => e.dir === 'out' && e.type === 'human');
        const ack = sent && first(sent, (e) => e.dir === 'in' && e.type === 'human-ack' && e.nonce === sent.nonce);
        const delivery = ack && first(ack, (e) => e.dir === 'in' && e.type === 'session:delivery' && e.writer === ack.writer && e.seq === ack.seq && mine(e));
        const chunk = first(delivery ?? ack ?? sent, (e) => e.dir === 'in' && e.type === 'session:chunk' && mine(e));
        return { times: { sent: t(sent), ack: t(ack), delivery: t(delivery), firstChunk: t(chunk) }, ids: { nonce: sent?.nonce, writer: ack?.writer, seq: ack?.seq, session } };
      }
      if (kind === 'rpc' || kind === 'steer') {
        const sent = first(null, (e) => e.dir === 'out' && e.type === 'rpc');
        const state = (states) => sent && first(sent, (e) => e.dir === 'in' && e.type === 'rpc-state' && e.nonce === sent.nonce && states.includes(e.state));
        return { times: { sent: t(sent), forwarded: t(state(['forwarded'])), done: t(state(['done', 'failed'])) }, ids: { nonce: sent?.nonce, rpc: sent?.rpc } };
      }
      if (kind === 'raise') {
        const raised = first(null, (e) => e.dir === 'in' && e.type === 'session:raised' && mine(e));
        return { times: { raised: t(raised) }, ids: { request: raised?.request, session } };
      }
      if (kind === 'open') {
        const subscribe = first(null, (e) => e.dir === 'out' && e.type === 'subscribe' && mine(e));
        const snapshot = subscribe && first(subscribe, (e) => e.dir === 'in' && e.type === 'session:snapshot' && e.sub === subscribe.sub);
        return { times: { subscribe: t(subscribe), snapshot: t(snapshot) }, ids: { sub: subscribe?.sub, session } };
      }
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
      fresh: 'list',
    },
    project: null,
    // Rows name no session here: after an in-app switch the content is the rows that were not there before it.
    session: (session, variant, cohort) => {
      const rows = cohort === 'warm' ? { ...RC.anyMessage, fresh: true } : RC.anyMessage;
      return {
        content: rows,
        useful: { all: [rows, RC.composer, ...(variant === 'mid-turn' ? [RC.stopButton] : []), { ...RC.disconnected, gone: true }] },
        down: RC.disconnected,
        extra: variant === 'mid-turn' ? { streaming: { ...RC.assistantMessage, changed: true } } : {},
        fresh: 'session',
      };
    },
    wakeFresh: 'session',
    /**
     * When the page's state was fresh after `sinceWall`, whichever proof came first: for the list (`fresh: 'list'`) its
     * GET again, or its watch reopened and its first message in; for a session (`'session'`) its socket open again with
     * the reply to the `initialize` it sent, or its tail of events fetched.
     */
    async freshAt(ctx, fresh, sinceWall) {
      const net = ctx.net;
      if (!net) return null;
      let times;
      if (fresh === 'list') {
        const list = net.first(sinceWall, (e) => e.dir === 'done' && e.type === 'done:list');
        const watch = net.first(sinceWall, (e) => e.dir === 'req' && e.type === 'req:watch');
        const synced = watch && net.first(watch.at, (e) => (e.dir === 'sse' || e.dir === 'data') && RC_NET.watch.test(e.url));
        times = [list?.at, synced?.at];
      } else {
        const open = this.hops(net, sinceWall, 'open').times;
        times = [open.initialized, open.history];
      }
      const seen = times.filter((v) => v != null);
      return seen.length ? Math.min(...seen) : null;
    },
    toApp: null,
    toProject: null,
    toSession: (session) => RC.sessionRowOf(session),
    scroller: RC.scroller,
    composer: RC.composer.selector,
    sendReady: null,
    stopReady: enabled(RC.stopButton),
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
    /**
     * The frames that mark an item's hops after `since`, each found by the ids the hop before it gave: the page's POST
     * (its own request's end by its request id), the event it carried back by its `uuid` (the echo; for a steer, the
     * replay of it consumed), a control's reply by its `request_id`. Stream deltas carry no id: the first after the echo.
     */
    hops(net, since, kind) {
      if (!net) return null;
      const first = (after, match) => net.first(after?.at ?? since, match);
      const t = (e) => e?.at ?? null;
      const posted = (post) => post && first(post, (e) => e.dir === 'done' && e.rid === post.rid);
      const delta = (after) => first(after, (e) => e.dir === 'in' && e.type === 'stream_event' && e.delta && e.main !== false);
      if (kind === 'send' || kind === 'steer') {
        const post = first(null, (e) => e.dir === 'req' && e.type === 'req:events' && (e.events ?? []).some((x) => x.startsWith('user')));
        const back = post?.uuid && first(post, (e) => e.dir === 'in' && e.type === 'user' && e.uuid === post.uuid && (kind === 'send' || e.replay === true));
        const firstDelta = delta(back ?? post);
        const ids = { uuid: post?.uuid };
        if (kind === 'steer') return { times: { post: t(post), posted: t(posted(post)), consumed: t(back), firstDelta: t(firstDelta) }, ids };
        const delivery = first(back ?? post, (e) => e.dir === 'in' && (e.type === 'delivery_update' || (e.type === 'system' && e.subtype === 'status' && e.status === 'requesting')));
        const result = first(firstDelta ?? back ?? post, (e) => e.dir === 'in' && e.type === 'result');
        return { times: { post: t(post), posted: t(posted(post)), echo: t(back), delivery: t(delivery), firstDelta: t(firstDelta), result: t(result) }, ids };
      }
      if (kind === 'rpc') {
        const post = first(null, (e) => e.dir === 'req' && e.type === 'req:events');
        const response = post && first(post, (e) => e.dir === 'in' && (e.type === 'control_response' || e.type === 'control_cancel_request') && e.request_id === post.request_id);
        const result = first(response ?? post, (e) => e.dir === 'in' && e.type === 'result');
        return { times: { post: t(post), posted: t(posted(post)), response: t(response), result: t(result) }, ids: { request_id: post?.request_id } };
      }
      if (kind === 'raise') {
        const raised = first(null, (e) => e.dir === 'in' && e.type === 'control_request' && e.subtype === 'can_use_tool');
        return { times: { raised: t(raised) }, ids: { request_id: raised?.request_id, tool_use_id: raised?.tool_use_id } };
      }
      if (kind === 'open') {
        const history = first(null, (e) => e.dir === 'done' && e.type === 'done:events' && e.method === 'GET');
        const socket = first(null, (e) => e.dir === 'ws-open');
        // The reply to the `initialize` the page sent once that socket was open (on it, or in a POST), by its request id:
        // another client's control reply on the session may come first.
        const init = socket && first(socket, (e) => (e.dir === 'out' || e.dir === 'req') && e.subtype === 'initialize' && e.request_id !== undefined);
        const initialized = init && first(init, (e) => e.dir === 'in' && e.type === 'control_response' && e.request_id === init.request_id);
        return { times: { history: t(history), socket: t(socket), initialized: t(initialized) }, ids: { request_id: init?.request_id } };
      }
      return null;
    },
  };
}
