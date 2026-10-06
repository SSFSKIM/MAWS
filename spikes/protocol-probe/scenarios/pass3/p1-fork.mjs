// E0a question 2 (spec §4 S4, §9 E0a; SPEC 45 control table and §36): `fork_conversation`, the client-sent control
// request with no published schema, on a live print-mode session, against the `--fork-session` launch MAWS uses (C10's
// path, src/engine-host/launch.ts:203). Two fixtures: p1-fork-start (a pinned start turn, then fork_conversation with a
// title, with a target uuid, with a bad type and empty, and the project directory before and after) and
// p1-fork-session-flag (`--resume X --fork-session --session-id Y`, a recall turn, fork_conversation again, then the
// parent's and the child's JSONL: every record summarised, the child's records in full, the lineage keys present).
import {launch,scratchRun,removeRun,initPayload,success,check,endAsStop,initFrame,answer,records,transcriptPath,projectFiles,summarise,topLevelKeys,stat,randomUUID,delay} from './p1-common.mjs';

const REMEMBER='Remember the word ZEBRA. Reply with exactly OK.';
const RECALL='What word did I ask you to remember? Reply with just that word.';

export default async()=>{
 const run=scratchRun('fork');
 const X=randomUUID(),Y=randomUUID();
 try{
  await launch('p1-fork-start',run,{sessionId:X,provenance:{question:'Q2: fork_conversation on a live print-mode session (shapes, whether a child starts, what the disk records)'}},async p=>{
   success(await p.init(initPayload(run.cwd)),'initialize');
   const sent=p.user(REMEMBER);
   const r1=await p.wait(f=>f.type==='result');
   const userUuid=sent.uuid; // the uuid MAWS stamped on the prompt, echoed back by --replay-user-messages
   const filesBefore=projectFiles(run);
   const answers={};
   answers.title=await p.request('fork_conversation',{title:'MAWS E0a fork'});
   answers.target=await p.request('fork_conversation',{target_message_uuid:userUuid,title:'MAWS E0a fork at a message'});
   answers.badType=await p.request('fork_conversation',{title:5});
   answers.empty=await p.request('fork_conversation',{});
   await delay(2000);
   const filesAfter=projectFiles(run);
   p.note({event:'fork_conversation_answers',targetUuid:userUuid,answers,systemFramesSince:p.frames.filter(r=>r.frame.type==='system'&&r.seq>p.frames.find(x=>x.frame.type==='result')?.seq).map(r=>({seq:r.seq,subtype:r.frame.subtype}))});
   p.note({event:'project_files',before:filesBefore,after:filesAfter,newFiles:filesAfter.filter(f=>!filesBefore.includes(f))});
   check(p,'the start turn answered',r1.subtype==='success'&&!r1.is_error,{subtype:r1.subtype});
   check(p,'fork_conversation answers a success envelope with forked:false',answers.title.subtype==='success'&&answers.title.response?.forked===false,answers.title);
   check(p,'no new transcript appears after fork_conversation',JSON.stringify(filesBefore)===JSON.stringify(filesAfter),{filesBefore,filesAfter});
   await endAsStop(p);
   const recs=records(transcriptPath(run,X));
   p.note({event:'parent_jsonl',path:transcriptPath(run,X),count:recs.length,keys:topLevelKeys(recs),summaries:recs.map(summarise)});
  });
  const xBefore=stat(transcriptPath(run,X));
  await launch('p1-fork-session-flag',run,{sessionId:Y,flags:['--resume',X,'--fork-session'],provenance:{question:'Q2: the --fork-session launch MAWS uses (C10), for comparison: the child id, the recall, the lineage the JSONL records'}},async p=>{
   p.note({event:'fork_paths',source:X,pinned:Y,repo:run.cwd});
   success(await p.init(initPayload(run.cwd)),'initialize');
   const r=await p.turn(RECALL);
   const init=initFrame(p);
   p.note({event:'fork_turn',init:init?{session_id:init.session_id,cwd:init.cwd}:null,answer:answer(p),result:{subtype:r.subtype,is_error:r.is_error,total_cost_usd:r.total_cost_usd}});
   check(p,'system/init.session_id is the pinned fork id',init?.session_id===Y,{init:init?.session_id,pin:Y});
   check(p,'the fork recalls the parent history',/ZEBRA/i.test(answer(p)??''),answer(p));
   const again=await p.request('fork_conversation',{title:'MAWS E0a fork of a fork'});
   p.note({event:'fork_conversation_on_fork',answer:again});
   await endAsStop(p);
   const yRecs=records(transcriptPath(run,Y));
   const xRecs=records(transcriptPath(run,X));
   const xAfter=stat(transcriptPath(run,X));
   const lineage={forkedFrom:yRecs.filter(r=>r.forkedFrom!==undefined).length,forkedFromSessionId:yRecs.filter(r=>r.forkedFromSessionId!==undefined).length,parentSessionId:yRecs.filter(r=>r.parentSessionId!==undefined).length,sessionIds:[...new Set(yRecs.map(r=>r.sessionId??null))],firstRecord:yRecs[0]?summarise(yRecs[0]):null,parentUuidsInParent:yRecs.filter(r=>r.parentUuid&&xRecs.some(x=>x.uuid===r.parentUuid)).length,uuidsSharedWithParent:yRecs.filter(r=>r.uuid&&xRecs.some(x=>x.uuid===r.uuid)).length};
   p.note({event:'fork_jsonl',path:transcriptPath(run,Y),count:yRecs.length,keys:topLevelKeys(yRecs),summaries:yRecs.map(summarise),lineage,parentUnchanged:JSON.stringify(xBefore)===JSON.stringify(xAfter),parentCount:xRecs.length,files:projectFiles(run)});
   p.note({event:'jsonl_snapshot',label:'fork-child',records:yRecs});
   check(p,'the fork transcript exists under the pinned id',yRecs.length>0);
   check(p,'the source transcript is unchanged',JSON.stringify(xBefore)===JSON.stringify(xAfter),{xBefore,xAfter});
  });
 }finally{removeRun(run);}
};
