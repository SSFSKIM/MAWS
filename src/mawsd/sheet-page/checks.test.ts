// The three checks, request by request (docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md, §L; M1's
// decisions): §L's table row by row, each row as the request that passes and the requests that are refused, so the
// document's table and the code cannot drift without a test moving. Pure: a request's method, target and raw headers in.
import { describe, expect, it } from 'vitest';
import { admit, bearerOf, hostPasses, originOf, pageOrigin, routeOf, type Asked } from './checks';

const PORT = 47591;
const HOST = `sheet.localhost:${PORT}`;
const ORIGIN = `http://sheet.localhost:${PORT}`;
const CREDENTIAL = 'A'.repeat(43);

const ask = (method: string, target: string, headers: [string, string][] = [], upgrade = false): Asked => ({ method, target, rawHeaders: headers.flat(), upgrade });
const host = (value = HOST): [string, string] => ['Host', value];
const origin = (value = ORIGIN): [string, string] => ['Origin', value];
const bearer = (value = CREDENTIAL): [string, string] => ['Authorization', `Bearer ${value}`];
const status = (verdict: ReturnType<typeof admit>) => ('status' in verdict ? verdict.status : 200);

// Every Host the page refuses (M1's Proves, "another Host"); the upper-case name passes
const FOREIGN_HOSTS: [string, string][][] = [
  [host(`127.0.0.1:${PORT}`)],
  [host(`localhost:${PORT}`)],
  [host(`[::1]:${PORT}`)],
  [host(`rebound.example:${PORT}`)],
  [host('sheet.localhost')],
  [host(`sheet.localhost:${PORT + 1}`)],
  [host(`sheet.localhost.:${PORT}`)],
  [host(), host(`rebound.example:${PORT}`)],
  [host(`rebound.example:${PORT}`), host()],
  [],
];
// Every Origin a write refuses (M1's Proves, "the exchange is a write")
const FOREIGN_ORIGINS: [string, string][][] = [
  [origin(`http://localhost:${PORT}`)],
  [origin(`http://sheet.localhost:${PORT + 1}`)],
  [origin(`https://sheet.localhost:${PORT}`)],
  [origin('null')],
  [origin(), origin(`http://localhost:${PORT}`)],
];

describe('the page’s origin', () => {
  it('is one string, the host name and the port', () => {
    expect(pageOrigin(PORT)).toBe(ORIGIN);
  });
});

describe('hostPasses', () => {
  it('passes exactly one Host equal to the page’s, case folded', () => {
    expect(hostPasses([['Host', HOST]].flat(), PORT)).toBe(true);
    expect(hostPasses(['host', HOST.toUpperCase()], PORT)).toBe(true);
    expect(hostPasses(['HOST', HOST], PORT)).toBe(true);
  });
  it('refuses every other, two of them and none', () => {
    for (const headers of FOREIGN_HOSTS) expect(hostPasses(headers.flat(), PORT), JSON.stringify(headers)).toBe(false);
  });
});

describe('originOf', () => {
  it('reads absent, the page’s, or another', () => {
    expect(originOf([], PORT)).toBe('absent');
    expect(originOf(['Origin', ORIGIN], PORT)).toBe('page');
    expect(originOf(['origin', ORIGIN.toUpperCase()], PORT)).toBe('page');
    for (const headers of FOREIGN_ORIGINS) expect(originOf(headers.flat(), PORT), JSON.stringify(headers)).toBe('other');
  });
});

describe('bearerOf', () => {
  it('reads the one Authorization header of scheme Bearer', () => {
    expect(bearerOf(['Authorization', `Bearer ${CREDENTIAL}`])).toBe(CREDENTIAL);
    expect(bearerOf(['authorization', `bearer ${CREDENTIAL}`])).toBe(CREDENTIAL);
  });
  it('reads none from another scheme, a malformed value, two headers, a cookie', () => {
    expect(bearerOf([])).toBeNull();
    expect(bearerOf(['Authorization', `Basic ${CREDENTIAL}`])).toBeNull();
    expect(bearerOf(['Authorization', `Bearer ${CREDENTIAL} extra`])).toBeNull();
    expect(bearerOf(['Authorization', 'Bearer not/base64url'])).toBeNull();
    expect(bearerOf(['Authorization', `Bearer ${CREDENTIAL}`, 'Authorization', `Bearer ${CREDENTIAL}`])).toBeNull();
    expect(bearerOf(['Cookie', `maws.sheet.credential=${CREDENTIAL}`])).toBeNull();
  });
});

