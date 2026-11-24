// Board tickets 421 and 420 (docs/doperpowers/plans/2026-11-23-tool-choice.md, "Probes"): three questions about the
// engine that decide the plan's shape, answered from what the engine sends a scripted Messages API stand-in
// (../../stub-api.mjs), so nothing is spent. The probe hosts a `maws` server as MAWS declares it (initialize's
// `sdkMcpServers: ['maws']`) with a short stand-in tool list: the names are MAWS's, the schemas are drafts, since every
// question here is about the engine and none about a description.
//   uxwave-421-ask-upfront       P1: under ENABLE_TOOL_SEARCH=true, is the one tool listed with
//                                `_meta["anthropic/alwaysLoad"]: true` (ask) sent without `defer_loading`, and every
//                                other maws tool deferred; the scripted model calls the ask directly. Recorded again by
//                                the plan's M2 with MAWS's own list and paragraph (./uxwave-421-maws-tools.json, a full
//                                set's, which src/shared/maws/tools.test.ts pins to the source), so it answers A7
//   uxwave-421-ask-upfront-unset the same list with ENABLE_TOOL_SEARCH absent (what MAWS leaves a direct launch with);
//                                the stub's address is not Anthropic's, so this records the engine's default for a
//                                third-party base URL only
//   uxwave-421-ask-refused       ticket 420's required `blocking`, on MAWS's own list: the scripted model asks without
//                                it, the server refuses as MAWS's host does (ASK_BLOCKING_REQUIRED), and the model asks
//                                again with `blocking: false`, is answered `{status: "asked", askId}` and writes on;
//                                e2e/maws-tools.spec.ts replays it through MAWS's host
//   uxwave-421-resume-first,     P2's other half, a change at a relaunch: one session under the full list, then a
//   uxwave-421-resume-changed    `--resume` of it with the server answering a changed paragraph and the changed set:
//                                which paragraph and which tools does the resumed session's request carry
//   uxwave-421-list-changed      P2: after the first turn the host sends the server's
//                                `notifications/tools/list_changed` (a `control_request {subtype: 'mcp_message'}`, the
//                                direction an SDK host speaks for its server) and the server lists a different set
//                                (ask and artifact_dataset gone, artifact_edit added): does the engine ask `tools/list`
//                                again, and does the next request carry the new set
//   uxwave-421-list-changed-flat the same with ENABLE_TOOL_SEARCH=false, where every tool is in the request whole
//   uxwave-421-upgrade-first,    the upgrade ticket 420 makes, for a session started before it: under the old list (the
//   uxwave-421-upgrade-resumed   ask deferred, its description saying it waits by default; artifact_read always
//                                loaded) the scripted model loads the ask through ToolSearch and calls it; then a
//                                `--resume` under the new list (the ask always loaded with a changed description,
//                                artifact_read deferred): which description of the ask, and is artifact_read still whole
//   uxwave-421-native-ask        P3: MAWS's launch without `--disallowedTools AskUserQuestion` and a maws server that
//                                lists no ask: is the built-in in the request's tools up front, does a call raise
//                                `can_use_tool` on the wire, and does the host's allow with `updatedInput.answers`
//                                reach the model as the tool's result
import {readFileSync} from 'node:fs';
import {check,success,initFrame,endAsStop,launch,scratchRun,removeRun,initPayload,toolResults,toolUses,delay,randomUUID} from './p1-common.mjs';
import {SdkServer} from '../../sdk-mcp.mjs';
import {startStubApi,toolTurn,textTurn} from '../../stub-api.mjs';

