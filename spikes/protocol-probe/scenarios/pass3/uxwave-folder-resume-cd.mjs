// UX wave, U8 folder probe, one more control: a session whose main loop moved by a shell `cd` into a second worktree
// (not by EnterWorktree) is ended there and resumed from the launch folder, as MAWS resumes it. Does the resume put the
// main loop back where the cd left it? The init frame's cwd and the rows after the resume answer it.
import {mawsLaunch,transcriptFiles,rows,answer,WORK,join,writeFileSync} from './uxwave-common.mjs';
import {execFileSync} from 'node:child_process';
import {dirname,basename} from 'node:path';
const git=(...a)=>execFileSync('git',['-C',WORK,...a],{encoding:'utf8'}).trim();
const tail=sid=>transcriptFiles(sid).map(f=>{const all=rows(f);return {folder:basename(dirname(f)),rows:all.length,last:all.slice(-12).filter(r=>r.cwd||r.type==='relocated'||r.type==='worktree-state').map(r=>({type:r.type,cwd:r.cwd,gitBranch:r.gitBranch,relocatedCwd:r.relocatedCwd,worktreeSession:r.worktreeSession===undefined?undefined:!!r.worktreeSession}))};});
export default async()=>{
 writeFileSync(join(WORK,'.gitignore'),'.claude/worktrees/\n');git('add','-A');git('-c','user.name=Probe','-c','user.email=probe@localhost','commit','-qm','ignore');
 git('worktree','add','-q','-b','pz-beta',join(WORK,'.claude/worktrees/pz-beta'));
 let sid;
 await mawsLaunch('uxwave-folder-resume-cd',{},async p=>{
  const r=await p.turn('Run exactly this one command in Bash and reply with its output: cd .claude/worktrees/pz-beta && pwd');
  const r2=await p.turn('Run this in Bash and reply with its output: pwd; git branch --show-current');
  sid=p.sessionId;p.note({event:'before_end',answer:answer(p),files:tail(sid)});console.log('before',JSON.stringify(answer(p)));
 });
 await mawsLaunch('uxwave-folder-resume-cd-resume',{flags:['--resume',sid]},async p=>{
  await p.turn('Run this in Bash and reply with its output: pwd; git branch --show-current');
  const init=p.frames.find(x=>x.frame.type==='system'&&x.frame.subtype==='init');
  p.note({event:'after_resume',initSeq:init?.seq,initCwd:init?.frame.cwd,answer:answer(p),files:tail(sid)});console.log('after',init?.frame.cwd,JSON.stringify(answer(p)));
 });
};
