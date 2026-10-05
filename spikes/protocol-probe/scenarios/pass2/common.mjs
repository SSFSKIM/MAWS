// Pass-2 probe helpers. Child C2 of docs/charter.md; parent pins 32b75d61b572f51c53c4d9d3dd77672b39c1dd86 (dispatch) and 4ff2f2dfad428883691556a9765c324316069e7e (D-18 follow-up, item 13).
import {run as run1,scratch,Probe,root,delay} from '../../harness.mjs';
import {execFileSync} from 'node:child_process';
import {readdirSync,existsSync,realpathSync} from 'node:fs';
import {homedir} from 'node:os';
export {delay,Probe,root};
import {ENGINE_BIN,ENGINE_VERSION} from '../../../../test/support/engine-pin.ts'; // FX4: the resolved live engine (Node strips the types)
export const BIN=ENGINE_BIN;
export const PROVENANCE={engineVersion:ENGINE_VERSION,engineBin:ENGINE_BIN,charter:'docs/charter.md',child:'C2',pin:'32b75d61b572f51c53c4d9d3dd77672b39c1dd86',pinAutoMode:'4ff2f2dfad428883691556a9765c324316069e7e'};
import {appInitialize,DECLARED_DIALOG_KINDS} from '../../../../src/shared/engine/initialize.ts';
export const DIALOGS=DECLARED_DIALOG_KINDS;
// Parent-session and terminal-host variables a Dock-launched app would never have; scrubbed so the child is not mistaken for a nested or cmux-tracked session.
export const SCRUB=Object.keys(process.env).filter(k=>/^CMUX_/.test(k)||['CLAUDE_CODE_SESSION_ID','CLAUDE_CODE_CHILD_SESSION','CLAUDE_CODE_SESSION_ATTENDED','CLAUDE_PID','CLAUDE_CODE_MESSAGING_SOCKET','CLAUDE_CODE_MESSAGING_TOKEN','CLAUDE_CODE_EXECPATH','CLAUDE_EFFORT'].includes(k));
for(const k of SCRUB)delete process.env[k];
export const scratch2=()=>realpathSync(scratch('/tmp/maws-probe2-'));
let debugSeq=0;
export const options=(o={})=>{const {debug,...rest}=o;const out={dir:'fixtures/pass2/',bin:BIN,mode:'auto',cwd:o.cwd||scratch2(),...rest};if(debug){out.debugFile='/tmp/maws-probe2-debug-'+process.pid+'-'+(++debugSeq)+'.log';out.flags=[...(out.flags||[]),'--debug-file',out.debugFile];}return out;};
// Copies matching engine debug-log lines into the fixture as meta notes (the log itself stays in /tmp).
export function debugLines(p,re){const f=p.debugFile;if(!f||!existsSync(f))return p.note({event:'debug_lines',file:null});const lines=execFileSync('cat',[f],{encoding:'utf8'}).split('\n').filter(l=>re.test(l)).map(l=>l.slice(0,400));p.note({event:'debug_lines',count:lines.length,lines:lines.slice(0,80)});}
export const probe=(name,o)=>{const opts=options(o);const p=new Probe(name,opts);p.debugFile=opts.debugFile;p.note({event:'provenance',...PROVENANCE,scrubbedEnv:SCRUB});return p;};
export function run(name,fn,o={}){const opts=options(o);return run1(name,async p=>{p.debugFile=opts.debugFile;p.note({event:'provenance',...PROVENANCE,scrubbedEnv:SCRUB});p.on('request_user_dialog',r=>{p.note({event:'dialog_seen',kind:r.dialog_kind});return {behavior:'completed',result:'continue'};});p.on('elicitation',r=>{p.note({event:'elicitation_seen'});return {action:'decline'};});await fn(p);},opts);}
export const initPayload=(extra={})=>({...appInitialize(),...extra});
export function transcriptPath(sessionId){const base=homedir()+'/.claude/projects/';for(const d of readdirSync(base)){const f=base+d+'/'+sessionId+'.jsonl';if(existsSync(f))return f;}return null;}
export function jsonl(file){return file&&existsSync(file)?execFileSync('cat',[file],{encoding:'utf8'}).trim().split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l);}catch{return {unparsed:l.slice(0,80)};}}):[];}
export const summarizeRecord=r=>({type:r.type,subtype:r.subtype,uuid:r.uuid,parentUuid:r.parentUuid,sessionId:r.sessionId,isSidechain:r.isSidechain,rewound:r.rewound,lastPrompt:r.lastPrompt?String(r.lastPrompt).slice(0,60):undefined,text:typeof r.message?.content==='string'?r.message.content.slice(0,60):Array.isArray(r.message?.content)?r.message.content.map(b=>b.type==='text'?b.text.slice(0,60):b.type).join('|'):undefined});
export const bashAllow=p=>p.on('can_use_tool',r=>{p.note({event:'escalation',tool:r.tool_name,decision_reason_type:r.decision_reason_type,decision_reason:r.decision_reason,matched_ask_rule:r.matched_ask_rule});return {behavior:'allow',updatedInput:r.input};});
