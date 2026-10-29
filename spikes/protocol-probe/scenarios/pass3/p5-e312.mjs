// P5, the engine the owner runs (2026-10-29; charter D-1 as amended 2026-10-01, W13; findings-p5-e312-engine.txt):
// the `system/*` frames a MAWS launch receives in normal use that MAWS had no mapping for, recorded on the target engine
// through MAWS's own launch line and initialize payload (p1-common: a scratch config home, the relay, the probe's spend
// cap). Each arm drives the engine to the condition its schema documents and notes what arrived:
//   title       l1: a turn, `rename_session` (MAWS's Rename), `generate_session_title` with persist, `/rename <name>` as
//               a prompt; for each name, when the `custom-title` record reached the transcript against the frame's
//               arrival (C4's title rule reads that record). l2: `--resume` of the named session: the name at startup.
//   vcs         a Bash `git commit`, a `git push` to a scratch bare remote, and `gh pr create` against a stand-in `gh`
//               on PATH that prints a pull request URL: `vcs_state_changed` and `code_change_published`.
//   auto        auto mode on a model that runs it, four Bash commands the classifier judges: `permission_check_status`
//               arrives only when a check waits longer than about four seconds, so its absence proves nothing.
//   fallback    `--model` naming no model with `--fallback-model haiku`: `model_fallback` (trigger model_not_found).
//   memory      auto memory on, one memory file whose topic the prompt asks about: `memory_recall` when the selector
//               surfaces it (behind the engine's own gates).
//   devintent   the session's repository holds an Xcode project for iOS at its root: `dev_intent` (ios_app,
//               project_scan) from the scan a headless session starts.
// Run where an engine run cannot reach the owner's Keychain (P5 Decision Log 29), with a relay answering on 127.0.0.1:8641:
//   PROBE_ENGINE=~/.local/share/claude/versions/2.1.312 [E312_ARM=title,vcs,…] node run-pass3.mjs p5-e312
import {launch,scratchRun,removeRun,initPayload,success,check,endAsStop,delay,transcriptPath,ENGINE_VERSION,join,writeFileSync,mkdirSync,records,slug} from './p1-common.mjs';
import {allowAll} from './e7-common.mjs';
import {execFileSync} from 'node:child_process';
import {chmodSync} from 'node:fs';

const PROVENANCE={child:'P5-E312',pin:'643eadf136ac70e93290d8b14ce58e8055330ddc',document:'docs/doperpowers/plans/2026-10-27-p5-org.md',findings:'spikes/protocol-probe/findings-p5-e312-engine.txt',spike:'normal-use frames on the engine the owner runs',engineVersion:ENGINE_VERSION};
const ARMS=(process.env.E312_ARM||'title,vcs,auto,fallback,memory,devintent').split(',');
const sys=(f,subtype)=>f.type==='system'&&f.subtype===subtype;
const frames=(p,subtype,after=0)=>p.frames.filter(r=>r.seq>after&&sys(r.frame,subtype));
const waitSys=(p,subtype,after,timeout=15000)=>p.wait(f=>sys(f,subtype),{after,timeout}).catch(()=>null);
const turn=async(p,text)=>{const after=p.seq;await p.turn(text);return after;};
const brief=(p,subtypes,after=0)=>p.frames.filter(r=>r.seq>after&&r.frame.type==='system'&&subtypes.includes(r.frame.subtype)).map(r=>({seq:r.seq,at:r.at,...r.frame}));

// When the name reached the transcript, against the frame's arrival: polled every 10 ms for up to 5 s from the frame.
async function diskLag(p,run,sessionId,title,frameAt){
 const file=transcriptPath(run,sessionId);
 const start=Date.now();
 while(Date.now()-start<5000){
  const hit=records(file).filter(r=>r.type==='custom-title').at(-1);
  if(hit?.customTitle===title)return {file:file.slice(run.root.length),present:true,msAfterFrame:Date.now()-Date.parse(frameAt),polls:'10ms'};
  await delay(10);
 }
 return {file:file.slice(run.root.length),present:false};
}

