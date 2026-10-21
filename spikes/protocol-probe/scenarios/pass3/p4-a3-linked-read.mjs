// P4-A3 (docs/doperpowers/plans/2026-10-21-p4-a3-edit-protocol.md, lever 2; X33's fixture-per-wire-change rule): what
// the pinned engine does with a human `user` frame that carries a linked artifact's read after the human's words, as
// MAWS writes it (src/engine-host/linked-reads.ts; the block's text is src/shared/maws/linked-read.ts's form, which
// src/shared/maws/linked-read.test.ts checks against this fixture), read from what the engine sends the model and what
// it echoes and keeps. MAWS's launch behind the gateway (ENABLE_TOOL_SEARCH=true) with the maws server as it lists its
// tools (./p4-maws-tools.json, the edit tools always loaded), against the scripted Messages API stand-in
// (../../stub-api.mjs), so nothing is spent. The scripted model edits at once from the attached revision, then answers.
// One launch, fixture fixtures/p4/p4-a3-linked-read.jsonl.
import {join,check,success,initFrame,endAsStop,launch,scratchRun,removeRun,initPayload,toolResults,toolUses,transcriptPath} from './p1-common.mjs';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {SdkServer} from '../../sdk-mcp.mjs';
import {startStubApi,toolTurn,textTurn} from '../../stub-api.mjs';

const HERE=fileURLToPath(new URL('.',import.meta.url));
const served=JSON.parse(readFileSync(join(HERE,'p4-maws-tools.json'),'utf8'));
export const ARTIFACT='4c85e0e6-8cf5-4f06-a7eb-90a3e66fd806';
export const WORDS=`In the document [Riverside Community Garden: Spring Season Plan](maws-artifact:${ARTIFACT}), rewrite the introduction paragraph to be warmer, keeping it about the same length. Change nothing else.`;
// The read MAWS's artifact_read answers for a short document, pretty-printed as every maws result is.
export const READ=JSON.stringify({status:'read',artifactId:ARTIFACT,kind:'document',title:'Riverside Community Garden: Spring Season Plan',versions:[{id:21,kind:'import',revision:25,at:'2026-10-21T12:07:14.296Z',by:'user'}],revision:25,tabs:[{id:'agoppcro',title:'Season plan',blocks:2}],tab:'agoppcro',markdown:'# Riverside Community Garden: Spring Season Plan ^0qwx6nno\n\nWelcome to the spring season at Riverside Community Garden. ^u6fcpxpq\n',next:null},null,2);
// linked-read.ts's linkedReadBlock(READ), written out: the test that reads this fixture checks the two are the same.
export const BLOCK=`<system-reminder>\nThe user's message links the MAWS artifact [Riverside Community Garden: Spring Season Plan](maws-artifact:${ARTIFACT}). Its content as mcp__maws__artifact_read returns it, read when the message was sent:\n${READ}\n</system-reminder>`;
const EDIT={artifact:ARTIFACT,baseRevision:25,ops:[{op:'replace_block',id:'u6fcpxpq',markdown:'Welcome, or welcome back, to spring at Riverside Community Garden!'}]};
const EDITED={status:'edited',artifactId:ARTIFACT,revision:26,results:[{line:'replaced ^u6fcpxpq',target:'u6fcpxpq',newIds:[]}],orphaned:[]};

class MawsServer extends SdkServer{
 constructor(tools,instructions){super('maws',tools.map(t=>({...t,call:args=>({content:[{type:'text',text:JSON.stringify(t.name==='artifact_edit'?EDITED:{status:'ok',args},null,2)}]})})));this.instructions=instructions;this.listed=tools;}
 handle(message){
  const answer=super.handle(message);
  if(message.method==='initialize'&&answer?.result)answer.result.instructions=this.instructions;
  if(message.method==='tools/list'&&answer?.result)answer.result.tools=this.listed.map(({call:_c,...t})=>t);
  return answer;
 }
}

