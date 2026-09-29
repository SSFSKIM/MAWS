// W3-2: a harder in-envelope task (menu-bar navigation and multi-step observation) plus the Stop → turn_ended
// mcp_tool hook, under Claude Code 2.1.283 headless with cua-shim.mjs. TextEdit only.
import {Probe} from '../protocol-probe/harness.mjs';
import {root} from './mcp-client.mjs';
import {execFileSync} from 'node:child_process';
import {writeFileSync,readFileSync,existsSync,readdirSync,mkdtempSync} from 'node:fs';
for(const k of Object.keys(process.env))if(/^CMUX_/.test(k)||['CLAUDE_CODE_SESSION_ID','CLAUDE_CODE_CHILD_SESSION','CLAUDE_CODE_SESSION_ATTENDED','CLAUDE_PID','CLAUDE_CODE_MESSAGING_SOCKET','CLAUDE_CODE_MESSAGING_TOKEN','CLAUDE_CODE_EXECPATH','CLAUDE_EFFORT'].includes(k))delete process.env[k];
const BIN='/Users/new/.local/share/claude/versions/2.1.283', HOME='/tmp/maws-cu-probe/cc-home', DOC='/tmp/maws-cu-probe/textedit-probe.rtf', NAME='w3-claude-code-host-2';
const sh=(c,a)=>{try{return execFileSync(c,a,{encoding:'utf8'}).trim();}catch(e){return 'ERR '+e.message.split('\n')[0];}};
// An RTF document, so the Format menu's font commands apply and the result is verifiable on disk.
writeFileSync(DOC,'{\\rtf1\\ansi{\\fonttbl\\f0\\fswiss Helvetica;}\\f0\\fs28 First line of the probe.\\par Second line stays plain.\\par}');
execFileSync('open',['-g','-a','TextEdit',DOC]);await new Promise(r=>setTimeout(r,2500));
const mcp={mcpServers:{cua_repl:{type:'stdio',command:process.execPath,args:[root+'../../plugins/cua/cua-shim.mjs'],env:{CUA_SHIM_CODEX_HOME:HOME,CUA_SHIM_LOG:root+'fixtures/'+NAME+'.shim.jsonl'}}}};
const settings={hooks:{Stop:[{hooks:[{type:'mcp_tool',server:'cua_repl',tool:'turn_ended',input:{hook_event_name:'Stop',session_id:'${session_id}',turn_id:'${prompt_id}'},timeout:30}]}]}};
const p=new Probe(NAME,{dir:'../computer-use-probe/fixtures/',bin:BIN,model:process.env.PROBE_MODEL||'sonnet',cwd:mkdtempSync('/tmp/maws-cc-cwd-'),flags:['--mcp-config',JSON.stringify(mcp),'--settings',JSON.stringify(settings),'--include-hook-events','--max-budget-usd','4.00']});
const counts={elicitations:0,accepted:0,escalations:0,allowed:0,toolUses:[],images:0,hookEvents:[]};
p.on('elicitation',r=>{counts.elicitations++;const ok=/TextEdit/.test(r.message);if(ok)counts.accepted++;p.note({event:'elicitation',accept:ok,message:r.message});return ok?{action:'accept',content:{}}:{action:'decline'};});
p.on('can_use_tool',r=>{counts.escalations++;const ok=/^mcp__cua_repl__/.test(r.tool_name);if(ok)counts.allowed++;p.note({event:'escalation',tool:r.tool_name,allow:ok});return ok?{behavior:'allow',updatedInput:r.input}:{behavior:'deny',message:'Only the cua_repl tools are allowed in this probe.'};});
await p.init({});
const after=p.seq;
p.user(`TextEdit is already open with the rich-text document ${DOC}. Using only the cua_repl tools: select all of the first line ("First line of the probe.") and make it bold using TextEdit's Format menu in the menu bar (Format > Font > Bold), leaving the second line plain. Then read the accessibility state to confirm, save with cmd+s, and quit TextEdit with cmd+q. Report which menu items you used. Use no app other than TextEdit and no tool other than cua_repl.`);
const result=await p.wait(f=>f.type==='result',{after,timeout:900000});
for(const row of p.frames){const m=row.frame;if(m.type==='assistant')for(const b of m.message?.content??[])if(b.type==='tool_use')counts.toolUses.push({name:b.name,title:b.input?.title,code:(b.input?.code??'').slice(0,200)});
 if(m.type==='user'&&Array.isArray(m.message?.content))for(const b of m.message.content)if(b.type==='tool_result'&&Array.isArray(b.content))counts.images+=b.content.filter(c=>c.type==='image').length;
 if(m.type==='system'&&/^hook_/.test(m.subtype||''))counts.hookEvents.push({subtype:m.subtype,event:m.hook_event||m.hook_event_name,name:m.hook_name,ok:m.success??m.exit_code});}
await p.stop();
const sess=HOME+'/computer-use/sessions';const rtf=readFileSync(DOC,'utf8');
console.log(JSON.stringify({session:p.sessionId,subtype:result.subtype,turns:result.num_turns,cost:result.total_cost_usd,durationMs:result.duration_ms,elicitations:counts.elicitations,accepted:counts.accepted,escalations:counts.escalations,allowed:counts.allowed,toolUseCount:counts.toolUses.length,imagesToModel:counts.images,hookEvents:counts.hookEvents,
 approvals:existsSync(sess)?readdirSync(sess):'none',rtfHasBold:/\\b[ \\]/.test(rtf)||/\\b\b/.test(rtf),rtfExcerpt:rtf.slice(-260),textEditRunning:sh('osascript',['-e','tell application "System Events" to (name of processes whose name is "TextEdit")'])||'no'},null,1));
console.log('--- tool uses');for(const t of counts.toolUses)console.log(' ',t.name,'|',t.title,'|',t.code.replace(/\n/g,' ⏎ '));
console.log('--- final assistant text\n'+(typeof result.result==='string'?result.result:JSON.stringify(result.result)).slice(0,1800));