describe('routeOf', () => {
  it('reads the shell at / and under /s/, whatever follows', () => {
    for (const target of ['/', '/s/', '/s/5eed0000-0000-4000-8000-000000000019', '/s/anything/at/all', '/s/x?code=AAAA', '/?x=1']) expect(routeOf('GET', target), target).toEqual({ kind: 'shell' });
  });
  it('reads any other GET path as a file of the bundle’s table, its query dropped', () => {
    expect(routeOf('GET', '/assets/index.js')).toEqual({ kind: 'file', path: '/assets/index.js' });
    expect(routeOf('GET', '/assets/index.js?v=2')).toEqual({ kind: 'file', path: '/assets/index.js' });
    expect(routeOf('GET', '/../etc/passwd')).toEqual({ kind: 'file', path: '/../etc/passwd' }); // a lookup, never a join (T13)
  });
  it('reads the exchange, the unpair and the live connection', () => {
    expect(routeOf('POST', '/api/pair')).toEqual({ kind: 'pair' });
    expect(routeOf('POST', '/api/unpair')).toEqual({ kind: 'unpair' });
    expect(routeOf('GET', '/live')).toEqual({ kind: 'live' });
  });
  it('answers 405 for a known path with another method, OPTIONS anywhere, and any method but GET and POST', () => {
    for (const [method, target] of [['GET', '/api/pair'], ['POST', '/'], ['POST', '/s/x'], ['POST', '/live'], ['GET', '/api/unpair'], ['OPTIONS', '/api/pair'], ['OPTIONS', '/'], ['HEAD', '/'], ['PUT', '/api/pair'], ['DELETE', '/x.js'], ['POST', '/assets/index.js']] as const) {
      expect(routeOf(method, target), `${method} ${target}`).toMatchObject({ status: 405 });
    }
  });
  it('answers 404 for anything else under /api/ (the sheet’s routes come at M3)', () => {
    expect(routeOf('GET', '/api/sheets/5eed0000-0000-4000-8000-000000000019')).toMatchObject({ status: 404 });
    expect(routeOf('POST', '/api/anything')).toMatchObject({ status: 404 });
  });
  it('refuses a target that is not origin-form', () => {
    for (const target of ['*', 'http://sheet.localhost:47591/', 'sheet.localhost:47591', '']) expect(routeOf('GET', target), target).toMatchObject({ status: 400 });
  });
});

