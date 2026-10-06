// The probes declare no SDK MCP server by default (E1 M1 fix wave): MAWS's own launches declare `maws`, a probe serves
// none, and only the scenario that serves one (pass3/p1-sdk-mcp.mjs) declares it. Run with `node --test` from here;
// no engine is launched and no probe module with side effects is loaded (their sources are read as text).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
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

test('every probe module builds initialize through probeInitialize, and only the SDK MCP scenario declares a server', () => {
 const modules=['harness.mjs',...['pass2','pass3'].flatMap(pass=>readdirSync(new URL(`scenarios/${pass}/`,import.meta.url)).filter(f=>f.endsWith('.mjs')).map(f=>`scenarios/${pass}/${f}`))];
 for(const path of modules)assert.doesNotMatch(source(path),/\bappInitialize\b/,`${path} builds initialize from appInitialize`);
 assert.match(source('harness.mjs'),/\.\.\.probeInitialize\(\)/);
 const declaring=modules.filter(path=>/sdkMcpServers\s*:/.test(source(path)));
 assert.deepEqual(declaring,['scenarios/pass3/p1-sdk-mcp.mjs']);
});
