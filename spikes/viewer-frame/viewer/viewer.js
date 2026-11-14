// The viewer page's one module script. In architecture A it is a sandboxed frame and talks to its parent by
// postMessage; in B it is a top-level document of a view of its own: it fetches its file once from its own host, says
// what it has to say by in-page fragment navigations, and takes commands posted to it from an isolated world.
const params = new URLSearchParams(location.search);
const format = params.get('format') ?? 'docx';
const topLevel = window.parent === window;
const root = document.getElementById('root');
const violations = [];
document.addEventListener('securitypolicyviolation', (e) => {
  violations.push({ directive: e.effectiveDirective, blocked: e.blockedURI, sample: e.sample, source: e.sourceFile, line: e.lineNumber });
});
const state = { violations, format, topLevel, pingBudget: Infinity, hangAfterBudget: false };
globalThis.__viewer = state;

let seq = 0;
function say(message) {
  if (!topLevel) return parent.postMessage(message, '*');
  location.hash = `${message.type}=${++seq}:${encodeURIComponent(JSON.stringify(message))}`;
}
state.say = say;

const loaders = { docx: () => import('./docx.js'), pptx: () => import('./pptx.js'), xlsx: () => import('./xlsx.js') };
const hookUrl = ['.', 'hook.js'].join('/'); // a URL esbuild leaves alone: the hook is its own file on the list

async function draw(bytes) {
  const t0 = performance.now();
  try {
    const module = await loaders[format]();
    const info = await module.draw(root, bytes);
    say({ type: 'drawn', ms: Math.round(performance.now() - t0), info, violations: violations.slice() });
  } catch (error) {
    say({ type: 'draw-failed', error: String(error?.stack ?? error).slice(0, 2000), violations: violations.slice() });
  }
}

addEventListener('message', async (event) => {
  if (event.source !== (topLevel ? window : parent)) return;
  const message = event.data;
  if (!message || typeof message !== 'object') return;
  if (message.type === 'file') return draw(message.bytes);
  if (message.type === 'ping') {
    if (state.pingBudget <= 0) return;
    state.pingBudget -= 1;
    say({ type: 'pong', n: message.n });
    if (state.pingBudget === 0 && state.hangAfterBudget) setTimeout(() => { for (;;) {} }, 0);
    return;
  }
  if (message.type === 'test') {
    let result;
    try {
      const hook = await import(hookUrl);
      result = await hook.run(message.name, message.args ?? {}, { root, say, state });
    } catch (error) {
      result = { error: String(error?.stack ?? error).slice(0, 2000) };
    }
    say({ type: 'reply', reqId: message.reqId, result });
  }
});

if (topLevel && params.get('draw') === '1') {
  // B: the file's bytes, served once from this page's own host
  fetch(new URL('file', location.href)).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`file: ${r.status}`)))).then(draw, (error) => say({ type: 'draw-failed', error: String(error) }));
}
say({ type: 'ready', url: location.href, isSecureContext, origin: self.origin });
