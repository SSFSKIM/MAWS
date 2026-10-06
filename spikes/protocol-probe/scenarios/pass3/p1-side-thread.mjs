// E3 M0, the live probe (docs/doperpowers/plans/2026-10-06-e3-side-threads.md, Plan of Work M0; child E3 of the P1
// composite spec docs/doperpowers/plans/2026-10-05-p1-extension.md §3 C and §9 E3, A-16; parent pin, the spec's blob,
// 1023793f7feceb755097783df87dbde938dd6e7f). Three facts the side-thread design uses and no fixture proves:
//  (a) a `--resume P --fork-session --session-id C` child launched while P's turn runs starts, answers from P's earlier
//      context, and leaves P's turn unaffected;
//  (b) a `priority:'next'` steer whose content is `[image, text]` is accepted mid-turn, delivered at the tool boundary,
//      and recorded in P's JSONL (with the image block as sent, or with what the engine puts there instead);
//  (c) the child resumes by its own id (`--resume C`, no fork) as an ordinary session.
// One process per fixture (the conformance replay drives one engine per journal): p1-side-thread-live (the parent: the
// plant, the slow Bash turn, the steer, the cross-process checks and the parent's JSONL), p1-side-thread-live-fork (the
// child forked mid-turn, its JSONL), p1-side-thread-live-resume (the third launch, the child's JSONL after it).
// The texts the agent receives are the E3 document's Interfaces strings, built by a local copy of `anchoredMessage`
// (M1 lands the shared one in src/shared/anchor/message.ts; it must produce these bytes).
import {launch,scratchRun,removeRun,initPayload,success,check,endAsStop,initFrame,answer,records,transcriptPath,projectFiles,summarise,topLevelKeys,toolResults,resultSummary,randomUUID,delay,join,writeFileSync} from './p1-common.mjs';

const PROVENANCE={child:'E3',spike:'E3 M0',pin:'1023793f7feceb755097783df87dbde938dd6e7f',spec:'docs/doperpowers/plans/2026-10-05-p1-extension.md',document:'docs/doperpowers/plans/2026-10-06-e3-side-threads.md'};

