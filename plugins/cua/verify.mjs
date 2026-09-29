#!/usr/bin/env node
// Handshake check for cua-shim: spawns the shim, runs initialize and tools/list, and reports what a host would see.
// No app is touched. Run after each ChatGPT.app update: `node plugins/cua/verify.mjs`.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
const shim=fileURLToPath(new URL('./cua-shim.mjs',import.meta.url));
const child=spawn(process.execPath,[shim],{stdio:['pipe','pipe','inherit'],env:{...process.env,CUA_SHIM_CODEX_HOME:process.env.CUA_SHIM_CODEX_HOME||'/tmp/cua-shim-verify'}});
const pending=new Map();let id=0;
const request=(method,params)=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:n,method,params})+'\n');});
createInterface({input:child.stdout}).on('line',line=>{let m;try{m=JSON.parse(line);}catch{return;}
 if(m.id!==undefined&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}});
const timer=setTimeout(()=>{console.error('verify: no answer within 20 s');child.kill();process.exit(1);},20000);
try{
 const init=await request('initialize',{protocolVersion:'2025-06-18',capabilities:{elicitation:{}},clientInfo:{name:'cua-verify',version:'0'}});
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
 const tools=await request('tools/list',{});
 const names=tools.tools.map(t=>t.name);const alwaysLoad=tools.tools.filter(t=>t._meta?.['anthropic/alwaysLoad']).map(t=>t.name);
 const problems=[];
 if(!names.includes('js'))problems.push('js tool missing');
 if(!alwaysLoad.includes('js'))problems.push('js lacks anthropic/alwaysLoad');
 if(!/Host notes/.test(init.instructions||''))problems.push('host notes missing from instructions');
 if((init.instructions||'').length>2048)problems.push('instructions exceed the 2048-character cap');
 console.log(JSON.stringify({server:init.serverInfo,protocolVersion:init.protocolVersion,tools:names,alwaysLoad,instructionsChars:(init.instructions||'').length,problems},null,1));
 process.exitCode=problems.length?1:0;
}catch(e){console.error('verify failed:',e.message);process.exitCode=1;}
finally{clearTimeout(timer);child.stdin.end();}
