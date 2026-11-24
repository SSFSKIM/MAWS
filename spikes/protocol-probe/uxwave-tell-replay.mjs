// The direct tell's replay (docs/charter.md, Decision Log 2026-11-24): MAWS's engine host replaying the shipped mod's
// probe of a running background child (fixtures/uxwave/uxwave-tell-builtin-live-bg.jsonl), for the replay transport and
// the stub engine (src/engine-host/replay-transport.ts) that the e2e scene and src/engine-host/tell-replay.test.ts drive.
// Derived, not recorded: the probe's own writes the host never makes are left out (its initialize, which the host's
// handshake prelude answers, its mcp_status polls, its answer to the child's permission request with that request and
// the state frames around it, and its end_session), the notes go, and the stream is left open at its end (no exit row),
// so the session stays live. The host's call is written as the host writes it for TYPED: the mod's text after the line
// that says who wrote it (src/shared/maws/tell.ts `tellText`). Usage: node uxwave-tell-replay.mjs (rewrites the fixture).
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export const SOURCE=fileURLToPath(new URL('./fixtures/uxwave/uxwave-tell-builtin-live-bg.jsonl',import.meta.url));
export const TARGET=fileURLToPath(new URL('./fixtures/uxwave/uxwave-tell-builtin-replay.jsonl',import.meta.url));
export const TYPED='Also list the folder';
export const PROMPT='Start the child.';
const TELL_LINE='From the person supervising this session, not from your coordinator:'; // src/shared/maws/tell.ts

export function deriveTellReplay(text){
 const rows=text.trim().split('\n').map(line=>JSON.parse(line));
 const permission=rows.find(r=>r.direction==='in'&&r.frame.type==='control_request'&&r.frame.request.subtype==='can_use_tool');
 const held=permission.frame.request_id;
 const dropped=new Set(rows.filter(r=>{
  const f=r.frame;
  if(r.direction==='meta')return f.event!=='spawn';
  if(r.direction==='out')return !(f.type==='user'||(f.type==='control_request'&&f.request.subtype==='mcp_call'));
  if(f.type==='control_request')return f.request_id===held; // the child's permission request
  if(f.type==='control_response'){const id=f.response.request_id;return !rows.some(o=>o.direction==='out'&&o.frame.type==='control_request'&&o.frame.request.subtype==='mcp_call'&&o.frame.request_id===id);}
  if(f.type==='system'&&f.subtype==='session_state_changed'){const at=rows.indexOf(r),from=rows.indexOf(permission);return Math.abs(at-from)<=8&&r.seq!==11;} // the requires_action around the permission
  return false;
 }));
 let seq=0;
 return rows.filter(r=>!dropped.has(r)).map(r=>{
  const f=r.frame;
  const frame=r.direction==='out'&&f.type==='control_request'&&f.request.subtype==='mcp_call'?{...f,request:{...f.request,arguments:{...f.request.arguments,text:`${TELL_LINE}\n${TYPED}`}}}:f;
  return JSON.stringify({...r,seq:++seq,frame});
 }).join('\n')+'\n';
}

if(process.argv[1]===fileURLToPath(import.meta.url))writeFileSync(TARGET,deriveTellReplay(readFileSync(SOURCE,'utf8')));