async function titleArm(){
 const run=scratchRun('e312-title');
 let sessionId;
 try{
  await launch('p5-e312-title',run,{provenance:PROVENANCE},async(p,{sessionId:id})=>{
   sessionId=id;
   success(await p.init(initPayload(run.cwd)),'initialize');
   await turn(p,'Reply with exactly OK');
   check(p,'no name before a rename',frames(p,'session_title_changed').length===0,frames(p,'session_title_changed').map(r=>r.frame));
   // MAWS's Rename (src/engine-host/controls.ts renameSession: `{title, source: 'host'}`)
   let after=p.seq;
   success(await p.request('rename_session',{title:'E312 probe name',source:'host'}),'rename_session');
   let frame=await waitSys(p,'session_title_changed',after);
   const renamed=frame&&{frame,disk:await diskLag(p,run,id,'E312 probe name',p.frames.find(r=>r.frame===frame).at)};
   p.note({event:'e312_rename',renamed});
   check(p,'rename_session sends the name',frame?.title==='E312 probe name',frame);
   // MAWS's Regenerate (session.generateTitle with persist): an AI title, which the frame does not carry
   after=p.seq;
   const generated=success(await p.request('generate_session_title',{description:'Probe of the engine frames',persist:true},60000),'generate_session_title');
   await delay(2000);
   p.note({event:'e312_generate',generated,frames:brief(p,['session_title_changed'],after)});
   // `/rename <name>` typed in the composer
   after=await turn(p,'/rename E312 slash name');
   frame=await waitSys(p,'session_title_changed',after,5000);
   const slash=frame&&{frame,disk:await diskLag(p,run,id,'E312 slash name',p.frames.find(r=>r.frame===frame).at)};
   p.note({event:'e312_slash_rename',slash,frames:brief(p,['session_title_changed','local_command_output','informational'],after)});
   await endAsStop(p);
  });
  await launch('p5-e312-title-resume',run,{provenance:PROVENANCE,pinned:false,flags:['--resume',sessionId]},async p=>{
   success(await p.init(initPayload(run.cwd)),'initialize');
   const named=await waitSys(p,'session_title_changed',0,10000);
   const init=p.frames.find(r=>sys(r.frame,'init'));
   p.note({event:'e312_resume_name',named,beforeInit:init?p.frames.find(r=>r.frame===named)?.seq<init.seq:null});
   await turn(p,'Reply with exactly OK');
   p.note({event:'e312_resume_frames',frames:brief(p,['session_title_changed'])});
   await endAsStop(p);
  });
 }finally{removeRun(run);}
}

async function vcsArm(){
 const run=scratchRun('e312-vcs');
 try{
  const bin=join(run.root,'bin');mkdirSync(bin);
  writeFileSync(join(bin,'gh'),'#!/bin/sh\n# the probe\'s stand-in: a created pull request\'s URL, as gh prints it\nif [ "$1 $2" = "pr create" ]; then echo "https://github.com/e312-probe/e312-repo/pull/7"; exit 0; fi\necho "gh stand-in: $*" >&2\nexit 1\n');
  chmodSync(join(bin,'gh'),0o755);
  execFileSync('git',['init','-q','--bare',join(run.root,'remote.git')]);
  execFileSync('git',['remote','add','origin',join(run.root,'remote.git')],{cwd:run.cwd});
  const vars={PATH:`${bin}:${process.env.PATH}`,GIT_AUTHOR_NAME:'Probe',GIT_AUTHOR_EMAIL:'probe@localhost',GIT_COMMITTER_NAME:'Probe',GIT_COMMITTER_EMAIL:'probe@localhost'};
  await launch('p5-e312-vcs',run,{provenance:PROVENANCE,vars},async p=>{
   allowAll(p);
   success(await p.init(initPayload(run.cwd)),'initialize');
   const ask=cmd=>`Run this exact command once with the Bash tool, then reply with exactly DONE: ${cmd}`;
   let after=await turn(p,ask('git commit --allow-empty -m e312-probe'));
   p.note({event:'e312_commit',frames:brief(p,['vcs_state_changed','code_change_published'],after)});
   after=await turn(p,ask('git push -u origin HEAD'));
   p.note({event:'e312_push',frames:brief(p,['vcs_state_changed','code_change_published'],after)});
   after=await turn(p,ask('gh pr create --title e312 --body e312'));
   await delay(2000);
   p.note({event:'e312_pr',frames:brief(p,['vcs_state_changed','code_change_published'],after)});
   await endAsStop(p);
  });
 }finally{removeRun(run);}
}

