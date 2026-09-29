// C10: fork a repository session from a linked worktree and inspect session, settings, and trust placement.
import {run,initPayload} from '../pass2/common.mjs';
import {scratch} from '../../harness.mjs';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,existsSync,statSync,readdirSync,realpathSync} from 'node:fs';
import {homedir} from 'node:os';

const RULE='Bash(echo MAWS_C10_PROBE:*)';
const MANGO='Remember the word MANGO. Reply OK.';
const slug=path=>path.replace(/[^a-zA-Z0-9]/g,'-');
const projectDir=path=>homedir()+'/.claude/projects/'+slug(path);
const transcript=(path,id)=>projectDir(path)+'/'+id+'.jsonl';
const records=file=>existsSync(file)?readFileSync(file,'utf8').split('\n').filter(Boolean).map(JSON.parse):[];
const stat=file=>existsSync(file)?{size:statSync(file).size,mtimeMs:statSync(file).mtimeMs}:null;
const trustState=paths=>{const store=JSON.parse(readFileSync(homedir()+'/.claude.json','utf8'));return Object.fromEntries(paths.map(path=>[path,store.projects?.[path]?.hasTrustDialogAccepted??null]));};
const text=record=>{const content=record.message?.content;return typeof content==='string'?content:Array.isArray(content)?content.filter(block=>block.type==='text').map(block=>block.text).join(''):null;};
const tree=dir=>{if(!existsSync(dir))return {exists:false,entries:[]};const entries=[];const visit=path=>{for(const name of readdirSync(path)){const child=path+'/'+name,info=statSync(child);entries.push({path:child,type:info.isDirectory()?'directory':'file'});if(info.isDirectory())visit(child);}};visit(dir);return {exists:true,entries};};
const stderrLines=p=>readFileSync(p.file,'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(row=>row.direction==='stderr').flatMap(row=>row.frame.text.split(/\r?\n/)).filter(Boolean);
const initFrame=p=>p.frames.find(row=>row.frame.type==='system'&&row.frame.subtype==='init')?.frame;
const answer=p=>p.frames.filter(row=>row.frame.type==='assistant').flatMap(row=>row.frame.message?.content||[]).filter(block=>block.type==='text').map(block=>block.text).at(-1)??null;
const opts=(cwd,flags=[])=>({cwd,dir:'fixtures/pass3/',settingSources:'project,local',model:'haiku',flags:[...flags,'--max-budget-usd','0.05']});
async function stage(name,fn,options){let failure;const p=await run(name,async p=>{try{await fn(p);}catch(e){failure=e;throw e;}},options);p.note({event:'stderr_lines',lines:stderrLines(p)});const exit=await p.closed;p.note({event:'stage_exit',...exit});if(failure)throw failure;if(exit.code!==0)throw new Error(name+' exited with '+JSON.stringify(exit));return p;}
function success(response,operation){if(response.subtype!=='success')throw new Error(operation+' returned '+JSON.stringify(response));}

export default async()=>{
 const A=scratch(),realA=realpathSync(A),B=A+'/.claude/worktrees/probe',canonicalB=realA+'/.claude/worktrees/probe';
 mkdirSync(A+'/.claude',{recursive:true});writeFileSync(A+'/.claude/settings.json',JSON.stringify({permissions:{allow:[RULE]}}));
 execFileSync('git',['-C',A,'add','-A']);execFileSync('git',['-C',A,'-c','user.name=Probe','-c','user.email=probe@localhost','commit','-qm','settings']);
 let worktreeAdded=false,fork;
 try{
  const before=trustState([A,realA,B,canonicalB]);
  const first=await stage('fork-worktree-start',async p=>{
   p.note({event:'trust_store_before',A,B,realA,canonicalB,state:before});
   success(await p.init(),'start initialize');const result=await p.turn(MANGO);
   p.note({event:'start_turn',sessionId:p.sessionId,init:initFrame(p)?{session_id:initFrame(p).session_id,cwd:initFrame(p).cwd}:null,answer:answer(p),result:{subtype:result.subtype,is_error:result.is_error,result:result.result}});
  },opts(A));
  const X=first.sessionId;if(!X)throw new Error('Start did not return a session ID');
  const xCandidates=[transcript(A,X),transcript(realA,X)];const xPath=xCandidates.find(existsSync);
  first.note({event:'start_transcript',sessionId:X,computedPath:xCandidates[0],computedExists:existsSync(xCandidates[0]),realpathCandidate:xCandidates[1],realpathCandidateExists:existsSync(xCandidates[1]),actualPath:xPath??null,count:xPath?records(xPath).length:0,sessionIds:xPath?[...new Set(records(xPath).map(r=>r.sessionId??null))]:[]});
  if(!xPath)throw new Error('Start transcript missing at both A paths');
  const xBefore=stat(xPath);
  execFileSync('git',['-C',A,'worktree','add','--no-track','-B','worktree-probe',B,'HEAD']);worktreeAdded=true;
  const realB=realpathSync(B);first.note({event:'worktree_created',A,B,realA,realB,head:execFileSync('git',['-C',B,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),settingsPresent:existsSync(B+'/.claude/settings.json')});
  fork=await stage('fork-worktree-fork',async p=>{
   p.note({event:'worktree_paths',A,B,realA,realB,parentSession:X});
   const initialized=await p.init(initPayload({workspaceTrust:{accepted:true,directory:realA}}));
   p.note({event:'fork_initialize',responseSubtype:initialized.subtype,workspace_trust_recorded:initialized.response?.workspace_trust_recorded,attestedDirectory:realA});success(initialized,'fork initialize');
   const rules=await p.request('list_permission_rules',{});success(rules,'fork list_permission_rules');
   p.note({event:'fork_permission_rules',hasProbeRule:JSON.stringify(rules.response??{}).includes(RULE),matchingEntries:JSON.stringify(rules.response??{}).match(/.{0,100}MAWS_C10_PROBE.{0,100}/g)??[],response:rules.response});
   const result=await p.turn('What word did I ask you to remember? Reply with just that word.');
   const init=initFrame(p);p.note({event:'fork_turn',parentSession:X,sessionId:p.sessionId,init:init?{session_id:init.session_id,cwd:init.cwd}:null,answer:answer(p),result:{subtype:result.subtype,is_error:result.is_error,result:result.result}});
  },opts(B,['--resume',X,'--fork-session']));
  const Y=fork.sessionId;if(!Y)throw new Error('Fork did not return a session ID');
  const bPaths=[transcript(realB,Y),transcript(B,Y)],aPaths=[transcript(A,Y),transcript(realA,Y)];
  const locations=[...new Set([...bPaths,...aPaths])].map(path=>({path,exists:existsSync(path)}));
  const yPath=locations.find(row=>row.exists)?.path;const yRecords=yPath?records(yPath):[];
  fork.note({event:'fork_transcript_after_exit',parentSession:X,forkSession:Y,locations,actualPath:yPath??null,count:yRecords.length,sessionIds:[...new Set(yRecords.map(r=>r.sessionId??null))],firstUserText:text(yRecords.find(r=>r.type==='user')??{}),firstUserIsMango:text(yRecords.find(r=>r.type==='user')??{})===MANGO,specialTypes:yRecords.filter(r=>r.type==='worktree-state'||r.type==='relocated').map(r=>r.type),firstRecordCwd:yRecords[0]?.cwd??null,xBefore,xAfter:stat(xPath),xModified:JSON.stringify(xBefore)!==JSON.stringify(stat(xPath))});
  fork.note({event:'slug_directory_listing',directories:[...new Set([projectDir(A),projectDir(realA),projectDir(B),projectDir(realB)])].map(path=>({path,...tree(path)}))});
  fork.note({event:'trust_store_after',A,B,realA,realB,state:trustState([A,realA,B,realB])});
  await stage('fork-worktree-resume-in-b',async p=>{
   success(await p.init(),'resume initialize');const result=await p.turn('Reply with exactly OK');const init=initFrame(p);
   p.note({event:'resume_turn',expectedSession:Y,sessionId:p.sessionId,init:init?{session_id:init.session_id,cwd:init.cwd}:null,answer:answer(p),result:{subtype:result.subtype,is_error:result.is_error,result:result.result}});
  },opts(B,['--resume',Y]));
 }finally{
  if(worktreeAdded){try{execFileSync('git',['-C',A,'worktree','remove','--force',B]);fork?.note({event:'worktree_removed',path:B});}catch(e){fork?.note({event:'worktree_remove_error',message:e.message,stderr:String(e.stderr??'')});throw e;}}
 }
};
