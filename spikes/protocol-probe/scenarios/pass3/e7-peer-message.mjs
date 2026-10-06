// E7 M0 step 2 (docs/doperpowers/plans/2026-10-06-e7-orchestration.md, Interfaces "Probe scenarios and fixtures",
// Design §4): cross-session messaging between two MAWS-launched print-mode sessions under one scratch config home (peers
// find each other in <config>/sessions/, SPEC 38 §38.16). Two journals, e7-peer-a and e7-peer-b, recorded side by side,
// and both sessions' JSONL copied to e7-peer-transcripts/<sessionId>.jsonl for the disk path (backfill.ts).
//
// The steps: B answers one turn (its registry record and inbox exist); A calls ListAgents (the listing with B as a peer
// session, A's self line); B sends A a message by A's listed name (A's inbound `user` frame: the header, the envelope, the
// trailer, the origin; idle, so a turn starts); A is steered with MAWS's peer relayText and replies (its SendMessage `to`
// and result; B's inbound frame); A runs `sleep 30` while B sends again (the mid-turn form); A sends to a name no session
// has (the failure result). If ListAgents says messaging is off, or A never receives B's message, the finding is recorded
// and the scenario ends there (Design §4 then ships on hand-built frames).
import {launch,scratchRun,removeRun,initPayload,success,check,endAsStop,records,transcriptPath,join,writeFileSync,existsSync} from './p1-common.mjs';
import {realpathSync,readFileSync,rmSync} from 'node:fs';
import {E7,E7_DEBUG,allowAll,blocks,textOf,toolUsesAfter,pairsAfter,waitToolUse,waitResultOf,lifecycleOf,resultsAfter,framesBetween,steer,prompt,snapshotDir,copyRedacted,deferred,idle,cost} from './e7-common.mjs';
import {scratch,root} from '../../harness.mjs';

const READY='Reply with exactly READY.';
const LIST='Call the ListAgents tool (load it with ToolSearch first if needed) and reply with its listing verbatim, nothing else.';
const SEND=(to,text)=>`Use the SendMessage tool (load it with ToolSearch first if needed) to send the peer session named "${to}" exactly this message: "${text}". Then reply SENT.`;
const SLOW='Run exactly this bash command and nothing else: sleep 30; echo SLEPT_OK. When it finishes, reply with exactly the command output.';
const NOBODY='Use the SendMessage tool to send to "nobody-e7" exactly this message: "E7 probe: nobody". Then reply with the tool result verbatim.';
// Design §4's relayText for a peer target (the SPEC's rule: copy the envelope's `from` as `to`, §38.24.2).
export const peerRelayText=(name,address,text)=>`Reply to the cross-session message from ${name} (${address}) with SendMessage, to: "${address}", sending exactly this text, then continue what you were doing: ${text}`;
const HELLO='E7 probe: hello from B',REPLY='E7 probe: reply from A',SECOND='E7 probe: second message while you work';
const ENVELOPE=/<cross-session-message from="([^"]+)"([^>]*)>/;
const attr=(attrs,name)=>new RegExp(`${name}="([^"]*)"`).exec(attrs)?.[1]??null;
// a peer-delivered user frame: the envelope in its text (whatever its origin says, recorded)
const peerFrames=(p,from)=>p.frames.filter(r=>r.seq>from&&r.frame.type==='user'&&ENVELOPE.test(textOf(r.frame.message?.content)));
const inbound=r=>{const text=textOf(r.frame.message?.content);const m=ENVELOPE.exec(text);return {seq:r.seq,at:r.at,origin:r.frame.origin??null,isReplay:r.frame.isReplay??null,uuid:r.frame.uuid??null,priority:r.frame.priority??null,keys:Object.keys(r.frame).sort(),from:m[1],fromSession:attr(m[2],'from-session'),hopChain:attr(m[2],'hop-chain'),fromName:attr(m[2],'from-name'),fromMode:attr(m[2],'from-mode'),fromPlugin:attr(m[2],'from-plugin'),header:text.slice(0,text.indexOf('<cross-session-message')).trim(),trailer:text.slice(text.indexOf('</cross-session-message>')+'</cross-session-message>'.length).trim(),text};};
const waitPeer=(p,from,timeout)=>p.wait(f=>f.type==='user'&&ENVELOPE.test(textOf(f.message?.content)),{after:from,timeout}).then(()=>inbound(peerFrames(p,from)[0])).catch(()=>null);
// a listing's self name and peer rows (SPEC 38 §38.26.3)
function parseListing(text){
 const self=/This session is (.+?) — the name other sessions use/.exec(text)?.[1]??null;
 const section=text.split(/\n\s*\n/).find(s=>/^Peer sessions \(\d+\):/m.test(s));
 const rows=section?section.split('\n').filter(l=>/^ {2}\S/.test(l)).map(l=>l.trim().split('  ·  ')):[];
 return {self,selfName:self?.replace(/ \[[^\]]+\]$/,'')??null,peers:rows.map(([primary,...extras])=>({primary,name:primary.replace(/ \[[^\]]+\]$/,''),extras}))};
}
// the registry as the sessions published it; a `<pid>.<sha256>.key` file is recorded by its key names only (its
// peerToken is the inbox's credential)
const registry=dir=>Object.fromEntries(Object.entries(snapshotDir(dir)).map(([k,v])=>k.endsWith('.key')?[k,{mtimeMs:v.mtimeMs,size:v.size,keyNames:Object.keys(JSON.parse(v.content)).sort()}]:[k,v]));
const bothIdle=async(a,b)=>{for(let i=0;i<2;i++){await idle(a,180000,4000);await idle(b,180000,4000);}};