const obj=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const tool=(name,title,description,inputSchema,extra={})=>({name,title,description,inputSchema,annotations:{readOnlyHint:true,openWorldHint:false,title},...extra});
const ASK=tool('ask','Ask questions','Ask the user one or several questions at once through a MAWS sheet (the ticket 421 probe\'s draft).',obj({questions:{type:'array',items:obj({question:{type:'string'},modality:{type:'string'}},['question','modality'])},blocking:{type:'boolean'}},['questions']),{_meta:{'anthropic/alwaysLoad':true}});
const SHOW_PANE=tool('show_pane','Show pane','Open a MAWS pane for the user (draft).',obj({pane:{type:'string'},target:{type:'string'}},['pane']));
const artifact=(name,title)=>tool(name,title,`${title} (the ticket 421 probe's draft).`,obj({artifact:{type:'string'}},['artifact']));
const CREATE=artifact('artifact_create','Create artifact'),READ=artifact('artifact_read','Read artifact'),PUBLISH=artifact('artifact_publish','Publish artifact'),SEARCH=artifact('artifact_search','Search artifacts'),EDIT=artifact('artifact_edit','Edit document'),DATASET=artifact('artifact_dataset','Dashboard dataset');
const FULL=[ASK,SHOW_PANE,CREATE,READ,PUBLISH,DATASET,SEARCH];
// The list before ticket 420 and after it, for the upgrade pair: the ask's two descriptions are told apart by a marker.
const {_meta:_always,...ASK_DEFERRED}=ASK;
const OLD_LIST=[{...ASK_DEFERRED,description:'PROBE-421-OLD-ASK: with blocking true (the default) the call waits.'},SHOW_PANE,CREATE,{...READ,_meta:{'anthropic/alwaysLoad':true}},PUBLISH,DATASET,SEARCH];
const NEW_LIST=[{...ASK,description:'PROBE-421-NEW-ASK: with blocking false (the default) the call returns at once.'},SHOW_PANE,CREATE,READ,PUBLISH,DATASET,SEARCH];
const INSTRUCTIONS='PROBE-421-PARAGRAPH: MAWS artifacts are the user\'s documents. To find one, call mcp__maws__artifact_search.';
const CHANGED_INSTRUCTIONS='PROBE-421-CHANGED-PARAGRAPH: this session has no MAWS artifact tools.';
const CHANGED=[SHOW_PANE,CREATE,READ,PUBLISH,SEARCH,EDIT]; // ask and artifact_dataset gone, artifact_edit added
// M2: MAWS's own `tools/list` and paragraph for a full-set session (mawsToolList() and the instructions, dumped beside
// this file; the unit test that pins it says how to write it again)
const MAWS_OWN=JSON.parse(readFileSync(new URL('./uxwave-421-maws-tools.json',import.meta.url),'utf8'));
const OWN_LIST={tools:MAWS_OWN.tools,instructions:MAWS_OWN.instructions,served:'uxwave-421-maws-tools.json'};
// The refusal MAWS's host answers an ask that leaves `blocking` out (TOOL_ERRORS.askBlockingRequired in
// src/shared/maws/tools.ts; src/shared/maws/tools.test.ts holds the recorded fixture's to it)
const ASK_BLOCKING_REQUIRED='ask: pass blocking: false to keep working while the user answers, or blocking: true to wait for the answers.';

class MawsServer extends SdkServer{
 constructor(tools,instructions=INSTRUCTIONS,{askAsHost=false}={}){super('maws',[]);this.listed=tools;this.instructions=instructions;this.lists=0;this.askAsHost=askAsHost;}
 handle(message){
  if(message.method==='tools/call'){
   this.seen.push({method:message.method,id:message.id,kind:'request'});this.calls.push({name:message.params?.name,arguments:message.params?.arguments??null});
   const known=this.listed.some(t=>t.name===message.params?.name);
   // `askAsHost`: an ask answered as MAWS's host answers one whose answers are yet to come, refused without `blocking`
   if(this.askAsHost&&message.params?.name==='ask'){
    const blocking=message.params.arguments?.blocking;const askId=message.params._meta?.['claudecode/toolUseId']??null;
    return {jsonrpc:'2.0',id:message.id,result:typeof blocking!=='boolean'?{content:[{type:'text',text:ASK_BLOCKING_REQUIRED}],isError:true}:{content:[{type:'text',text:JSON.stringify({status:'asked',askId},null,2)}]}};
   }
   return {jsonrpc:'2.0',id:message.id,result:known?{content:[{type:'text',text:JSON.stringify({status:'ok',tool:message.params.name},null,2)}]}:{content:[{type:'text',text:`unknown tool "${message.params?.name}"`}],isError:true}};
  }
  const answer=super.handle(message);
  if(message.method==='initialize'&&answer?.result)answer.result.instructions=this.instructions;
  if(message.method==='tools/list'&&answer?.result){this.lists++;answer.result.tools=this.listed;}
  return answer;
 }
}