// Every request: its messages' blocks (a text block whole when it names the artifact, else its size and head) and the
// tools with their deferral.
function record(body){
 const messages=(body.messages??[]).map((m,i)=>({i,role:m.role,blocks:(typeof m.content==='string'?[{type:'text',text:m.content}]:m.content??[]).map(b=>{
  if(b.type==='text')return b.text.includes(ARTIFACT)?{type:'text',chars:b.text.length,text:b.text}:{type:'text',chars:b.text.length,head:b.text.slice(0,120)};
  if(b.type==='tool_use')return {type:'tool_use',id:b.id,name:b.name,input:b.input};
  if(b.type==='tool_result')return {type:'tool_result',tool_use_id:b.tool_use_id,is_error:b.is_error??false};
  return {type:b.type};
 })}));
 return {model:body.model,messages,tools:(body.tools??[]).map(t=>({name:t.name,defer_loading:t.defer_loading??null}))};
}

export default async()=>{
 const name='p4-a3-linked-read';
 const run=scratchRun('a3-linked-read');
 const stub=await startStubApi({script:[toolTurn('toolu_stub_edit','mcp__maws__artifact_edit',EDIT),textTurn('<message>\nRewritten.\n</message>')],record});
 const server=new MawsServer(served.tools,served.instructions);
 try{
  await launch(name,run,{dir:'fixtures/p4/',relay:false,spendCap:'0.01',vars:{ANTHROPIC_BASE_URL:stub.url,ANTHROPIC_AUTH_TOKEN:'stub-token',ENABLE_TOOL_SEARCH:'true'},provenance:{charter:'docs/charter.md',child:'P4-A3',pin:'e8dcab899cfb0c7d0db61e41644d4e2014b71a01',document:'docs/doperpowers/plans/2026-10-21-p4-a3-edit-protocol.md',spike:'lever 2, the linked read on the wire',question:'a human user frame carrying the linked read after the words: does the model get both blocks in that order, unchanged, in one user message; does the echo and the transcript keep them; is the edit tool loaded so an edit needs no ToolSearch',served:'p4-maws-tools.json',api:'stub-api.mjs (nothing spent)'}},async p=>{
   p.serve('maws',server);
   p.on('can_use_tool',r=>{p.note({event:'permission_asked',tool:r.tool_name});return r.tool_name.startsWith('mcp__maws__')?{behavior:'allow',updatedInput:r.input}:{behavior:'deny',message:'Only the maws server is in scope.'};});
   success(await p.init({...initPayload(run.cwd),sdkMcpServers:['maws']}),'initialize');
   p.note({event:'sent',artifact:ARTIFACT,words:WORDS,read:READ,block:BLOCK});
   await p.turn([{type:'text',text:WORDS},{type:'text',text:BLOCK}]);
   p.note({event:'init_tools',maws:(initFrame(p)?.tools??[]).filter(t=>t.startsWith('mcp__maws__'))});
   p.note({event:'stub_requests',requests:stub.requests});
   p.note({event:'server_calls',calls:server.calls});
   p.note({event:'transcript_tools',toolUses:toolUses(p),toolResults:toolResults(p)});
   // what the engine keeps: the human record's content in its transcript
   const kept=readFileSync(transcriptPath(run,p.sessionId),'utf8').trim().split('\n').map(l=>JSON.parse(l)).filter(r=>r.type==='user'&&Array.isArray(r.message?.content)&&r.message.content.some(b=>b.type==='text'&&b.text===WORDS));
   p.note({event:'transcript_user',records:kept.map(r=>({isMeta:r.isMeta??null,content:r.message.content.map(b=>b.type==='text'?{type:'text',same:b.text===WORDS?'words':b.text===BLOCK?'block':'other',chars:b.text.length}:{type:b.type})}))});
   check(p,'the engine sent the stub at least one main-loop request',stub.requests.some(r=>r.main),stub.requests.map(r=>r.path));
   await endAsStop(p);
  });
 }finally{await stub.close();removeRun(run);}
};