export default async()=>{
 const run=scratchRun('e7-peer');
 const cwdB=realpathSync(scratch(join(run.root,'repo-b-')));
 const gc=join(run.home,'.claude.json');const g=JSON.parse(readFileSync(gc,'utf8'));g.projects[cwdB]={hasTrustDialogAccepted:true,hasCompletedProjectOnboarding:true};writeFileSync(gc,JSON.stringify(g)+'\n');
 const runB={...run,cwd:cwdB,debugFile:join(run.root,'debug-b.log')};
 const ready={a:deferred(),b:deferred()},done=deferred();
 const session=(key,r)=>async(p,{sessionId})=>{allowAll(p);success(await p.init(initPayload(r.cwd)),'initialize');ready[key].resolve({p,sessionId});await done.promise;await endAsStop(p);};
 const opts={spendCap:'0.80',debugPattern:E7_DEBUG};
 const launches=[
  launch('e7-peer-a',run,{...opts,provenance:{...E7,role:'A',question:'Design §4: the peer envelope, listing, reply and failure forms, live and on disk (A, the receiver and replier)'}},session('a',run)),
  launch('e7-peer-b',runB,{...opts,provenance:{...E7,role:'B',question:'Design §4: the peer envelope, listing, reply and failure forms, live and on disk (B, the sender)'}},session('b',runB)),
 ];
 const settled=Promise.allSettled(launches);
 for(const l of launches)l.catch(e=>{ready.a.reject(e);ready.b.reject(e);});
 let ids={};
 try{
  const [{p:A,sessionId:aId},{p:B,sessionId:bId}]=await Promise.all([ready.a.promise,ready.b.promise]);ids={a:aId,b:bId};
  const both=e=>{A.note(e);B.note(e);};
  try{
   // 0. B answers one turn; the registry as both sessions published it.
   check(B,'B answered its first turn',(await B.turn(READY)).subtype==='success');
   both({event:'e7_registry',when:'after B ready',records:registry(join(run.home,'sessions')),sockets:existsSync('/tmp/cc-socks')?'present':'absent'});

   // 1. A lists the agents it can message.
   let from=A.seq;await A.turn(LIST);
   const list=pairsAfter(A,from,'ListAgents')[0]??null;
   const listing=list?.result?.structured?.listing??list?.result?.text??null;
   const parsed=listing?parseListing(listing):null;
   A.note({event:'e7_listing',use:list?.use??null,result:list?.result??null,parsed,answer:A.frames.filter(r=>r.seq>from&&r.frame.type==='result').at(-1)?.frame.result??null});
   const bRow=parsed?.peers[0]??null;
   if(!list||!parsed?.selfName||!bRow){both({event:'e7_premise_failed',step:'listing',detail:'ListAgents did not list B as a peer session or gave no self line: Design §4 ships on hand-built frames',listing});return;}

   // 2. B sends A a message by A's listed name; A is idle.
   const aFrom=A.seq;from=B.seq;await B.turn(SEND(parsed.selfName,HELLO));
   const send1=pairsAfter(B,from,'SendMessage');
   B.note({event:'e7_send',case:'idle',pairs:send1});
   const in1=await waitPeer(A,aFrom,90000);
   A.note({event:'e7_inbound',case:'idle',inbound:in1,framesAround:in1?framesBetween(A,aFrom,in1.seq+12):framesBetween(A,aFrom)});
   if(!in1){both({event:'e7_premise_failed',step:'inbound',detail:'A received no peer message after B\'s SendMessage: the live half of Design §4 is unverified',sendPairs:send1});return;}
   await bothIdle(A,B);
   A.note({event:'e7_inbound_turn',case:'idle',frames:framesBetween(A,aFrom),results:resultsAfter(A,aFrom),ownSendMessages:pairsAfter(A,aFrom,'SendMessage')});
   B.note({event:'e7_after_send',frames:framesBetween(B,from),inbound:peerFrames(B,from).map(inbound)});

   // 3. The owner replies from the row: MAWS's peer relayText as a 'next' steer on A.
   const name=in1.fromName??in1.from;
   const bFrom=B.seq;const s=steer(A,peerRelayText(name,in1.from,REPLY),{label:'peer-reply'});
   const sm=await waitToolUse(A,s.seq,'SendMessage',120000);
   const smResult=sm?await waitResultOf(A,sm.id,60000):null;
   const in2=await waitPeer(B,bFrom,90000);
   await bothIdle(A,B);
   A.note({event:'e7_reply',steer:s,sendMessage:sm,result:smResult,matchesOwnerText:!!sm&&typeof sm.input?.message==='string'&&sm.input.message.includes(REPLY),toIsAddress:sm?.input?.to===in1.from,lifecycle:lifecycleOf(A,s.uuid),results:resultsAfter(A,s.seq),allSendMessages:pairsAfter(A,s.seq,'SendMessage')});
   B.note({event:'e7_inbound',case:'reply',inbound:in2,frames:framesBetween(B,bFrom),results:resultsAfter(B,bFrom)});

   // 4. Mid-turn: A runs a 30 s Bash while B sends again.
   const midFrom=A.seq;prompt(A,SLOW);
   const bash=await waitToolUse(A,midFrom,'Bash',90000);
   from=B.seq;await B.turn(SEND(parsed.selfName,SECOND));
   B.note({event:'e7_send',case:'mid-turn',pairs:pairsAfter(B,from,'SendMessage')});
   const in3=await waitPeer(A,midFrom,120000);
   await bothIdle(A,B);
   const bashResult=bash?toolUsesAfter(A,midFrom,'Bash').map(u=>u.id).map(id=>A.frames.find(r=>r.frame.type==='user'&&blocks(r.frame).some(b=>b.tool_use_id===id))?.seq??null)[0]:null;
   A.note({event:'e7_inbound',case:'mid-turn',bash,bashResultSeq:bashResult,inbound:in3,arrivedBeforeBashResult:in3&&bashResult?in3.seq<bashResult:null,frames:framesBetween(A,midFrom),results:resultsAfter(A,midFrom)});

   // 5. The failure form: a name no session has.
   from=A.seq;await A.turn(NOBODY);
   A.note({event:'e7_send_failure',pairs:pairsAfter(A,from,'SendMessage'),results:resultsAfter(A,from)});
   both({event:'e7_registry',when:'end',records:registry(join(run.home,'sessions'))});
  }finally{both({event:'e7_spend',a:cost(A),b:cost(B)});}
 }finally{
  done.resolve();
  ready.a.resolve({});ready.b.resolve({});
  const out=await settled;
  // the disk form: both sessions' JSONL, for backfill.ts (Design §4, §8)
  const dir=join(root,'fixtures/pass3/e7-peer-transcripts');rmSync(dir,{recursive:true,force:true});
  for(const [role,id,r] of [['a',ids.a,run],['b',ids.b,runB]]){if(!id)continue;const file=transcriptPath(r,id);if(existsSync(file))copyRedacted(file,join(dir,`${id}.jsonl`));console.log('e7-peer',role,id,existsSync(file)?records(file).length+' records':'no transcript');}
  removeRun(run);
  const failed=out.filter(o=>o.status==='rejected');if(failed.length)throw failed[0].reason;
 }
};
