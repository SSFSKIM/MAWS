// UX wave, U8 probe "What does engine 2.1.322 report when the agent changes folder?" (l5-code-14, UC-4), headless half.
// One session launched as MAWS launches it (uxwave-common.mjs), with a CwdChanged hook callback registered at
// initialize, walks through the moves the spec lists, one turn per step; after each step a `step_record` note keeps what
// the four readers need: the wire's frames of the step (by seq range), the hook callbacks, and the transcript rows the
// step added (every file of the session id, every project folder, the subagent files). Then the session is stopped and
// resumed. PZ_MODEL picks the main loop's model (default haiku); the subagent runs on the owner's subagent model.
import {mawsLaunch,transcriptFiles,rows,listTree,answer,WORK,join,existsSync,writeFileSync,mkdirSync} from './uxwave-common.mjs';
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import {dirname,basename} from 'node:path';
const git=(...a)=>execFileSync('git',['-C',WORK,...a],{encoding:'utf8'}).trim();
const MODEL=process.env.PZ_MODEL||'haiku';
const HOOKS={CwdChanged:[{hookCallbackIds:['pz_cwd_changed']}]};
const pick=(o,ks)=>Object.fromEntries(ks.filter(k=>o?.[k]!==undefined).map(k=>[k,o[k]]));
function rowView(r,i){const c=r.message?.content;const blocks=Array.isArray(c)?c:[];return {i,...pick(r,['type','subtype','cwd','gitBranch','isSidechain','agentId','worktreeSession','relocatedCwd','sessionId']),...(r.attachment?{attachment:pick(r.attachment,['type','hookEvent','hookName'])}:{}),...(blocks.some(b=>b.type==='tool_use')?{toolUse:blocks.filter(b=>b.type==='tool_use').map(b=>({name:b.name,input:b.input}))}:{}),...(r.toolUseResult&&typeof r.toolUseResult==='object'?{toolUseResult:pick(r.toolUseResult,['worktreePath','worktreeBranch','message','action','originalCwd','stdout','agentId','status'])}:{})};}
export default async()=>{
 mkdirSync(join(WORK,'sub'),{recursive:true});writeFileSync(join(WORK,'sub/two.txt'),'TWO\n');writeFileSync(join(WORK,'.gitignore'),'.claude/worktrees/\n');
 git('add','-A');git('-c','user.name=Probe','-c','user.email=probe@localhost','commit','-qm','sub');
 const seen=new Map(); // file -> rows already reported
 const snapshot=(p,sid)=>{const out=[];const base=join(homedir(),'.claude/projects');for(const f of transcriptFiles(sid)){const all=rows(f);const from=seen.get(f)??0;seen.set(f,all.length);out.push({file:f.slice(base.length+1),total:all.length,added:all.slice(from).map((r,k)=>rowView(r,from+k))});const sd=join(dirname(f),sid,'subagents');for(const n of listTree(sd).filter(n=>n.endsWith('.jsonl'))){const sf=join(sd,n);const sa=rows(sf);const sfrom=seen.get(sf)??0;seen.set(sf,sa.length);out.push({file:sf.slice(base.length+1),total:sa.length,added:sa.slice(sfrom).map((r,k)=>rowView(r,sfrom+k))});}}return out;};
 const projects=()=>listTree(join(homedir(),'.claude/projects')).filter(n=>!n.includes('/'));
 let sid;
 const step=async(p,name,prompt)=>{const from=p.seq;p.note({event:'step',name,prompt});const r=await p.turn(prompt);
  const wire=p.frames.filter(x=>x.seq>from).filter(x=>{const f=x.frame;return (f.type==='system'&&!['stream_event'].includes(f.subtype))||(f.type==='user'&&f.tool_use_result)||f.type==='control_request';}).map(x=>({seq:x.seq,type:x.frame.type,subtype:x.frame.subtype??x.frame.request?.subtype,...pick(x.frame,['cwd','kind','branch','hook_event_name','hook_name','task_id','status','model']),...(x.frame.tool_use_result&&typeof x.frame.tool_use_result==='object'?{tool_use_result:pick(x.frame.tool_use_result,['worktreePath','worktreeBranch','message','action','originalCwd','stdout','agentId','status'])}:{}),...(x.frame.request?.subtype==='hook_callback'?{hook:pick(x.frame.request.input,['hook_event_name','old_cwd','new_cwd','agent_id'])}:{})}));
  p.note({event:'step_record',name,seqFrom:from+1,seqTo:p.seq,answer:answer(p),result:{subtype:r.subtype,is_error:r.is_error},wire,transcript:snapshot(p,p.sessionId),projectFolders:projects(),worktrees:git('worktree','list','--porcelain').split('\n').filter(l=>l.startsWith('worktree ')||l.startsWith('branch '))});
  console.log(name,JSON.stringify(answer(p)).slice(0,160));};
 await mawsLaunch('uxwave-folder-headless',{model:MODEL,hooks:HOOKS},async p=>{
  await step(p,'s0-start','Reply with only the word ready');
  await step(p,'s1-enter-worktree','Call the EnterWorktree tool with name "pz-alpha". Do nothing else, then reply OK.');
  await step(p,'s2-run-there','Run this in Bash and reply with its output: pwd; git branch --show-current');
  await step(p,'s3-exit-keep','Call the ExitWorktree tool with action "keep". Then reply OK.');
  await step(p,'s3b-run-after-exit','Run this in Bash and reply with its output: pwd; git branch --show-current');
  await step(p,'s4-cd-second-worktree','Run exactly this one command in Bash and reply with its output: git worktree add -q -b pz-beta .claude/worktrees/pz-beta && cd .claude/worktrees/pz-beta && pwd');
  await step(p,'s4b-run-after-cd','Run this in Bash and reply with its output: pwd; git branch --show-current');
  await step(p,'s5-cd-subfolder','Run exactly this one command in Bash and reply with its output: cd sub && pwd');
  await step(p,'s5b-run-after-subfolder','Run this in Bash and reply with its output: pwd; git branch --show-current');
  await step(p,'s6-cd-sibling-outside',`Run exactly this one command in Bash and reply with its output: git worktree add -q -b pz-gamma ${WORK}-gamma && cd ${WORK}-gamma && pwd`);
  await step(p,'s6b-run-after-sibling','Run this in Bash and reply with its output: pwd; git branch --show-current');
  await step(p,'s7-subagent-enters-worktree','Use the Agent tool (subagent_type "general-purpose") with this exact prompt: "Call the EnterWorktree tool with name pz-sub. Then run pwd; git branch --show-current in Bash and reply with what it printed." When it finishes, reply with what the agent answered.');
  await step(p,'s7b-main-after-subagent','Run this in Bash and reply with its output: pwd; git branch --show-current');
  await step(p,'s8-subagent-isolation','Use the Agent tool with subagent_type "general-purpose" and isolation "worktree", with this exact prompt: "Run pwd; git branch --show-current in Bash and reply with what it printed." When it finishes, reply with what the agent answered.');
  await step(p,'s8b-main-after-isolated','Run this in Bash and reply with its output: pwd; git branch --show-current');
  sid=p.sessionId;
 });
 await mawsLaunch('uxwave-folder-headless-resume',{model:MODEL,hooks:HOOKS,flags:['--resume',sid]},async p=>{
  p.note({event:'resume_of',sessionId:sid,files:transcriptFiles(sid).map(f=>basename(dirname(f)))});
  await step(p,'s9-after-resume','Run this in Bash and reply with its output: pwd; git branch --show-current');
  const init=p.frames.find(x=>x.frame.type==='system'&&x.frame.subtype==='init');p.note({event:'resume_init',seq:init?.seq,cwd:init?.frame.cwd});
 });
};
