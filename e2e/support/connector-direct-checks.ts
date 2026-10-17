// P3-HD M4b: the pure checks route D's integrated scenes (e2e/connectors-direct.spec.ts) rest on, free of Playwright
// so test/support/connector-direct-checks.test.ts runs them under vitest. docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md,
// acceptance 1-6 and Decision Log 23, 25 and 28:
// - `custodyProblems`: the launch's mock keychain and canonical scratch profile, checked before any owner action (the
//   product's own guard, src/main/connectors/oauth-root.ts, stands before every real safeStorage call);
// - `addedListeners` / `loopbackPort`: the callback listener a Connect binds, exactly 127.0.0.1;
// - `readSealedText` / `plaintextHits`: a sealed OAuth record's format and that no known value is readable in it;
// - `journalTurns`: launches, and that no model turn ran, from a session's journal rows;
// - `isRetainedScratch`: which scratch files a scene scans for secrets (never the host token, the raw open log, a
//   fixture's secrets inventory or a sealed record, which is scanned apart);
// - `bearerCrossings`: a bearer presented to a server that did not issue it;
// - `pageVariant` / `oncePageHtml`: H's page re-pointed at another server, and a page that calls once per click.

export interface CustodyFacts {
  mockKeychain: boolean; // main's `use-mock-keychain` switch
  userData: string | null; // main's userData, canonical; null when it would not resolve
  scratch: string | null; // the profile the harness named main (MAWS_USER_DATA), canonical
  expected: string | null; // the scene's own profile, canonical
  tmp: string | null; // the OS temporary directory, canonical
}
export type CustodyProblem = 'mockKeychain' | 'userData' | 'profile' | 'scratch' | 'notTemporary';

export function custodyProblems(facts: CustodyFacts): CustodyProblem[] {
  const problems: CustodyProblem[] = [];
  const { userData, scratch, expected, tmp } = facts;
  if (!facts.mockKeychain) problems.push('mockKeychain');
  if (userData === null) problems.push('userData');
  if (userData === null || expected === null || userData !== expected) problems.push('profile');
  if (scratch === null || expected === null || scratch !== expected) problems.push('scratch');
  const under = tmp === null ? null : tmp.endsWith('/') ? tmp : `${tmp}/`;
  if (userData === null || under === null || !userData.startsWith(under)) problems.push('notTemporary');
  return problems;
}

// What `after` lists that `before` did not, each once, in order.
export function addedListeners(before: readonly string[], after: readonly string[]): string[] {
  const known = new Set(before);
  return [...new Set(after)].filter((address) => !known.has(address));
}

// The port of an exact `127.0.0.1:<port>` listener address (lsof's spelling), else null.
export function loopbackPort(address: string): number | null {
  const match = /^127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(address);
  if (!match) return null;
  const port = Number(match[1]);
  return port <= 65_535 ? port : null;
}

export const SEALED_FORMAT = 'maws-connector-oauth/1'; // src/main/connectors/oauth-store.ts FORMAT

