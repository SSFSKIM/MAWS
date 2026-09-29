// Minimal direct client of the computer-use socket (ping, then ListApps), for running under a chosen node binary.
import net from 'node:net';
import {homedir} from 'node:os';
const path=homedir()+'/Library/Group Containers/2DC432GLL2.com.openai.sky.CUAService/IPC/computeruse.sock';
const frame=o=>{const b=Buffer.from(JSON.stringify(o));const h=Buffer.alloc(4);h.writeUInt32LE(b.length);return Buffer.concat([h,b]);};
const s=net.createConnection(path);let buf=Buffer.alloc(0);const got=[];let step=0;
const send=()=>{if(step===0)s.write(frame({jsonrpc:'2.0',id:1,method:'ping',params:{clientApiVersion:'CodexComputerUseIPC-5'}}));
 else if(step===1)s.write(frame({jsonrpc:'2.0',id:2,method:'request',params:{clientApiVersion:'CodexComputerUseIPC-5',deadlineUnixMilliseconds:Date.now()+10000,request:{},requestType:'ComputerUseIPCListAppsRequest'}}));
 else s.end();step++;};
s.on('connect',send);
s.on('data',d=>{buf=Buffer.concat([buf,d]);while(buf.length>=4){const n=buf.readUInt32LE(0);if(buf.length<4+n)break;const m=JSON.parse(buf.subarray(4,4+n));buf=buf.subarray(4+n);got.push(m.result&&Array.isArray(m.result)?{id:m.id,apps:m.result.length}:m);send();}});
s.on('close',()=>{console.log(JSON.stringify({exec:process.execPath,got,closedAfterStep:step}));});
s.on('error',e=>console.log(JSON.stringify({exec:process.execPath,error:e.message})));
setTimeout(()=>s.destroy(),8000);
