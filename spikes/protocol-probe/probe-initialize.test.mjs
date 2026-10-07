// The probes declare no SDK MCP server by default (E1 M1 fix wave): MAWS's own launches declare `maws`, a probe serves
// none unless its scenario registers one. A server declared and not served is refused by the harness's own handshake
// (sdk-mcp.mjs, E11 W-E; sdk-mcp.test.mjs), so the scenarios that spread appInitialize (E8's reload probes) or declare
// a served server (the two SDK MCP probes) no longer have to opt out by hand. Run with `node --test` from here; no engine
// is launched and no probe module with side effects is loaded (their sources are read as text).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {appInitialize} from '../../src/shared/engine/initialize.ts';
import {probeInitialize} from './probe-initialize.mjs';

const source=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('the probe payload is the app\'s without sdkMcpServers, which the app keeps', () => {
 const trust={accepted:true,directory:'/tmp/probe'};
 assert.deepEqual(appInitialize(trust).sdkMcpServers,['maws']);
 assert.equal('sdkMcpServers' in probeInitialize(trust),false);
 const {sdkMcpServers:_app,...rest}=appInitialize(trust);
 assert.deepEqual(probeInitialize(trust),rest);
 assert.equal('sdkMcpServers' in probeInitialize(),false);
});

test('the harness builds a probe\'s initialize through probeInitialize', () => {
 assert.match(source('harness.mjs'),/\.\.\.probeInitialize\(\)/);
});