// What a request carried, kept to what the questions read: each tool's name and deferral, every text block that names
// the maws server (the engine's own announcements of deferred tools among them) and the tool results.
// A text block's sentences about the maws server: the engine's announcements, each cut to the part that names tools.
const mentionsOf=text=>text.split(/\n\n+/).filter(part=>/mcp__maws|PROBE-421/.test(part)).map(part=>part.slice(0,900));
const textOfSystem=s=>typeof s==='string'?s:Array.isArray(s)?s.map(b=>b?.text??'').join('\n'):'';
function record(body){
 const system=textOfSystem(body.system);const at=system.indexOf('# MCP Server Instructions');
 const messages=(body.messages??[]).map((m,i)=>({i,role:m.role,blocks:(typeof m.content==='string'?[{type:'text',text:m.content}]:m.content??[]).map(b=>{
  if(b.type==='text')return /mcp__maws|PROBE-421|deferred/i.test(b.text)?{type:'text',chars:b.text.length,paragraph:b.text.includes('PROBE-421-PARAGRAPH'),changedParagraph:b.text.includes('PROBE-421-CHANGED-PARAGRAPH'),mentions:mentionsOf(b.text)}:{type:'text',chars:b.text.length};
  if(b.type==='tool_use')return {type:'tool_use',id:b.id,name:b.name,input:b.input};
  if(b.type==='tool_result')return {type:'tool_result',tool_use_id:b.tool_use_id,is_error:b.is_error??false,content:typeof b.content==='string'?b.content.slice(0,2000):(b.content??[]).map(c=>c.type==='text'?{type:'text',text:c.text.slice(0,2000)}:{type:c.type})};
  return {type:b.type};
 })}));
 return {mcpSection:at<0?null:system.slice(at,at+600),messages,tools:(body.tools??[]).map(t=>({name:t.name,defer_loading:t.defer_loading??null})),mawsDescriptions:Object.fromEntries((body.tools??[]).filter(t=>String(t.name).startsWith('mcp__maws__')).map(t=>[t.name,t.description??null]))};
}
const mawsOf=request=>request.tools.filter(t=>t.name.startsWith('mcp__maws__'));
const PROVENANCE={charter:'docs/charter.md',child:'board tickets 421 and 420',document:'docs/doperpowers/plans/2026-11-23-tool-choice.md',api:'stub-api.mjs (nothing spent)'};

// `toolSearch: null` leaves ENABLE_TOOL_SEARCH out of the engine's environment (an undefined value is not passed on).
// `run`, `sessionId` and `resume`: a later launch of an earlier run's session, its run kept by the caller.
const MAWS_ASK_FLAGS=['--disallowedTools','AskUserQuestion','--allowedTools','mcp__maws__ask'];
async function probe(name,{question,script,tools=FULL,instructions=INSTRUCTIONS,toolSearch='true',flags=MAWS_ASK_FLAGS,body,run:given=null,sessionId,resume=null,served=null,askAsHost=false}){
 const run=given??scratchRun(name.replace(/^uxwave-/,''));
 const stub=await startStubApi({script,record});
 const server=new MawsServer(tools,instructions,{askAsHost});
 try{
  await launch(name,run,{dir:'fixtures/uxwave/',relay:false,spendCap:'0.01',...(resume!==null?{sessionId:null}:sessionId!==undefined?{sessionId}:{}),vars:{ANTHROPIC_BASE_URL:stub.url,ANTHROPIC_AUTH_TOKEN:'stub-token',ENABLE_TOOL_SEARCH:toolSearch??undefined},flags:[...flags,...(resume!==null?['--resume',resume]:[])],provenance:{...PROVENANCE,question,...(served!==null&&{served})}},async p=>{
   p.serve('maws',server);
   p.on('can_use_tool',r=>{
    p.note({event:'permission_asked',tool:r.tool_name,input:r.input});
    if(r.tool_name==='AskUserQuestion')return {behavior:'allow',updatedInput:{...r.input,answers:Object.fromEntries(r.input.questions.map(q=>[q.question,q.options[1].label]))}};
    return r.tool_name.startsWith('mcp__maws__')?{behavior:'allow',updatedInput:r.input}:{behavior:'deny',message:'Only the asks and the maws server are in scope.'};
   });
   success(await p.init({...initPayload(run.cwd),sdkMcpServers:['maws']}),'initialize');
   await body(p,{stub,server});
   const sysInit=initFrame(p);
   p.note({event:'init_tools',maws:(sysInit?.tools??[]).filter(t=>t.startsWith('mcp__maws__')),nativeAsk:(sysInit?.tools??[]).includes('AskUserQuestion')});
   p.note({event:'stub_requests',requests:stub.requests});
   p.note({event:'server_calls',calls:server.calls,seen:server.seen,lists:server.lists});
   p.note({event:'transcript_tools',toolUses:toolUses(p),toolResults:toolResults(p)});
   await endAsStop(p);
  });
 }finally{await stub.close();if(!given)removeRun(run);}
}