// The E3 document's Interfaces, `src/shared/anchor/message.ts` (file-line only: the one kind this probe sends).
const SIDE_THREAD_PREAMBLE='You are in a side thread forked from the main conversation to handle this one comment. Address it here; the main conversation continues separately and is not waiting on you.';
const basename=path=>path.split('/').filter(Boolean).at(-1)??path;
const fileLineAnchor=(path,line)=>({kind:'file-line',locator:`${path}#L${line}`,label:`${basename(path)}:${line}`,path,line}); // E5's
const escapeAttr=v=>String(v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const anchorTag=a=>'<maws_anchor '+['kind','label','locator','pageUrl','path','line','side','prNumber'].filter(k=>a[k]!==undefined).map(k=>`${k}="${escapeAttr(a[k])}"`).join(' ')+'/>';
function anchorLead(a,screenshot){
 if(a.kind!=='file-line')throw new Error('the probe builds file-line leads only');
 const lead=`Comment on "${a.label}" (file ${a.path}, line ${a.line}):`;
 return screenshot?lead.slice(0,-1)+'. A screenshot of it is attached:':lead;
}
const anchoredMessage=({anchor,text,destination,screenshot})=>anchorLead(anchor,screenshot)+'\n'+text.trim()+(destination==='thread'?'\n\n'+SIDE_THREAD_PREAMBLE:'')+'\n\n'+anchorTag(anchor);

const REMEMBER='Remember the word ZEBRA. Reply with exactly OK.';
const SLOW='Run exactly this bash command and nothing else: sleep 20; echo SLEPT_OK. When it finishes, reply with the command output.';
const CHILD_ASK='What word did I ask you to remember? Answer with just the word.';
const STEER_ASK='When the command has finished, end your reply with the word I asked you to remember.';
const RECALL='What word did I ask you to remember? Answer with just the word.';
const PNG_2X2_RED='iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==';

const isBashUse=f=>f.type==='assistant'&&!f.parent_tool_use_id&&(f.message?.content||[]).some(b=>b.type==='tool_use'&&b.name==='Bash');
const rowOf=(p,test,after=0)=>p.frames.find(r=>r.seq>after&&test(r.frame));
// The root of a transcript: the first record with `parentUuid: null` that carries a uuid (A-16's disk signal).
const rootOf=recs=>recs.find(r=>r.parentUuid===null&&typeof r.uuid==='string')??null;
// Read and Bash only (the planting and slow turns, and a model that looks at the commented file); anything else denied.
const allowReadBash=p=>r=>{p.note({event:'permission_asked',tool:r.tool_name,input:r.input??null});return ['Bash','Read'].includes(r.tool_name)?{behavior:'allow',updatedInput:r.input}:{behavior:'deny',message:'Only Read and Bash are in scope.'};};
// What a content array's image blocks are, for the steer's live echo and its disk record.
const imageForm=content=>Array.isArray(content)?content.filter(b=>b.type==='image').map(b=>({type:b.type,sourceType:b.source?.type,media_type:b.source?.media_type,sameData:b.source?.data===PNG_2X2_RED,dataLength:b.source?.data?.length??null})):typeof content;

export default async()=>{
 const run=scratchRun('side-thread');
 const P=randomUUID(),C=randomUUID();
 const probeFile=join(run.cwd,'probe.txt');
 writeFileSync(probeFile,'the line this comment is about\n');
 const anchor=fileLineAnchor(probeFile,1);
 const childMessage=anchoredMessage({anchor,text:CHILD_ASK,destination:'thread',screenshot:false});
 const steerText=anchoredMessage({anchor,text:STEER_ASK,destination:'main',screenshot:true});
 try{
  let child=null;
  await launch('p1-side-thread-live',run,{sessionId:P,provenance:{...PROVENANCE,role:'parent',question:'E3 M0 (a) and (b): a side thread forked while this turn runs; an [image, text] next steer mid-turn'}},async p=>{
   p.on('can_use_tool',allowReadBash(p));
   success(await p.init(initPayload(run.cwd)),'initialize');
   const r0=await p.turn(REMEMBER);
   check(p,'the planting turn answered',r0.subtype==='success'&&!r0.is_error,resultSummary(r0));

   const turnFrom=p.seq;
   const slow=p.user(SLOW);
   await p.wait(isBashUse,{after:turnFrom,timeout:90000});
   const bashRow=rowOf(p,isBashUse,turnFrom);
   p.note({event:'bash_started',seq:bashRow.seq,tool_use:bashRow.frame.message.content.find(b=>b.type==='tool_use'),permissionAsked:p.frames.some(r=>r.seq>turnFrom&&r.frame.type==='control_request'&&r.frame.request?.subtype==='can_use_tool')});

   // (a) the side thread, 2 s after the tool_use: MAWS's launch line plus --resume P --fork-session --session-id C.
   const forked=delay(2000).then(()=>{
    p.note({event:'fork_spawning',parentSeq:p.seq,source:P,pinned:C,toolResultYet:toolResults(p).some(t=>t.seq>turnFrom)});
    return launch('p1-side-thread-live-fork',run,{sessionId:C,flags:['--resume',P,'--fork-session'],debugFile:join(run.root,'debug-fork.log'),provenance:{...PROVENANCE,role:'side-thread',question:'E3 M0 (a): the --fork-session child of a parent whose turn is running, its first prompt the anchored comment'}},async c=>{
     c.on('can_use_tool',allowReadBash(c));
     c.note({event:'fork_paths',source:P,pinned:C,repo:run.cwd,anchor,firstPrompt:childMessage});
     success(await c.init(initPayload(run.cwd)),'initialize');
     const r=await c.turn(childMessage);
     const init=initFrame(c);
     c.note({event:'fork_turn',init:init?{session_id:init.session_id,cwd:init.cwd,claude_code_version:init.claude_code_version}:null,answer:answer(c),result:resultSummary(r)});
     check(c,'system/init.session_id is the pinned child id',init?.session_id===C,{init:init?.session_id,pin:C});
     check(c,'the side thread turn succeeded',r.subtype==='success'&&!r.is_error,resultSummary(r));
     check(c,'the side thread answers from the parent\'s earlier context',/ZEBRA/i.test(answer(c)??''),answer(c));
     await endAsStop(c);
     const cRecs=records(transcriptPath(run,C)),pRecs=records(transcriptPath(run,P));
     const cRoot=rootOf(cRecs),pRoot=rootOf(pRecs);
     c.note({event:'fork_jsonl',path:transcriptPath(run,C),count:cRecs.length,keys:topLevelKeys(cRecs),summaries:cRecs.map(summarise),root:cRoot&&summarise(cRoot),parentRoot:pRoot&&summarise(pRoot),sessionIds:[...new Set(cRecs.map(r=>r.sessionId??null))],files:projectFiles(run)});
     c.note({event:'jsonl_snapshot',label:'side-thread-child',records:cRecs});
     check(c,'the child\'s first parentUuid-null record carries the parent\'s root uuid',!!cRoot&&!!pRoot&&cRoot.uuid===pRoot.uuid,{child:cRoot?.uuid,parent:pRoot?.uuid});
     check(c,'the child\'s anchored prompt is in its transcript as the comment text',cRecs.some(r=>r.type==='user'&&JSON.stringify(r.message?.content??'').includes(JSON.stringify(SIDE_THREAD_PREAMBLE).slice(1,-1))));
    });
   });
   forked.catch(()=>{}); // awaited below; a rejection before then is not unhandled

   // (b) the image steer, 4 s after the tool_use.
   await delay(4000);
   const steer=p.send({type:'user',uuid:randomUUID(),message:{role:'user',content:[{type:'image',source:{type:'base64',media_type:'image/png',data:PNG_2X2_RED}},{type:'text',text:steerText}]},parent_tool_use_id:null,origin:{kind:'human'},priority:'next'});
   const steerSeq=p.seq;
   p.note({event:'steer_written',seq:steerSeq,uuid:steer.uuid,toolResultYet:toolResults(p).some(t=>t.seq>turnFrom)});

   const result=await p.wait(f=>f.type==='result'&&(f.user_message_uuids||[]).includes(steer.uuid),{after:turnFrom,timeout:180000});
   const resultRow=rowOf(p,f=>f===result,turnFrom);
   const lifecycle=p.frames.filter(r=>r.frame.type==='command_lifecycle'&&r.frame.command_uuid===steer.uuid).map(r=>({seq:r.seq,state:r.frame.state}));
   const toolResultSeq=toolResults(p).find(t=>t.seq>turnFrom)?.seq??null;
   const echo=rowOf(p,f=>f.type==='user'&&f.uuid===steer.uuid,steerSeq);
   const results=p.frames.filter(r=>r.seq>turnFrom&&r.frame.type==='result').map(r=>({seq:r.seq,...resultSummary(r.frame),user_message_uuids:r.frame.user_message_uuids}));
   p.note({event:'steer_delivery',steerSeq,lifecycle,toolResultSeq,resultSeq:resultRow.seq,results,echo:echo?{seq:echo.seq,isReplay:echo.frame.isReplay??null,images:imageForm(echo.frame.message?.content),blockTypes:Array.isArray(echo.frame.message?.content)?echo.frame.message.content.map(b=>b.type):typeof echo.frame.message?.content}:null,answer:answer(p)});
   check(p,'the steer was accepted mid-turn (queued before the Bash result)',lifecycle.some(l=>l.state==='queued'&&toolResultSeq!==null&&l.seq<toolResultSeq),{lifecycle,toolResultSeq});
   check(p,'the steer started at the tool boundary (after the Bash result) and folded into the running turn',lifecycle.some(l=>l.state==='started'&&l.seq>toolResultSeq)&&results.length===1&&result.user_message_uuids.includes(slow.uuid),{lifecycle,toolResultSeq,results});
   check(p,'the parent\'s turn finished as a success with the command output',result.subtype==='success'&&!result.is_error&&/SLEPT_OK/.test(JSON.stringify(toolResults(p).find(t=>t.seq>turnFrom)?.content??'')),{result:resultSummary(result),toolResult:toolResults(p).find(t=>t.seq>turnFrom)});
   check(p,'the parent read the comment (its reply recalls the planted word)',/ZEBRA/i.test(result.result??''),result.result);

   // (a) across the two processes: the child started (system/init) while the parent's Bash was still running.
   child=await forked;
   const childInit=child.frames.find(r=>r.frame.type==='system'&&r.frame.subtype==='init');
   const childResult=child.frames.find(r=>r.frame.type==='result');
   const toolResultAt=p.frames.find(r=>r.seq===toolResultSeq)?.at;
   p.note({event:'fork_timing',bashUseAt:bashRow.at,childInitAt:childInit?.at??null,childResultAt:childResult?.at??null,parentToolResultAt:toolResultAt,parentResultAt:resultRow.at,childFixture:child.file});
   check(p,'the side thread started while the parent\'s turn was running',!!childInit&&childInit.at>bashRow.at&&childInit.at<toolResultAt,{childInitAt:childInit?.at,bashUseAt:bashRow.at,parentToolResultAt:toolResultAt});
   await endAsStop(p);

   const pRecs=records(transcriptPath(run,P));
   const steerRecs=pRecs.filter(r=>JSON.stringify(r).includes(steer.uuid)||JSON.stringify(r).includes('A screenshot of it is attached'));
   const steerDisk=steerRecs.map(r=>({...summarise(r),attachmentType:r.attachment?.type??null,images:imageForm(r.message?.content??r.attachment?.prompt??r.attachment?.content),attachmentKeys:r.attachment?Object.keys(r.attachment).sort():null}));
   p.note({event:'parent_jsonl',path:transcriptPath(run,P),count:pRecs.length,keys:topLevelKeys(pRecs),summaries:pRecs.map(summarise),sessionIds:[...new Set(pRecs.map(r=>r.sessionId??null))],steerRecords:steerDisk,files:projectFiles(run)});
   p.note({event:'jsonl_snapshot',label:'side-thread-parent',records:pRecs});
   check(p,'the parent\'s JSONL holds the steer',steerRecs.length>0,steerDisk);
   check(p,'the parent\'s JSONL holds only its own session',pRecs.every(r=>r.sessionId===undefined||r.sessionId===P),[...new Set(pRecs.map(r=>r.sessionId??null))]);
  });

  // (c) the side thread resumed by its own id, as a terminal would: `--resume C`, no fork, no --session-id.
  await launch('p1-side-thread-live-resume',run,{sessionId:C,pinned:false,flags:['--resume',C],debugFile:join(run.root,'debug-resume.log'),provenance:{...PROVENANCE,role:'resumed-side-thread',question:'E3 M0 (c): the side thread resumed by its own id as an ordinary session'}},async r=>{
   r.on('can_use_tool',allowReadBash(r));
   const filesBefore=projectFiles(run);
   success(await r.init(initPayload(run.cwd)),'initialize');
   const res=await r.turn(RECALL);
   const init=initFrame(r);
   r.note({event:'resume_turn',init:init?{session_id:init.session_id,cwd:init.cwd}:null,answer:answer(r),result:resultSummary(res)});
   check(r,'the resumed side thread keeps its own id',init?.session_id===C&&res.session_id===C,{init:init?.session_id,result:res.session_id,child:C});
   check(r,'the resumed side thread remembers the parent\'s context',res.subtype==='success'&&/ZEBRA/i.test(answer(r)??''),answer(r));
   await endAsStop(r);
   const cRecs=records(transcriptPath(run,C));
   const filesAfter=projectFiles(run);
   r.note({event:'resumed_jsonl',path:transcriptPath(run,C),count:cRecs.length,summaries:cRecs.map(summarise),sessionIds:[...new Set(cRecs.map(x=>x.sessionId??null))],filesBefore,filesAfter});
   r.note({event:'jsonl_snapshot',label:'side-thread-child-after-resume',records:cRecs});
   check(r,'the resume wrote no new transcript (an ordinary resume of the child file)',JSON.stringify(filesBefore)===JSON.stringify(filesAfter),{filesBefore,filesAfter});
  });
 }finally{removeRun(run);}
};
