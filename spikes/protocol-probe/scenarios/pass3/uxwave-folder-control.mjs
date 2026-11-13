// UX wave, U8 folder probe, controls for the headless half (uxwave-folder.mjs):
//  (1) CwdChanged: the headless run's callback registered at initialize was never called. This launch registers the
//      same callback and also a settings command hook for CwdChanged (through the launch's --settings object, beside
//      MAWS's dialogExpiry), which appends its input to $PROBE_ROOT/cwd-hook.log; the steps are a shell cd into a
//      worktree made beforehand, a cd back, and EnterWorktree.
//  (2) Stop and resume from inside a worktree: the session is ended while its main loop is in the EnterWorktree
//      worktree, then resumed twice: from the launch folder (where MAWS resumes a session it launched) and from the
//      worktree's folder; each resume's init frame, first rows and files are recorded.
import {mawsLaunch,transcriptFiles,rows,listTree,answer,WORK,join,existsSync,readFileSync,writeFileSync,mkdirSync} from './uxwave-common-folder-memory.mjs';
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import {dirname,basename} from 'node:path';
const git=(...a)=>execFileSync('git',['-C',WORK,...a],{encoding:'utf8'}).trim();
const LOG=process.env.PROBE_ROOT+'/cwd-hook.log';
const HOOKS={CwdChanged:[{hookCallbackIds:['pz_cwd_changed']}]};
const SETTINGS={dialogExpiry:'never',hooks:{CwdChanged:[{hooks:[{type:'command',command:`cat >> ${LOG}; echo >> ${LOG}`}]}]}};
const pick=(o,ks)=>Object.fromEntries(ks.filter(k=>o?.[k]!==undefined).map(k=>[k,o[k]]));
const view=(r,i)=>({i,...pick(r,['type','cwd','gitBranch','isSidechain','relocatedCwd']),...(r.worktreeSession!==undefined?{worktreeSession:r.worktreeSession&&pick(r.worktreeSession,['worktreePath','worktreeBranch','originalCwd'])}:{})});
const files=sid=>transcriptFiles(sid).map(f=>({folder:basename(dirname(f)),rows:rows(f).length}));
export default async()=>{
 mkdirSync(join(WORK,'sub'),{recursive:true});writeFileSync(join(WORK,'sub/two.txt'),'TWO\n');writeFileSync(join(WORK,'.gitignore'),'.claude/worktrees/\n');
 git('add','-A');git('-c','user.name=Probe','-c','user.email=probe@localhost','commit','-qm','sub');git('worktree','add','-q','-b','pz-beta',join(WORK,'.claude/worktrees/pz-beta'));
 let sid;
 const step=async(p,name,prompt)=>{const from=p.seq;p.note({event:'step',name,prompt});const r=await p.turn(prompt);const log=existsSync(LOG)?readFileSync(LOG,'utf8'):'';
  const hooks=p.frames.filter(x=>x.seq>from&&((x.frame.type==='system'&&/^hook_/.test(x.frame.subtype)&&x.frame.hook_event_name==='CwdChanged')||(x.frame.type==='control_request'&&x.frame.request?.subtype==='hook_callback'))).map(x=>({seq:x.seq,type:x.frame.type,subtype:x.frame.subtype??x.frame.request.subtype}));
  const init=p.frames.filter(x=>x.seq>from&&x.frame.type==='system'&&x.frame.subtype==='init').map(x=>({seq:x.seq,cwd:x.frame.cwd}));
  p.note({event:'step_record',name,seqFrom:from+1,seqTo:p.seq,answer:answer(p),init,cwdHookFrames:hooks,cwdHookLog:log.split('\n').filter(Boolean).map(l=>{try{return pick(JSON.parse(l),['hook_event_name','old_cwd','new_cwd','cwd']);}catch{return l.slice(0,200);}}),files:files(p.sessionId)});
  console.log(name,JSON.stringify(answer(p)).slice(0,100),'hookFrames',hooks.length,'log',log.split('\n').filter(Boolean).length);};
 await mawsLaunch('uxwave-folder-control',{hooks:HOOKS,flagSettings:SETTINGS},async p=>{
  p.note({event:'control_settings',settings:SETTINGS});
  await step(p,'c1-cd-into-worktree','Run exactly this one command in Bash and reply with its output: cd .claude/worktrees/pz-beta && pwd');
  await step(p,'c2-cd-back',`Run exactly this one command in Bash and reply with its output: cd ${WORK} && pwd`);
  await step(p,'c3-enter-worktree','Call the EnterWorktree tool with name "pz-alpha". Do nothing else, then reply OK.');
  await step(p,'c4-run-there','Run this in Bash and reply with its output: pwd; git branch --show-current');
  sid=p.sessionId;
 });
 for(const [label,cwd] of [['from-launch-folder',WORK],['from-worktree',join(WORK,'.claude/worktrees/pz-alpha')]]){
  const before=files(sid);
  await mawsLaunch('uxwave-folder-control-resume-'+label,{cwd,hooks:HOOKS,flags:['--resume',sid]},async p=>{
   p.note({event:'resume_of',sessionId:sid,cwd,filesBefore:before});
   await step(p,'r-'+label,'Run this in Bash and reply with its output: pwd; git branch --show-current');
   const fs=transcriptFiles(sid);p.note({event:'resume_rows',files:fs.map(f=>{const all=rows(f);return {folder:basename(dirname(f)),rows:all.length,last:all.slice(-40).map((r,k)=>view(r,all.length-40+k)).filter(v=>v.cwd||v.type==='relocated'||v.type==='worktree-state')};})});
  });
 }
};