async function autoArm(){
 const run=scratchRun('e312-auto');
 try{
  await launch('p5-e312-auto',run,{provenance:PROVENANCE,model:'sonnet',flags:['--permission-mode','auto']},async p=>{
   allowAll(p);
   success(await p.init(initPayload(run.cwd)),'initialize');
   const after=await turn(p,'Use the Bash tool to run each of these commands, one call per command, in order, then reply with exactly DONE: `curl -s -o /dev/null -w "%{http_code}" https://example.com`, `git log --oneline -1`, `find . -maxdepth 1 -name "*.txt" -newer one.txt`, `printf probe > note.txt && wc -c note.txt`');
   p.note({event:'e312_auto',frames:brief(p,['permission_check_status','permission_denied','status'],after)});
   await endAsStop(p);
  });
 }finally{removeRun(run);}
}

async function fallbackArm(){
 const run=scratchRun('e312-fallback');
 try{
  await launch('p5-e312-fallback',run,{provenance:PROVENANCE,model:'claude-e312-no-such-model',flags:['--fallback-model','haiku']},async p=>{
   success(await p.init(initPayload(run.cwd)),'initialize');
   const after=await turn(p,'Reply with exactly OK');
   p.note({event:'e312_fallback',frames:brief(p,['model_fallback','model_consent_fallback','api_retry','informational'],after)});
   await endAsStop(p);
  });
 }finally{removeRun(run);}
}

async function memoryArm(){
 const run=scratchRun('e312-memory',{settings:{autoMemoryEnabled:true}});
 try{
  const dir=join(run.home,'projects',slug(run.cwd),'memory');mkdirSync(dir,{recursive:true});
  writeFileSync(join(dir,'favorite-color.md'),'---\nname: favorite color\ndescription: The user\'s favorite color, for questions about colors\ntype: user\n---\n\nThe user\'s favorite color is teal.\n');
  writeFileSync(join(dir,'MEMORY.md'),'- [favorite color](favorite-color.md): the user\'s favorite color\n');
  await launch('p5-e312-memory',run,{provenance:PROVENANCE},async p=>{
   success(await p.init(initPayload(run.cwd)),'initialize');
   const after=await turn(p,'What is my favorite color? Answer in one word.');
   p.note({event:'e312_memory',frames:brief(p,['memory_recall'],after)});
   await endAsStop(p);
  });
 }finally{removeRun(run);}
}

async function devIntentArm(){
 const run=scratchRun('e312-devintent');
 try{
  const project=join(run.cwd,'Probe.xcodeproj');mkdirSync(project);
  writeFileSync(join(project,'project.pbxproj'),'// !$*UTF8*$!\n{\n\tobjects = {\n\t\tE312 /* Debug */ = {\n\t\t\tisa = XCBuildConfiguration;\n\t\t\tbuildSettings = {\n\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = 17.0;\n\t\t\t\tSDKROOT = iphoneos;\n\t\t\t\tTARGETED_DEVICE_FAMILY = "1,2";\n\t\t\t};\n\t\t\tname = Debug;\n\t\t};\n\t};\n}\n');
  execFileSync('git',['add','Probe.xcodeproj'],{cwd:run.cwd});
  execFileSync('git',['-c','user.name=Probe','-c','user.email=probe@localhost','commit','-qm','xcode project'],{cwd:run.cwd});
  await launch('p5-e312-devintent',run,{provenance:PROVENANCE},async p=>{
   success(await p.init(initPayload(run.cwd)),'initialize');
   await waitSys(p,'dev_intent',0,10000);
   await turn(p,'Reply with exactly OK');
   p.note({event:'e312_devintent',frames:brief(p,['dev_intent'])});
   await endAsStop(p);
  });
 }finally{removeRun(run);}
}

const ARM_RUNS={title:titleArm,vcs:vcsArm,auto:autoArm,fallback:fallbackArm,memory:memoryArm,devintent:devIntentArm};
// Every arm runs; a failed one is logged as it fails and named in one error at the end, so the runner exits non-zero.
export default async()=>{const failed=[];for(const arm of ARMS){try{await ARM_RUNS[arm]();}catch(e){console.error('p5-e312',arm,e.message);failed.push(arm);}}if(failed.length>0)throw new Error('p5-e312: arms failed: '+failed.join(', '));};
