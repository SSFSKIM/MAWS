// P3-H H4: an artifact page's connector runtime (docs/doperpowers/plans/2026-10-12-p3-co-work.md, P3-H and Decision Log
// 24, 80 and 84), the second half of the bridge script (./bridge-script.ts), which runs before the page's own scripts.
// It defines `window.mawsConnectors`, frozen and not writable, the page's one door to a connector tool, narrower than the
// app's `ArtifactHost` surface it is relayed to: a page declares, calls and watches, and nothing else (no grant, revoke,
// Start or visibility, which are the owner's in the editor header):
//
//   mawsConnectors.declare([{server, tool}, …])            → Promise<{ok: true, declared} | refusal>
//   mawsConnectors.call({server, tool, args?})             → Promise<{ok: true, result, fetchedAt, via} | refusal>
//   mawsConnectors.watch({server, tool, args?, intervalMs}, onUpdate)
//                                                          → Promise<{ok: true, watchId, intervalMs, stop(), refresh()} | refusal>
//
// A refusal is `{ok: false, state, reason}` from the closed lists of `ConnectorRefusal` (src/shared/artifacts/connectors.ts);
// no answer carries words. Every request goes over one MessagePort the app's frame hands the page at each load
// (`{type: 'maws:connectors'}` with the port, from `window.parent` alone; the first one only), so the artifact the
// requests are about is the frame's, never the page's to name. A request made before the port arrives waits for it, in
// order. A page with no parent (the capture window loads it top-level), or one whose port has not come
// `PAGE_PORT_WAIT_MS` after its load (a frame that relays nothing), reads `paused: closed` for everything. A request that
// cannot be posted (a function in its arguments, say) reads `invalid: request`. A watch's refreshes go to `onUpdate`
// from its start's answer on (the relay posts them after it) until `stop()`.
//
// A plain string, joined into one line with the bridge script (no `//` comments, every statement ended by its semicolon).
export const PAGE_PORT_WAIT_MS = 10_000;

export const PAGE_CONNECTORS_SOURCE = String.raw`(function () {
  'use strict';
  var host = window.parent;
  var framed = !!host && host !== window;
  var port = null;
  var dead = !framed;
  var queue = [];
  var pending = Object.create(null);
  var watchers = Object.create(null);
  var next = 0;

  function closed() { return { ok: false, state: 'paused', reason: 'closed' }; }
  function invalid() { return { ok: false, state: 'invalid', reason: 'request' }; }

  function post(message) {
    try { port.postMessage(message); }
    catch (error) { var settle = pending[message.id]; delete pending[message.id]; if (settle) settle(invalid()); }
  }

  function request(message, onAnswer) {
    return new Promise(function (resolve) {
      if (dead) { resolve(closed()); return; }
      var id = ++next;
      message.id = id;
      pending[id] = function (answer) { resolve(onAnswer ? onAnswer(answer) : answer); };
      if (port) post(message); else queue.push(message);
    });
  }

  function die() {
    dead = true;
    queue = [];
    var settles = pending;
    pending = Object.create(null);
    for (var id in settles) settles[id](closed());
  }

  function receive(event) {
    var data = event.data;
    if (!data || typeof data !== 'object') return;
    if (typeof data.id === 'number') {
      var settle = pending[data.id];
      if (!settle) return;
      delete pending[data.id];
      settle(data.answer);
      return;
    }
    if (typeof data.watchId === 'string' && watchers[data.watchId]) watchers[data.watchId](data.update);
  }

  window.addEventListener('message', function (event) {
    if (port || dead || event.source !== host) return;
    var data = event.data;
    if (!data || typeof data !== 'object' || data.type !== 'maws:connectors' || !event.ports || event.ports.length !== 1) return;
    port = event.ports[0];
    port.onmessage = receive;
    var waiting = queue;
    queue = [];
    for (var i = 0; i < waiting.length; i += 1) post(waiting[i]);
  });

  if (framed) {
    window.addEventListener('load', function () {
      window.setTimeout(function () { if (!port && !dead) die(); }, ${PAGE_PORT_WAIT_MS});
    });
  }

  function watch(watchRequest, onUpdate) {
    if (typeof onUpdate !== 'function') return Promise.resolve(invalid());
    return request({ op: 'watch', request: watchRequest }, function (answer) {
      if (!answer || answer.ok !== true || typeof answer.watchId !== 'string') return answer;
      var watchId = answer.watchId;
      watchers[watchId] = onUpdate;
      return Object.freeze({
        ok: true,
        watchId: watchId,
        intervalMs: answer.intervalMs,
        stop: function () { delete watchers[watchId]; return request({ op: 'unwatch', watchId: watchId }); },
        refresh: function () { return request({ op: 'refresh', watchId: watchId }); }
      });
    });
  }

  Object.defineProperty(window, 'mawsConnectors', {
    value: Object.freeze({
      declare: function (tools) { return request({ op: 'declare', tools: tools }); },
      call: function (callRequest) { return request({ op: 'call', request: callRequest }); },
      watch: watch
    }),
    enumerable: false,
    configurable: false,
    writable: false
  });
})();`;
