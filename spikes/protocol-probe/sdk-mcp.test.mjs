// The probes' one SDK MCP handshake (E11 W-E, the tracker's E1 row on probes opting out of sdkMcpServers by hand): every
// Probe answers the engine's `mcp_message` requests itself, serving the servers a scenario registered and refusing any
// other as MAWS's host does, so a payload that declares a server nobody serves never leaves the engine waiting. Run
// with `node --test` from here; no engine is launched.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SdkServer,sdkMcpAnswer} from './sdk-mcp.mjs';

const request=(server_name,message)=>({subtype:'mcp_message',server_name,message});
const echo={name:'echo',description:'Echo the text.',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text']},call:({text})=>({content:[{type:'text',text}]})};

test('a server nobody registered is refused with a JSON-RPC error under the request\'s id, as MAWS\'s host answers one', () => {
 assert.deepEqual(sdkMcpAnswer({},request('maws',{jsonrpc:'2.0',id:3,method:'initialize',params:{}})),
  {mcp_response:{jsonrpc:'2.0',id:3,error:{code:-32601,message:'the probe serves no MCP server named "maws"'}}});
 assert.deepEqual(sdkMcpAnswer({},request('maws',{jsonrpc:'2.0',method:'notifications/initialized'})),
  {mcp_response:{jsonrpc:'2.0',id:0,error:{code:-32601,message:'the probe serves no MCP server named "maws"'}}});
});

test('a registered server answers the handshake, its tools and their calls; a notification gets the SDK\'s empty result', () => {
 const servers={maws:new SdkServer('maws',[echo])};
 const answer=message=>sdkMcpAnswer(servers,request('maws',message)).mcp_response;
 assert.deepEqual(answer({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25'}}),
  {jsonrpc:'2.0',id:1,result:{protocolVersion:'2025-11-25',capabilities:{tools:{listChanged:true}},serverInfo:{name:'maws',version:'0.0.1'}}});
 assert.deepEqual(answer({jsonrpc:'2.0',method:'notifications/initialized'}),{jsonrpc:'2.0',result:{},id:0});
 assert.deepEqual(answer({jsonrpc:'2.0',id:2,method:'tools/list'}).result.tools.map(t=>t.name),['echo']);
 assert.deepEqual(answer({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'echo',arguments:{text:'hi'}}}),{jsonrpc:'2.0',id:3,result:{content:[{type:'text',text:'hi'}]}});
 assert.deepEqual(servers.maws.calls,[{name:'echo',arguments:{text:'hi'}}]);
 assert.equal(answer({jsonrpc:'2.0',id:4,method:'resources/list'}).error.code,-32601);
 // another name in the same session is still refused
 assert.equal(sdkMcpAnswer(servers,request('maws2',{jsonrpc:'2.0',id:5,method:'initialize'})).mcp_response.error.code,-32601);
});

test('every Probe answers mcp_message through the helper, and the scenarios that serve register their servers with it', () => {
 const source=path=>readFileSync(new URL(path,import.meta.url),'utf8');
 assert.match(source('harness.mjs'),/this\.on\('mcp_message',r=>sdkMcpAnswer\(this\.servers,r\)\)/);
 for(const path of ['scenarios/pass3/p1-sdk-mcp.mjs','scenarios/pass3/p1-sdk-mcp-image.mjs']){
  assert.doesNotMatch(source(path),/p\.on\('mcp_message'/,`${path} answers mcp_message by hand`);
  assert.match(source(path),/p\.serve\('maws',/,`${path} registers its server`);
 }
});