const upfront=async(p,{stub})=>{
 await p.turn('Ask me which colour I want.');
 const first=stub.requests.find(r=>r.main);
 check(p,'the engine sent the stub a main-loop request',first!==undefined,stub.requests.map(r=>r.path));
 const maws=mawsOf(first);
 p.note({event:'answer_p1',maws,nativeAskInRequest:first.tools.some(t=>t.name==='AskUserQuestion'),toolSearchTool:first.tools.filter(t=>/tool.?search/i.test(t.name)).map(t=>t.name)});
};
const listChanged=async(p,{stub,server})=>{
 await p.turn('Say ready.');
 const before=server.lists;
 server.listed=CHANGED;
 const answer=await p.request('mcp_message',{server_name:'maws',message:{jsonrpc:'2.0',method:'notifications/tools/list_changed'}},10000).catch(e=>({error:String(e.message)}));
 for(let i=0;i<50&&server.lists===before;i++)await delay(100);
 p.note({event:'list_changed_sent',answer,listsBefore:before,listsAfter:server.lists});
 await p.turn('Say ready again.');
 const main=stub.requests.filter(r=>r.main);
 p.note({event:'answer_p2',relisted:server.lists>before,firstTurn:mawsOf(main[0]),secondTurn:mawsOf(main.at(-1))});
};
const paragraphsOf=request=>({first:request.messages.some(m=>m.blocks.some(b=>b.paragraph))||/PROBE-421-PARAGRAPH/.test(request.mcpSection??''),changed:request.messages.some(m=>m.blocks.some(b=>b.changedParagraph))||/PROBE-421-CHANGED-PARAGRAPH/.test(request.mcpSection??'')});
const resumed=async(p,{stub})=>{
 await p.turn('Say ready.');
 const last=stub.requests.filter(r=>r.main).at(-1);
 p.note({event:'answer_resume',paragraphs:paragraphsOf(last),maws:mawsOf(last),mentions:last.messages.flatMap(m=>m.blocks.flatMap(b=>(b.mentions??[]).map(text=>({i:m.i,role:m.role,text}))))});
};
const upgraded=async(p,{stub})=>{
 await p.turn('Ask me which colour I want.');
 const main=stub.requests.filter(r=>r.main);
 p.note({event:'answer_upgrade',requests:main.map(r=>({maws:mawsOf(r),descriptions:r.mawsDescriptions,mentions:r.messages.flatMap(m=>m.blocks.flatMap(b=>(b.mentions??[]).filter(t=>t.startsWith('The following deferred')).map(text=>({i:m.i,text}))))}))});
};
const nativeAsk=async(p,{stub})=>{
 await p.turn('Ask me which colour I want.');
 const main=stub.requests.filter(r=>r.main);
 const results=main.at(-1).messages.flatMap(m=>m.blocks.filter(b=>b.type==='tool_result'));
 p.note({event:'answer_p3',nativeAsk:main[0].tools.find(t=>t.name==='AskUserQuestion')??null,maws:mawsOf(main[0]),results});
};
// M2: the refused ask and the one asked again; the second's answer stays to come, so the turn writes on and ends
const refused=async(p,{stub,server})=>{
 await p.turn('Ask me which colour the chart should use, and keep working while I answer.');
 const main=stub.requests.filter(r=>r.main);
 p.note({event:'answer_refused',calls:server.calls,results:main.at(-1).messages.flatMap(m=>m.blocks.filter(b=>b.type==='tool_result')),maws:mawsOf(main[0])});
};
const OWN_ASK={blocking:false,questions:[{question:'Which colour?',modality:'text'}]};
const CHART_ASK={questions:[{id:'q1',question:'Which colour should the chart use?',modality:'choice',options:[{label:'Teal'},{label:'Amber'}]}]};
const QUESTION={questions:[{question:'Which colour do you want?',header:'Colour',options:[{label:'Red',description:'Warm.'},{label:'Blue',description:'Cool.'}],multiSelect:false}]};

