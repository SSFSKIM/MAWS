import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
const dir=new URL('./fixtures/',import.meta.url);
const load=n=>readFileSync(new URL(n+'.jsonl',dir),'utf8').trim().split('\n').map(JSON.parse);
for(const file of readdirSync(dir).filter(f=>f.endsWith('.jsonl')))test(file+' is ordered, complete NDJSON with correlated RPC replies',()=>{
 const rows=load(file.slice(0,-6));let seq=0;const pending=new Set();
 for(const row of rows){assert.equal(row.seq,++seq);assert.ok(['in','out','meta','stderr'].includes(row.direction));const f=row.frame;
 if(f.type==='control_request')pending.add(row.direction+':'+f.request_id);
 if(f.type==='control_response'){const key=(row.direction==='in'?'out':'in')+':'+f.response.request_id;assert.ok(pending.delete(key),'response has pending request '+key);}
 assert.notEqual(f.event,'parse_error');assert.notEqual(f.event,'scenario_error');
 }assert.equal(pending.size,0);assert.ok(rows.some(r=>r.frame.event==='exit'&&r.frame.code===0));
});
test('child records preserve ancestry without claiming child token streams',()=>{const child=load('subagent').filter(r=>r.frame.parent_tool_use_id);assert.ok(child.some(r=>r.frame.type==='assistant'));assert.ok(child.some(r=>r.frame.type==='user'));assert.ok(!child.some(r=>r.frame.type==='stream_event'));});
test('interruption cancels queued UUID and a later turn succeeds',()=>{const a=load('queue-and-interrupt');const receipt=a.find(r=>r.frame.response?.response?.cancelled)?.frame.response.response;assert.equal(receipt.cancelled.length,1);assert.deepEqual(receipt.still_queued,[]);assert.ok(a.some(r=>r.frame.type==='command_lifecycle'&&r.frame.command_uuid===receipt.cancelled[0]&&r.frame.state==='cancelled'));assert.ok(a.some(r=>r.frame.type==='result'&&r.frame.result==='RESUMED'));});
test('CLI fork uses a new session while preserving context',()=>{const original=load('resume-fork-start').find(r=>r.frame.type==='result').frame;const fork=load('resume-fork-cli').find(r=>r.frame.type==='result').frame;assert.notEqual(fork.session_id,original.session_id);assert.equal(fork.result,'ZEBRA');});