// A sealed record's text: its format line, then one canonical base64 line of ciphertext, then nothing.
export function readSealedText(text: string): { ok: true; ciphertext: Buffer } | { ok: false; why: 'format' | 'body' } {
  const lines = text.split('\n');
  if (lines[0] !== SEALED_FORMAT) return { ok: false, why: 'format' };
  const body = lines[1] ?? '';
  if (lines.length !== 3 || lines[2] !== '' || body === '' || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return { ok: false, why: 'body' };
  const ciphertext = Buffer.from(body, 'base64');
  if (ciphertext.toString('base64') !== body) return { ok: false, why: 'body' };
  return { ok: true, ciphertext };
}

// The indexes of the non-empty `needles` readable in `bytes`, as UTF-8 or as Latin-1: never the values themselves.
export function plaintextHits(bytes: Buffer, needles: readonly string[]): number[] {
  const utf8 = bytes.toString('utf8');
  const latin1 = bytes.toString('latin1');
  return needles.flatMap((needle, index) => (needle !== '' && (utf8.includes(needle) || latin1.includes(needle)) ? [index] : []));
}

export interface JournalTurns {
  spawns: number;
  exits: number;
  userFrames: number; // user messages written to the engine
  modelFrames: number; // assistant, result and stream frames read from it: any one is a model turn
  needsAuth: number; // frames from the engine reporting a server as needs-auth
}
const MODEL_FRAMES = new Set(['assistant', 'result', 'stream_event']);
const typeOf = (frame: unknown) => (frame !== null && typeof frame === 'object' ? (frame as { type?: unknown }).type : undefined);

export function journalTurns(rows: readonly { direction: string; frame: unknown }[]): JournalTurns {
  const turns: JournalTurns = { spawns: 0, exits: 0, userFrames: 0, modelFrames: 0, needsAuth: 0 };
  for (const { direction, frame } of rows) {
    if (direction === 'meta') {
      const event = frame !== null && typeof frame === 'object' ? (frame as { event?: unknown }).event : undefined;
      if (event === 'spawn') turns.spawns += 1;
      if (event === 'exit') turns.exits += 1;
    } else if (direction === 'out') {
      if (typeOf(frame) === 'user') turns.userFrames += 1;
    } else if (direction === 'in') {
      if (MODEL_FRAMES.has(typeOf(frame) as string)) turns.modelFrames += 1;
      if (JSON.stringify(frame).includes('"needs-auth"')) turns.needsAuth += 1;
    }
  }
  return turns;
}

// A scratch path (relative to the scene's root, `/`-separated) a scene may read and scan as retainable.
export function isRetainedScratch(relative: string): boolean {
  if (relative === 'ud/supervisor/host.token' || relative === 'open.log') return false;
  if (/^oauth-[^/]+-secrets\.jsonl$/.test(relative)) return false;
  if (/^ud\/connectors\/oauth\/[^/]+\.sealed$/.test(relative)) return false;
  return true;
}

export interface ServerTokens {
  name: string;
  issued: readonly string[]; // hashes of the access tokens this server minted
  presented: readonly string[]; // hashes of the Bearer values its MCP requests presented
}

// Every presented bearer a server did not issue: where, and which server issued it (null: none of them).
export function bearerCrossings(servers: readonly ServerTokens[]): { at: string; issuedBy: string | null }[] {
  return servers.flatMap((server) =>
    server.presented.filter((hash) => !server.issued.includes(hash)).map((hash) => ({ at: server.name, issuedBy: servers.find((other) => other.issued.includes(hash))?.name ?? null })),
  );
}

const replaceOnce = (text: string, from: string, to: string): string => {
  const parts = text.split(from);
  if (parts.length !== 2) throw new Error(`pageVariant: \`${from}\` is not in the page exactly once`);
  return parts.join(to);
};

// H's page (support/connector-scene.ts PAGE_HTML) under another title and for another server, its tool and watch the same.
export function pageVariant(html: string, to: { server: string; title: string }, from: { server: string; title: string } = { server: 'fixture', title: 'Signups, live' }): string {
  let page = replaceOnce(html, `<title>${from.title}</title>`, `<title>${to.title}</title>`);
  page = replaceOnce(page, `<h1>${from.title}</h1>`, `<h1>${to.title}</h1>`);
  return replaceOnce(page, `server: ${JSON.stringify(from.server)}`, `server: ${JSON.stringify(to.server)}`);
}

const scriptString = (value: string) => JSON.stringify(value).replaceAll('</', '<\\/');

// A page that declares one tool and calls it once per click of `#call` (no watch), writing each outcome as H's page
// does: `#last` the latest (`ok n=<k> via=<route>` or `<state>:<reason>`), `#updates` how many arrived.
export function oncePageHtml(options: { server: string; tool: string; title: string }): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${options.title}</title></head>
<body>
<h1>${options.title}</h1>
<p id="declared">declaring</p>
<button id="call" type="button">Read once</button>
<p id="last">none</p>
<p id="updates">0</p>
<script>
const tool = { server: ${scriptString(options.server)}, tool: ${scriptString(options.tool)} };
let updates = 0;
const show = (o) => {
  updates += 1;
  document.getElementById('updates').textContent = String(updates);
  const n = o.ok && o.result && o.result.structuredContent ? o.result.structuredContent.n : null;
  document.getElementById('last').textContent = o.ok ? 'ok n=' + n + ' via=' + o.via.route : o.state + ':' + o.reason;
};
(async () => {
  const declared = await mawsConnectors.declare([tool]);
  document.getElementById('declared').textContent = declared.ok ? 'declared' : declared.state + ':' + declared.reason;
})();
document.getElementById('call').addEventListener('click', async () => show(await mawsConnectors.call({ ...tool, args: { series: 'signups' } })));
</script>
</body></html>
`;
}