const SCENARIOS={
 'uxwave-421-ask-upfront':{question:'P1: is the ask, listed with alwaysLoad, loaded up front under tool search, and every other maws tool deferred',...OWN_LIST,script:[toolTurn('toolu_stub_ask','mcp__maws__ask',OWN_ASK),textTurn('Thanks.')],body:upfront},
 'uxwave-421-ask-upfront-unset':{question:'P1 with ENABLE_TOOL_SEARCH absent (the engine\'s default for a base URL that is not Anthropic\'s)',toolSearch:null,...OWN_LIST,script:[toolTurn('toolu_stub_ask','mcp__maws__ask',OWN_ASK),textTurn('Thanks.')],body:upfront},
 'uxwave-421-ask-refused':{question:'ticket 420: an ask without blocking is refused as MAWS\'s host refuses it; asked again with blocking false it is acknowledged and the turn writes on',...OWN_LIST,askAsHost:true,script:[toolTurn('toolu_stub_bare','mcp__maws__ask',CHART_ASK),toolTurn('toolu_stub_async','mcp__maws__ask',{blocking:false,...CHART_ASK}),textTurn('I asked which colour you want; meanwhile I will lay out the rest of the chart.')],body:refused},
 'uxwave-421-list-changed':{question:'P2: does the engine honour tools/list_changed from an SDK server mid-session, under tool search',script:[textTurn('ready'),textTurn('ready again')],body:listChanged},
 'uxwave-421-list-changed-flat':{question:'P2 without tool search (ENABLE_TOOL_SEARCH=false)',toolSearch:'false',script:[textTurn('ready'),textTurn('ready again')],body:listChanged},
 'uxwave-421-native-ask':{question:'P3: with AskUserQuestion not disallowed and no maws ask listed, does the built-in raise can_use_tool and take the host\'s answers',tools:FULL.filter(t=>t.name!=='ask'),flags:[],script:[toolTurn('toolu_stub_native','AskUserQuestion',QUESTION),textTurn('Blue it is.')],body:nativeAsk},
};
export default async()=>{
 const only=(process.env.UX421_ONLY??'').split(',').filter(Boolean);
 for(const [name,scenario] of Object.entries(SCENARIOS))if(only.length===0||only.includes(name))await probe(name,scenario);
 if(only.length>0&&!only.includes('uxwave-421-resume-changed')&&!only.includes('uxwave-421-upgrade'))return;
 const run=scratchRun('421-resume');const id=randomUUID();
 try{
  await probe('uxwave-421-resume-first',{question:'the session the resume reads: one turn under the full list and the first paragraph',run,sessionId:id,script:[textTurn('ready')],body:resumed});
  await probe('uxwave-421-resume-changed',{question:'P2 at a relaunch: a --resume of that session under a changed paragraph and a changed set',run,resume:id,tools:CHANGED,instructions:CHANGED_INSTRUCTIONS,script:[textTurn('ready again')],body:resumed});
 }finally{removeRun(run);}
 const run2=scratchRun('421-upgrade');const id2=randomUUID();const ask={questions:[{question:'Which colour?',modality:'text'}]};
 try{
  await probe('uxwave-421-upgrade-first',{question:'a session before ticket 420: the ask deferred and loaded through ToolSearch, artifact_read always loaded',run:run2,sessionId:id2,tools:OLD_LIST,script:[toolTurn('toolu_stub_search','ToolSearch',{query:'select:mcp__maws__ask',max_results:5}),toolTurn('toolu_stub_old','mcp__maws__ask',ask),textTurn('Thanks.')],body:upgraded});
  await probe('uxwave-421-upgrade-resumed',{question:'the same session resumed after ticket 420: which description of the ask the request carries, and whether artifact_read stays whole',run:run2,resume:id2,tools:NEW_LIST,script:[toolTurn('toolu_stub_new','mcp__maws__ask',ask),textTurn('Thanks again.')],body:upgraded});
 }finally{removeRun(run2);}
};
