// The recomposition walk's console attacks (the desk's Parent-Level Acceptance 8, "the machine decides"; the walk
// sheet's Part G, G1 and G3). The owner pastes this into DevTools on the desk's own origin while signed in, having set
//
//     DESK_WALK = { project: '<the walk project id>', session: '<a live session on a machine>', machine: '<that machine>' }
//
// first. It opens ONE WebSocket to that project, sends exactly TWO frames, each sealed with a wrong code the org key
// never signed, prints what comes back, and closes. Both are meant to be refused — that refusal is what item 8 proves:
//   1. a `human` event. The hub holds no key, so it stores it and answers `human-ack`; every daemon then refuses it on
//      import (`bad-code`) and reports it, which the desk draws as a red "… refusals in the project's audit record"
//      banner, one line per machine, and your own tab draws "one event failed verification and is not shown".
//   2. a `steer` RPC to the live session. The hub forwards it; the named machine's daemon refuses it `bad-code` and
//      the refusal comes back here as `rpc-state` failed. (The desk draws nothing for an RPC it did not itself send.)
//
// It sends nothing else — no resume, no subscribe, no visibility — so it reads no transcript and changes no state but
// what the two forgeries leave in the log, which the counts command then explains as refused. It never touches the org
// key. It refuses to run against any project but the one in DESK_WALK: it checks the socket's `welcome` names that
// project before it sends anything.
(async () => {
  const cfg = globalThis.DESK_WALK;
  const bad = (m) => {
    throw new Error(`walk-console: ${m}. Set DESK_WALK = { project, session, machine } and paste again.`);
  };
  if (!cfg || typeof cfg !== 'object') bad('no DESK_WALK');
  for (const field of ['project', 'session', 'machine']) if (typeof cfg[field] !== 'string' || !cfg[field]) bad(`DESK_WALK.${field} is missing`);

  // A random, canonical base64url code — 16-byte nonce, 32-byte value — that the org key did not sign.
  const b64url = (n) => {
    const bytes = crypto.getRandomValues(new Uint8Array(n));
    let raw = '';
    for (const b of bytes) raw += String.fromCharCode(b);
    return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const wrongMac = () => ({ nonce: b64url(16), value: b64url(32) });
  const now = () => new Date().toISOString();

  const url = `${globalThis.location.origin.replace(/^http/, 'ws')}/api/projects/${encodeURIComponent(cfg.project)}/socket`;
  const ws = new WebSocket(url);
  const sent = [];
  const got = [];
  const send = (frame) => {
    sent.push(frame.t);
    ws.send(JSON.stringify(frame));
  };
  const waitFor = (test, what, ms = 8000) =>
    new Promise((resolve) => {
      const at = got.find(test);
      if (at) return resolve(at);
      const started = Date.now();
      const timer = setInterval(() => {
        const found = got.find(test);
        if (found) {
          clearInterval(timer);
          resolve(found);
        } else if (Date.now() - started > ms) {
          clearInterval(timer);
          resolve(null);
          console.warn(`walk-console: no ${what} within ${ms} ms`);
        }
      }, 50);
    });

  ws.addEventListener('message', (e) => got.push(JSON.parse(String(e.data))));
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('walk-console: the project socket was refused')), { once: true });
  });

  const welcome = await waitFor((f) => f.t === 'welcome', 'welcome');
  if (!welcome) {
    ws.close();
    bad('the socket sent no welcome');
  }
  if (welcome.project !== cfg.project) {
    ws.close();
    bad(`the socket is project ${welcome.project}, not ${cfg.project}`);
  }
  const member = welcome.member;

  // 1. The forged `human`.
  const human = {
    t: 'human',
    event: { kind: 'human', from: 'human', member, to: [{ session: cfg.session, alias: 'walk' }], text: 'walk-console: a human event the org key never signed', created: now(), mac: wrongMac() },
  };
  send(human);
  const humanNonce = human.event.mac.nonce;
  // The hub acks a stored human by its nonce; a refusal of its own (bad-shape, writer-not-yours) carries it in `refusal`.
  const humanAnswer = await waitFor((f) => (f.t === 'human-ack' && f.nonce === humanNonce) || (f.t === 'refused' && f.refusal?.nonce === humanNonce), 'answer to the forged human');
  const rejected = await waitFor((f) => f.t === 'rejected' && f.rejection?.nonce === humanNonce, 'a daemon rejecting the forged human', 12000);

  // 2. The forged `steer` RPC.
  const rpc = {
    t: 'rpc',
    rpc: { rpc: 'steer', project: cfg.project, machine: cfg.machine, member, created: now(), nonce: b64url(16), args: { session: cfg.session, text: 'walk-console: a steer the org key never signed' }, mac: b64url(32) },
  };
  send(rpc);
  const rpcAnswer = await waitFor((f) => f.t === 'rpc-state' && f.nonce === rpc.rpc.nonce && (f.state === 'failed' || f.state === 'done'), "the forged RPC's outcome");

  ws.close();

  console.log('walk-console: sent exactly these frames:', sent);
  console.log('1. forged human →', humanAnswer ? humanAnswer.t : '(no answer)', humanAnswer?.t === 'human-ack' ? '(the hub holds no key, so it stored it; the daemons refuse it on import)' : humanAnswer);
  console.log('   a daemon rejected it →', rejected ? `${rejected.rejection.machine}: ${rejected.rejection.reason}` : '(none yet — reload the desk and read the banner)');
  console.log('2. forged steer RPC →', rpcAnswer ? `${rpcAnswer.state}${rpcAnswer.outcome?.error ? ` ${rpcAnswer.outcome.error.code}: ${rpcAnswer.outcome.error.message}` : ''}` : '(no answer)');
  const ok = sent.length === 2 && sent[0] === 'human' && sent[1] === 'rpc' && rpcAnswer?.state === 'failed' && rpcAnswer.outcome?.error?.code === 'bad-code';
  console.log(ok ? 'walk-console: as expected — the RPC was refused bad-code; read the desk banner for the human.' : 'walk-console: unexpected — record what came back.');
  globalThis.DESK_WALK_RESULT = { sent, humanAnswer, rejected, rpcAnswer };
})();
