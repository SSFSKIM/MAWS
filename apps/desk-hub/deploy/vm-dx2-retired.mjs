// O14 B4 step 3, the machine-token half: DX2's two routes, removed by M5b, asked with the VM endpoint's own service
// token. It runs on the VM, fed to node on stdin (deploy/README.md), so it imports nothing but node's own modules:
//
//   devcloud vm ssh <vm> -- env "HUB=$HUB" "BUILD=$BUILD" node --input-type=module - < apps/desk-hub/deploy/vm-dx2-retired.mjs
//
// HUB is the hub's origin; BUILD the build step 3's `curl` named (`X-Desk-Build` on the credential-free
// `POST /machine/enroll`). The token is read by path from the endpoint's `enrollment.json`
// (`${XDG_CONFIG_HOME:-$HOME/.config}/MAWS/mawsd/endpoint/`, `credentials.clientId` and `credentials.clientSecret`) and
// never printed. `GET /machine/stream` and `POST /machine/frames`, each with no body, must both answer the Worker's own
// `404 {"error":"not-found"}` under BUILD: M5a's `403 v2-credential`, another build's answer, or Access's redirect
// (no build header) fails. Exit 0 when both pass, 1 when one fails, 2 when it cannot ask.
/* global fetch, AbortSignal */
import console from 'node:console';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const { HUB: hub, BUILD: build } = process.env;
if (!hub || !build) {
  console.error('HUB and BUILD in the environment (deploy/README.md, B4 step 3)');
  process.exit(2);
}
const dir = join(process.env.XDG_CONFIG_HOME || join(process.env.HOME ?? '', '.config'), 'MAWS', 'mawsd', 'endpoint');
let credentials;
try {
  ({ credentials } = JSON.parse(readFileSync(join(dir, 'enrollment.json'), 'utf8')));
  if (typeof credentials?.clientId !== 'string' || typeof credentials?.clientSecret !== 'string') throw new Error();
} catch {
  // The file's text stays out of the message: it holds the token.
  console.error(`no service token in ${join(dir, 'enrollment.json')} (credentials.clientId and credentials.clientSecret)`);
  process.exit(2);
}
const headers = { 'CF-Access-Client-Id': credentials.clientId, 'CF-Access-Client-Secret': credentials.clientSecret };

let failed = 0;
for (const [method, path] of [
  ['GET', '/machine/stream'],
  ['POST', '/machine/frames'],
]) {
  const what = `${method} ${path}`;
  try {
    const response = await fetch(`${hub}${path}`, { method, headers, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    const text = (await response.text()).slice(0, 200);
    const named = response.headers.get('x-desk-build');
    let error;
    try {
      error = JSON.parse(text)?.error;
    } catch {
      error = undefined;
    }
    const said = `${response.status} ${text}`;
    if (named === null) throw new Error(`${said} with no X-Desk-Build: not the Worker's answer`);
    if (named !== build) throw new Error(`${said} under build ${named}, not ${build}`);
    if (response.status !== 404 || error !== 'not-found') throw new Error(`${said}: not the Worker's 404 not-found`);
    console.log(`PASS ${what}: 404 not-found under build ${build}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${what}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
process.exit(failed ? 1 : 0);
