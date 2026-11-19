// UX wave U2b, check 1, the live part, one turn per advertisement (docs/doperpowers/plans/2026-11-15-ux-wave-U2b-to-
// human-view.md, check 1: "Live, a few model calls on the smallest model"): questions A2 (a real message call's row
// answered), B (the mod's entry in `system/init`) and D (no advertisement, at a launch).
//
// For each advertisement (none, 8, 9) and installation (before, after) a new session is launched as MAWS launches one,
// on haiku through the VM's gateway, and given one turn. Where an advertisement is carried (8, 9) the model is asked to
// call the mod's message tool once with `final: true`; with none (where a headless launch registers no tool) it is asked
// for a reply that is one marked message. After the turn the message's row is asked as MAWS asks it (the call's
// ToolUse, or the text's AssistantMessage) and the band. Fixtures u2b-mod-<none|8|9>-<before|after>-live.jsonl.
// U2B_CASES picks cases (default all six).
import {scratch,mawsLaunch,render,ASK,removeRun,pluginsOf,rootOf,prompt,waitResult,initFrames,resultFrames,delay} from './uxwave-u2b-mod-common.mjs';
import {randomUUID} from 'node:crypto';

const ALL=['none-before','none-after','8-before','8-after','9-before','9-after'];
const CASES=(process.env.U2B_CASES||ALL.join(',')).split(',').filter(Boolean);
const TEXT='Live check: the turn is done.';
const TOOL_PROMPT=`This is a test of your tools. Call the tool mcp__to-human__message once, with its text exactly \`${TEXT}\` and final set to true. Call nothing else and write nothing else.`;
const MARK_PROMPT=`Reply with exactly <message>${TEXT}</message> and nothing else. Use no tool.`;

async function live(tag){
 const [adv,which]=tag.split('-');const advert=adv==='none'?null:adv;
 const name=`u2b-mod-${adv}-${which}-live`;
 const run=scratch(`live-${adv}-${which}`,which);
 try{
  await mawsLaunch(name,run,{advert,sessionId:randomUUID(),model:'haiku',provenance:{part:'live',questions:['A2','B','D'],prompt:advert?TOOL_PROMPT:MARK_PROMPT}},async p=>{
   const s=prompt(p,advert?TOOL_PROMPT:MARK_PROMPT);
   const result=await waitResult(p,s.seq);
   await delay(3000);
   const init=initFrames(p).at(-1)?.frame;
   const plugins=pluginsOf(init?.plugins);
   p.note({event:'u2b_init',seq:initFrames(p).at(-1)?.seq,messageToolRegistered:(init?.tools??[]).includes('mcp__to-human__message'),toolsWithMessage:(init?.tools??[]).filter(t=>/message/i.test(t)),plugins,toHumanRoot:plugins.filter(x=>x.name==='to-human').map(x=>({path:x.path,...rootOf(x.path)})),sessionId:init?.session_id,resultSubtype:result.subtype,numTurns:result.num_turns,cost:result.total_cost_usd,modelUsage:result.modelUsage});
   const assistant=p.frames.filter(r=>r.frame.type==='assistant'&&!r.frame.parent_tool_use_id);
   const call=assistant.flatMap(r=>(r.frame.message?.content??[]).filter(b=>b.type==='tool_use'&&b.name==='mcp__to-human__message').map(b=>({b,uuid:r.frame.uuid,seq:r.seq})))[0];
   const text=assistant.flatMap(r=>(r.frame.message?.content??[]).filter(b=>b.type==='text'&&b.text.trim()).map(b=>({b,uuid:r.frame.uuid,seq:r.seq})));
   if(call)await render(p,{component:'ToolUse',instance_id:call.b.id,props:{tool_use_id:call.b.id,tool:call.b.name,input:call.b.input,isRunning:false,isErrored:false,isInterrupted:false,output:'sent'}},`the message call (assistant frame seq ${call.seq})`);
   for(const t of text)await render(p,{component:'AssistantMessage',instance_id:t.uuid,props:{text:t.b.text,isFirstOfReply:true}},`a text of the reply (assistant frame seq ${t.seq})`);
   await render(p,ASK.band(),'band after the turn');
   await delay(4000);
   if(call)await render(p,{component:'ToolUse',instance_id:call.b.id,props:{tool_use_id:call.b.id,tool:call.b.name,input:call.b.input,isRunning:false,isErrored:false,isInterrupted:false,output:'sent'}},'the message call, again');
   await render(p,ASK.band(),'band, again');
  });
 }finally{removeRun(run);}
}
export default async()=>{for(const tag of CASES)await live(tag);};
