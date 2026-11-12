// UX wave, U8 folder probe, terminal half: the headless half's steps (uxwave-folder.mjs) typed into an interactive
// engine under tmux, with only the transcript file to read. Run through vm-run.sh like a scenario:
//   ./vm-run.sh --prefix pz --out /tmp/pz-out run scenarios/pass3/uxwave-folder-terminal.mjs
// It starts the engine itself in tmux, as `vm-run.sh term` does (same engine, same scratch HOME and trusted work/, the
// same namespace), with the owner's user settings of uxwave-common.mjs written to the scratch HOME's settings.json, and
// the terminal's own setting sources and entrypoint. The fixture (fixtures/pass3/uxwave/uxwave-folder-terminal.jsonl)
// holds per step the prompt, the pane's last lines, any dialog answered, and the transcript rows the step added (as the
// headless half's step_record does); then the engine is ended with /exit and started again with --resume for one step.
import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync,readdirSync,appendFileSync,writeFileSync,mkdirSync,statSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {writeUserSettings,ENGINE,WORK} from './uxwave-common.mjs';
const HERE=new URL('../..',import.meta.url).pathname;
const OUT=(process.env.PROBE_FIXTURE_ROOT||HERE).replace(/\/?$/,'/')+'fixtures/pass3/uxwave/';mkdirSync(OUT,{recursive:true});
const FILE=OUT+'uxwave-folder-terminal.jsonl';writeFileSync(FILE,'');let seq=0;
const note=frame=>appendFileSync(FILE,JSON.stringify({seq:++seq,direction:'meta',at:new Date().toISOString(),frame})+'\n');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const MODEL=process.env.PZ_MODEL||'haiku';
const tmux=(name,...a)=>execFileSync('tmux',['-L',name,...a],{encoding:'utf8'});
const pane=name=>tmux(name,'capture-pane','-p','-t',name);
const rows=f=>existsSync(f)?readFileSync(f,'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l);}catch{return {unparsed:true};}}):[];
const pick=(o,ks)=>Object.fromEntries(ks.filter(k=>o?.[k]!==undefined).map(k=>[k,o[k]]));
function rowView(r,i){const c=r.message?.content;const blocks=Array.isArray(c)?c:[];return {i,...pick(r,['type','subtype','cwd','gitBranch','isSidechain','agentId','worktreeSession','relocatedCwd','sessionId']),...(r.attachment?{attachment:pick(r.attachment,['type','hookEvent'])}:{}),...(blocks.some(b=>b.type==='tool_use')?{toolUse:blocks.filter(b=>b.type==='tool_use').map(b=>({name:b.name,input:b.input}))}:{}),...(r.toolUseResult&&typeof r.toolUseResult==='object'?{toolUseResult:pick(r.toolUseResult,['worktreePath','worktreeBranch','message','action','originalCwd','stdout','agentId','status'])}:{})};}
function listJsonl(d){const out=[];if(!existsSync(d))return out;for(const n of readdirSync(d)){const f=join(d,n);if(statSync(f).isDirectory())out.push(...listJsonl(f));else if(n.endsWith('.jsonl'))out.push(f);}return out;}
async function main(){
 const name='pz-term';const root=process.env.PROBE_ROOT;
 const settings=writeUserSettings();
 const start=(extra)=>{try{execFileSync('tmux',['-L',name,'kill-server'],{stdio:'ignore'});}catch{}execFileSync('tmux',['-L',name,'new-session','-d','-s',name,'-x','160','-y','48','-c',WORK,'env','TERM=xterm-256color',ENGINE,'--model',MODEL,...extra]);note({event:'term_launch',engine:ENGINE,args:['--model',MODEL,...extra],cwd:WORK,userSettings:settings,launcher:'tmux, as vm-run.sh term'});};
 const seen=new Map();
 const snapshot=()=>{const base=join(root,'home/.claude/projects');const out=[];for(const f of listJsonl(base)){const all=rows(f);const from=seen.get(f)??0;seen.set(f,all.length);if(all.length>from)out.push({file:f.slice(base.length+1),total:all.length,added:all.slice(from).map((r,k)=>rowView(r,from+k))});}return out;};
 const mainFile=()=>{const base=join(root,'home/.claude/projects');return listJsonl(base).filter(f=>!f.includes('/subagents/')).sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs)[0];};
 const waitReady=async()=>{for(let i=0;i<60;i++){const t=pane(name);if(/auto mode on|\? for shortcuts|bypass|accept edits/.test(t)&&!/esc to interrupt/.test(t))return t;await sleep(1000);}return pane(name);};
 const step=async(label,prompt)=>{note({event:'step',name:label,prompt});
  tmux(name,'send-keys','-t',name,'-l',prompt);await sleep(500);tmux(name,'send-keys','-t',name,'Enter');
  const dialogs=[];const t0=Date.now();let quiet=0,lastSize=-1;
  while(Date.now()-t0<240000){await sleep(1500);const t=pane(name);
   if(/Do you want to|❯ 1\. Yes/.test(t)&&!/esc to interrupt/.test(t.split('\n').slice(-3).join('\n'))){dialogs.push(t.split('\n').filter(l=>l.trim()).slice(-12).join('\n'));tmux(name,'send-keys','-t',name,'Enter');await sleep(1000);continue;}
   const f=mainFile();const size=f?statSync(f).size:0;const all=f?rows(f):[];const last=[...all].reverse().find(r=>r.type==='assistant'||r.type==='user');
   const done=last?.type==='assistant'&&last.message?.stop_reason==='end_turn'&&!/esc to interrupt/.test(t);
   if(done&&size===lastSize){if(++quiet>=2)break;}else quiet=0;lastSize=size;}
  const t=pane(name);note({event:'step_record',name:label,elapsedMs:Date.now()-t0,dialogs,pane:t.split('\n').filter(l=>l.trim()).slice(-16),transcript:snapshot(),worktrees:execFileSync('git',['-C',WORK,'worktree','list'],{encoding:'utf8'}).trim().split('\n')});
  console.log(label,Date.now()-t0,'ms',dialogs.length,'dialogs');};
 start([]);
 // the same seed as the headless half: a sub/ folder and an ignore line for .claude/worktrees
 const W=WORK;mkdirSync(W+'/sub',{recursive:true});writeFileSync(W+'/sub/two.txt','TWO\n');writeFileSync(W+'/.gitignore','.claude/worktrees/\n');execFileSync('git',['-C',W,'add','-A']);execFileSync('git',['-C',W,'-c','user.name=Probe','-c','user.email=probe@localhost','commit','-qm','sub']);
 note({event:'ready_pane',pane:(await waitReady()).split('\n').filter(l=>l.trim()).slice(-8)});
 const S=[
  ['s0-start','Reply with only the word ready'],
  ['s1-enter-worktree','Call the EnterWorktree tool with name "pz-alpha". Do nothing else, then reply OK.'],
  ['s2-run-there','Run this in Bash and reply with its output: pwd; git branch --show-current'],
  ['s3-exit-keep','Call the ExitWorktree tool with action "keep". Then reply OK.'],
  ['s3b-run-after-exit','Run this in Bash and reply with its output: pwd; git branch --show-current'],
  ['s4-cd-second-worktree','Run exactly this one command in Bash and reply with its output: git worktree add -q -b pz-beta .claude/worktrees/pz-beta && cd .claude/worktrees/pz-beta && pwd'],
  ['s4b-run-after-cd','Run this in Bash and reply with its output: pwd; git branch --show-current'],
  ['s5-cd-subfolder','Run exactly this one command in Bash and reply with its output: cd sub && pwd'],
  ['s5b-run-after-subfolder','Run this in Bash and reply with its output: pwd; git branch --show-current'],
  ['s6-cd-sibling-outside',`Run exactly this one command in Bash and reply with its output: git worktree add -q -b pz-gamma ${W}-gamma && cd ${W}-gamma && pwd`],
  ['s6b-run-after-sibling','Run this in Bash and reply with its output: pwd; git branch --show-current'],
  ['s7-subagent-enters-worktree','Use the Agent tool (subagent_type "general-purpose") with this exact prompt: "Call the EnterWorktree tool with name pz-sub. Then run pwd; git branch --show-current in Bash and reply with what it printed." When it finishes, reply with what the agent answered.'],
  ['s7b-main-after-subagent','Run this in Bash and reply with its output: pwd; git branch --show-current'],
 ];
 for(const [l,p] of S)await step(l,p);
 const sid=mainFile().match(/([0-9a-f-]{36})\.jsonl$/)[1];note({event:'session',sessionId:sid,file:mainFile().slice(root.length)});
 tmux(name,'send-keys','-t',name,'-l','/exit');await sleep(300);tmux(name,'send-keys','-t',name,'Enter');await sleep(5000);try{tmux(name,'kill-server');}catch{}
 note({event:'ended',transcript:snapshot()});
 start(['--resume',sid]);note({event:'resume_pane',pane:(await waitReady()).split('\n').filter(l=>l.trim()).slice(-12)});
 await step('s9-after-resume','Run this in Bash and reply with its output: pwd; git branch --show-current');
 tmux(name,'send-keys','-t',name,'-l','/exit');await sleep(300);tmux(name,'send-keys','-t',name,'Enter');await sleep(4000);try{tmux(name,'kill-server');}catch{}
 note({event:'ended',transcript:snapshot()});
}
main().catch(e=>{note({event:'scenario_error',error:e.stack});console.error(e);process.exit(1);});
