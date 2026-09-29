// W3-1: Claude Code 2.1.283 (headless stream-json, the MAWS wiring) hosts OpenAI's cua_repl through cua-shim.mjs.
// The model gets the goal only; it must learn the cua API from the docs the first tool result returns.
// Envelope: TextEdit only. The harness accepts only TextEdit approvals and allows only the cua_repl tools.
import {Probe,root as probeRoot} from '../protocol-probe/harness.mjs';
import {root} from './mcp-client.mjs';
import {execFileSync} from 'node:child_process';
import {writeFileSync,readFileSync,existsSync,readdirSync,mkdtempSync} from 'node:fs';
for(const k of Object.keys(process.env))if(/^CMUX_/.test(k)||['CLAUDE_CODE_SESSION_ID','CLAUDE_CODE_CHILD_SESSION','CLAUDE_CODE_SESSION_ATTENDED','CLAUDE_PID','CLAUDE_CODE_MESSAGING_SOCKET','CLAUDE_CODE_MESSAGING_TOKEN','CLAUDE_CODE_EXECPATH','CLAUDE_EFFORT'].includes(k))delete process.env[k];
const BIN='/Users/new/.local/share/claude/versions/2.1.283', HOME='/tmp/maws-cu-probe/cc-home', DOC='/tmp/maws-cu-probe/textedit-probe.txt', NAME=process.env.PROBE_NAME||'w3-claude-code-host';
const sh=(c,a)=>{try{return execFileSync(c,a,{encoding:'utf8'}).trim();}catch(e){return 'ERR '+e.message.split('\n')[0];}};
writeFileSync(DOC,'MAWS computer-use probe document.\n');execFileSync('open',['-g','-a','TextEdit',DOC]);await new Promise(r=>setTimeout(r,2500));
const mcp={mcpServers:{cua_repl:{type:'stdio',command:process.execPath,args:[root+'cua-shim.mjs'],env:{CUA_SHIM_CODEX_HOME:HOME,CUA_SHIM_LOG:root+'fixtures/'+NAME+'.shim.jsonl'}}}};
const p=new Probe(NAME,{dir:'../computer-use-probe/fixtures/',bin:BIN,model:process.env.PROBE_MODEL||'sonnet',cwd:mkdtempSync('/tmp/maws-cc-cwd-'),flags:['--mcp-config',JSON.stringify(mcp),'--max-budget-usd','3.00']});
const counts={elicitations:0,accepted:0,escalations:0,allowed:0,toolUses:[],images:0};
p.on('elicitation',r=>{counts.elicitations++;const ok=/TextEdit/.test(r.message);if(ok)counts.accepted++;p.note({event:'elicitation',accept:ok,message:r.message,server:r.mcp_server_name});return ok?{action:'accept',content:{}}:{action:'decline'};});
p.on('can_use_tool',r=>{counts.escalations++;const ok=/^mcp__cua_repl__/.test(r.tool_name);if(ok)counts.allowed++;p.note({event:'escalation',tool:r.tool_name,allow:ok});return ok?{behavior:'allow',updatedInput:r.input}:{behavior:'deny',message:'Only the cua_repl tools are allowed in this probe.'};});
await p.init({});
const after=p.seq;
p.user(`TextEdit is already open with the document ${DOC}. Using only the cua_repl tools: read the document's current state, click into its text area, move to the end of the document and type " Hello from Claude Code." (with the leading space), save with cmd+s, then take a screenshot and describe in one sentence what the screenshot shows. Finally quit TextEdit with cmd+q. Use no app other than TextEdit and no tool other than cua_repl.`);
const result=await p.wait(f=>f.type==='result',{after,timeout:900000});
for(const row of p.frames){const m=row.frame;if(m.type==='assistant')for(const b of m.message?.content??[])if(b.type==='tool_use')counts.toolUses.push({name:b.name,title:b.input?.title,code:(b.input?.code??'').slice(0,160)});
 if(m.type==='user')for(const b of m.message?.content??[])if(b.type==='tool_result'&&Array.isArray(b.content))counts.images+=b.content.filter(c=>c.type==='image').length;}
await p.stop();
const sess=HOME+'/computer-use/sessions';
console.log(JSON.stringify({session:p.sessionId,subtype:result.subtype,turns:result.num_turns,cost:result.total_cost_usd,durationMs:result.duration_ms,elicitations:counts.elicitations,accepted:counts.accepted,escalations:counts.escalations,allowed:counts.allowed,toolUseCount:counts.toolUses.length,imagesToModel:counts.images,
 approvals:existsSync(sess)?readdirSync(sess).map(f=>f+' → '+readFileSync(sess+'/'+f,'utf8').replace(/\s+/g,' ')):'none',doc:readFileSync(DOC,'utf8'),textEditRunning:sh('osascript',['-e','tell application "System Events" to (name of processes whose name is "TextEdit")'])||'no'},null,1));
console.log('--- tool uses');for(const t of counts.toolUses)console.log(' ',t.name,'|',t.title,'|',t.code.replace(/\n/g,' ⏎ '));
console.log('--- final assistant text\n'+(typeof result.result==='string'?result.result:JSON.stringify(result.result)).slice(0,1500));