describe('admit: §L’s table, row by row', () => {
  // the order: the count of headers, then Host, then the route and its method, then Origin, then the credential
  it('GET / and GET /s/<anything>: the Host alone; no Origin read, no credential', () => {
    for (const target of ['/', '/s/anything']) {
      expect(admit(ask('GET', target, [host()]), PORT)).toEqual({ route: { kind: 'shell' }, credential: null });
      expect(admit(ask('GET', target, [host(), origin('http://evil.example')]), PORT)).toEqual({ route: { kind: 'shell' }, credential: null });
      for (const headers of FOREIGN_HOSTS) expect(status(admit(ask('GET', target, headers), PORT)), JSON.stringify(headers)).toBe(421);
    }
  });

  it('GET <a path of the table>: the Host alone', () => {
    expect(admit(ask('GET', '/assets/index.js', [host()]), PORT)).toEqual({ route: { kind: 'file', path: '/assets/index.js' }, credential: null });
    for (const headers of FOREIGN_HOSTS) expect(status(admit(ask('GET', '/assets/index.js', headers), PORT))).toBe(421);
  });

  it('POST /api/pair: the Host, then exactly the page’s Origin; no credential', () => {
    expect(admit(ask('POST', '/api/pair', [host(), origin()]), PORT)).toEqual({ route: { kind: 'pair' }, credential: null });
    for (const headers of FOREIGN_HOSTS) expect(status(admit(ask('POST', '/api/pair', [...headers, origin()]), PORT))).toBe(421);
    for (const headers of [[], ...FOREIGN_ORIGINS]) expect(status(admit(ask('POST', '/api/pair', [host(), ...headers]), PORT)), JSON.stringify(headers)).toBe(403);
  });

  it('POST /api/unpair: the Host, the page’s Origin, then the credential', () => {
    expect(admit(ask('POST', '/api/unpair', [host(), origin(), bearer()]), PORT)).toEqual({ route: { kind: 'unpair' }, credential: CREDENTIAL });
    for (const headers of FOREIGN_HOSTS) expect(status(admit(ask('POST', '/api/unpair', [...headers, origin(), bearer()]), PORT))).toBe(421);
    for (const headers of [[], ...FOREIGN_ORIGINS]) expect(status(admit(ask('POST', '/api/unpair', [host(), ...headers, bearer()]), PORT))).toBe(403);
    const credentials: [string, string][][] = [[], [['Authorization', `Basic ${CREDENTIAL}`]], [bearer(), bearer('B'.repeat(43))], [['Cookie', `credential=${CREDENTIAL}`]]];
    for (const headers of credentials) expect(status(admit(ask('POST', '/api/unpair', [host(), origin(), ...headers]), PORT)), JSON.stringify(headers)).toBe(401);
    expect(status(admit(ask('POST', `/api/unpair?credential=${CREDENTIAL}`, [host(), origin()]), PORT))).toBe(401);
  });

  it('GET /live, upgrading: the Host, then exactly the page’s Origin; the credential comes on the connection', () => {
    expect(admit(ask('GET', '/live', [host(), origin()], true), PORT)).toEqual({ route: { kind: 'live' }, credential: null });
    for (const headers of FOREIGN_HOSTS) expect(status(admit(ask('GET', '/live', [...headers, origin()], true), PORT))).toBe(421);
    for (const headers of [[], ...FOREIGN_ORIGINS]) expect(status(admit(ask('GET', '/live', [host(), ...headers], true), PORT)), JSON.stringify(headers)).toBe(403);
    expect(status(admit(ask('GET', '/live', [host(), origin()]), PORT))).toBe(400); // not upgrading
    expect(status(admit(ask('GET', '/', [host(), origin()], true), PORT))).toBe(404); // an upgrade anywhere else
  });

  it('anything else: the Host, then 404, or 405 for a known path with another method', () => {
    expect(status(admit(ask('GET', '/api/nothing', [host()]), PORT))).toBe(404);
    expect(status(admit(ask('GET', '/api/nothing', [host('localhost')]), PORT))).toBe(421);
    expect(status(admit(ask('OPTIONS', '/api/pair', [host(), origin()]), PORT))).toBe(405);
    expect(status(admit(ask('OPTIONS', '/api/pair', [host('localhost')]), PORT))).toBe(421); // the Host first, so a stranger learns no path
  });

  it('refuses more than HEADERS_MAX headers, 431, before anything reads one', () => {
    const filler = (n: number): [string, string][] => Array.from({ length: n }, (_, i) => [`X-Filler-${i}`, 'x']);
    expect(status(admit(ask('GET', '/', [host(), ...filler(63)]), PORT))).toBe(200); // 64
    expect(status(admit(ask('GET', '/', [host(), ...filler(64)]), PORT))).toBe(431); // 65
    expect(status(admit(ask('GET', '/live', [host(), origin(), ...filler(62)], true), PORT))).toBe(200);
    expect(status(admit(ask('GET', '/live', [host(), origin(), ...filler(63)], true), PORT))).toBe(431);
    // a cut list's last header is never read as absent: a foreign Origin, or a second Host, past the bound
    expect(status(admit(ask('POST', '/api/pair', [host(), origin(), ...filler(67), origin('http://evil.example')]), PORT))).toBe(431);
    expect(status(admit(ask('GET', '/', [host(), ...filler(68), host('rebound.example')]), PORT))).toBe(431);
  });

  it('answers each refusal with a constant sentence: nothing of the request is written back', () => {
    const refused = admit(ask('GET', '/<script>', [host('<script>evil</script>')]), PORT);
    expect(refused).toMatchObject({ status: 421 });
    expect((refused as { body: string }).body).not.toMatch(/script|evil/);
    const refusedOrigin = admit(ask('POST', '/api/pair', [host(), origin('http://evil.example')]), PORT);
    expect((refusedOrigin as { body: string }).body).not.toMatch(/evil/);
  });
});
