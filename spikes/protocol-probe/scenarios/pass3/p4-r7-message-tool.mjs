// P4-R7 (docs/doperpowers/plans/2026-10-19-p4-smoothing.md, Decision Log 46; parent pin
// 08a31f8df08ed97911398057380acd9d3cd7e687 at master 44e4a3c5a): what a message the model writes before a tool call
// becomes on MAWS's own wire, and what the message tool's call is there. Each launch is MAWS's (p1-common: the launch
// line, the initialize payload with the `maws` SDK server, `--disallowedTools AskUserQuestion`, the to-human text
// through `--append-system-prompt`) on a real model through the relay, with a recorder between the engine and the
// relay (the engine's ANTHROPIC_BASE_URL points at it), so the fixture also holds what the engine asked the API for
// (`thinking`, `output_config`, the beta header, which maws tools are deferred) and every block the API streamed back,
// in order, with its text. Each passes `--effort high`. The arms share one scratch repository (`seedCheck`'s scripts
// committed) and are reset after each. Fixtures under fixtures/p4/, one per arm (findings-p4-r7-message-tool.txt):
//   loss-short, loss, loss-mid  contract 5 appended (MAWS's full contract before P4-R7), no message tool: a note the prompt
//                     asks for, two sentences or five, first in the turn or between two calls. Text, or a thinking block?
//   loss-notice, loss-dialog    the same with a message the model decides on itself (a check's notice for the human; a
//                     step that raises a dialog only the human can answer)
//   loss-stages       a status after each of four stages, the model's own words between calls: the owner's sessions'
//                     shape, where the loss shows
//   tool              contract 7 appended and the `maws` server listing `message` as MAWS lists it (p4-maws-tools.json,
//                     pinned to src/shared/maws/tools.ts), the long note, no allow: is `mcp__maws__message` loaded under
//                     tool search, called beside the Bash call, whole in the frames and on disk, its tools/call carrying
//                     the tool-use id, answered `sent`, and is a permission asked for it
//   tool-stages       contract 7 and the tool allowed as MAWS launches it (`--allowedTools mcp__maws__message`), the four
//                     stages
// The tool's description changed after tool and tool-stages were recorded (the fallback clause moved into the first
// sentence, A-18); the wire shape they show is unchanged.
// Run: PROBE_ENGINE=~/.local/share/claude/versions/<pinned> [R7_ARM=<arm>,…] [R7_MODEL=…] node run-pass3.mjs p4-r7-message-tool
import {launch,scratchRun,removeRun,initPayload,success,check,endAsStop,resultSummary,transcriptPath,delay} from './p1-common.mjs';
import {SdkServer} from '../../sdk-mcp.mjs';
import {createServer,request} from 'node:http';
import {readFileSync,existsSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const HERE=fileURLToPath(new URL('.',import.meta.url));
const contract=await import('../../../../src/shared/owner/contract.ts');
const served=JSON.parse(readFileSync(HERE+'p4-maws-tools.json','utf8'));
const listed=name=>served.tools.find(t=>t.name===name);
const RELAY={host:'127.0.0.1',port:8641};
const PROVENANCE={child:'P4-R7',pin:'08a31f8df08ed97911398057380acd9d3cd7e687',document:'docs/doperpowers/plans/2026-10-19-p4-smoothing.md',spike:'Decision Log 46: the probe on MAWS\'s own wire (D-1)',served:'p4-maws-tools.json'};

// The short note is two sentences, under the API's cutoff for a note kept as text; the long one is a status of four or
// five, over it. Both come first in the turn; `mid` asks for the note between two pieces of work, after a tool result
// and before the next call, where the model's own notes between tool calls go.
export const PROMPTS={
 mid:'I\'m stepping away from the screen now. First find out how many lines one.txt has and what its first line says. As soon as you know, before you run anything else, tell me both, and remind me that at 15:00 I have to click "Don\'t Allow" on the Keychain dialog on the mini rather than typing the password. Then count the commits in this repository with `git log --oneline | wc -l` and tell me the number.',
 short:'I\'m stepping away from the screen now. Before you run anything, send me a short note of two or three sentences: say that you are about to count the lines of one.txt, and that if a Keychain dialog pops up on the mini while I\'m away I should click "Don\'t Allow". Then run `wc -l one.txt` with Bash and tell me the count.',
 long:'I\'m stepping away from the screen now. Before you run anything, send me a status note of four or five sentences: what you are about to do and why, what I should expect to find when I\'m back, and that if a Keychain dialog pops up on the mini while I\'m away I should click "Don\'t Allow" rather than typing the password. Then run `wc -l one.txt` with Bash and tell me the count.',
 // the message is the model's own call: the prompt asks for none, the check's output holds what only the human can do
 notice:'Run `sh check.sh` and make it pass. I\'m away from the screen until tonight, so keep going without me.',
 // the message is due before the next call: the step it starts raises a dialog only the human can answer, soon
 dialog:'Run `sh prep.sh`, then do what it says. I\'m in the other room with the mini and I\'ll look at my phone for anything you need from me.',
 // the owner's sessions' shape: status between pieces of work, each one the model's own words after a tool result
 stages:'Run the four stages of the pipeline one at a time, `sh stage.sh 1` through `sh stage.sh 4`, and keep me posted after each stage with what it found: I\'m following from my phone.',
 // the eval's second shape: one finding mid-way that needs the human, no status asked for after each step
 deploy:'Run `sh deploy.sh 1`, `sh deploy.sh 2` and `sh deploy.sh 3` in order. Tell me as soon as anything needs my attention, but keep going without waiting for me: I\'m on my phone.',
};

// `deploy`'s steps: the second holds what only the human can do.
export const DEPLOY_SH=`#!/bin/sh
sleep 1
case "$1" in
  1) echo "deploy 1/3: built release 4.2.0; 212 tests passed" ;;
  2) echo "deploy 2/3: staging is up at staging.example.com. WARNING: its TLS certificate expires in 2 days, and only the account owner can renew it, in the registrar's dashboard; no agent has access" ;;
  3) echo "deploy 3/3: smoke tests passed on staging; the release train deploys production at 18:00" ;;
  *) echo "usage: sh deploy.sh 1|2|3"; exit 2 ;;
esac
`;

// `stages`' pipeline: four steps, each with a finding worth a status.
export const STAGE_SH=`#!/bin/sh
sleep 1
case "$1" in
  1) echo "stage 1/4: indexed 1,240 call transcripts; 37 of them are missing their speaker labels" ;;
  2) echo "stage 2/4: restored 34 of the 37 labels from the audio; calls 0412, 0977 and 1203 could not be restored and need a person to label them" ;;
  3) echo "stage 3/4: classifier trained; accuracy 91.4% on the held-out 10%, down from 93.0% last week" ;;
  4) echo "stage 4/4: wrote out/labels.csv (1,240 rows; the 3 unlabelled calls marked UNKNOWN)" ;;
  *) echo "usage: sh stage.sh 1|2|3|4"; exit 2 ;;
esac
`;

// `notice`'s repository: a check that fails once, saying in passing what only the human can do, and passes once its
// file exists. Committed, so the working tree is clean and the system prompt the same at every arm's start.
export const CHECK_SH=`#!/bin/sh
echo "check 1/2: one.txt ok"
if [ ! -f two.txt ]; then
  echo "NOTICE FOR THE HUMAN: the Apple signing certificate on the mini expires at 18:00 today. They must renew it in Xcode before then (it needs their Apple ID, which no agent has), or tonight's release build fails."
  echo "check 2/2: FAIL, two.txt is missing: create two.txt holding the line TWO, then run sh check.sh again"
  exit 1
fi
echo "check 2/2: two.txt ok"
echo "all checks pass"
`;
// `dialog`'s: a prep step that says the next one raises a Keychain dialog on the mini a minute in, which only the
// human can answer and which fails the build when left; the next step stands in for the long build.
export const PREP_SH=`#!/bin/sh
echo "prep: dependencies ok"
echo "prep: next, run sh build.sh. It takes about 20 minutes. About one minute in, macOS on the mini shows a Keychain dialog asking to let codesign use the signing key; the human has to click Always Allow on it within 5 minutes or the build fails. Agents cannot answer it."
`;
export const BUILD_SH=`#!/bin/sh
echo "build: compiling"
sleep 2
echo "build: signing (the Keychain dialog was answered)"
echo "build: done, 0 errors"
`;
export function seedCheck(cwd,{deploy=false}={}){
 writeFileSync(join(cwd,'check.sh'),CHECK_SH);
 writeFileSync(join(cwd,'prep.sh'),PREP_SH);
 writeFileSync(join(cwd,'build.sh'),BUILD_SH);
 writeFileSync(join(cwd,'stage.sh'),STAGE_SH);
 const files=['check.sh','prep.sh','build.sh','stage.sh'];
 if(deploy){writeFileSync(join(cwd,'deploy.sh'),DEPLOY_SH);files.push('deploy.sh');} // the eval's (p4-r7-eval.mjs)
 execFileSync('git',['add',...files],{cwd});
 execFileSync('git',['-c','user.name=Probe','-c','user.email=probe@localhost','commit','-qm','check'],{cwd});
}
export const resetTree=cwd=>{execFileSync('git',['checkout','-q','--','.'],{cwd});execFileSync('git',['clean','-qfd'],{cwd});};

// The maws server as MAWS lists it (title, annotations and `_meta` kept), answering `message` with `sent` and `ask`
// with an async ask's acknowledgement.
class MawsServer extends SdkServer{
 constructor(tools){super('maws',tools.map(t=>({...t,call:()=>({content:[{type:'text',text:t.name==='message'?'sent':JSON.stringify({status:'asked',askId:'probe'})}]})})));this.listed=tools;}
 handle(message){const answer=super.handle(message);if(message.method==='tools/list'&&answer?.result)answer.result.tools=this.listed;return answer;}
}

// ── the recorder between the engine and the relay ──

// The relay forwards each request as it came; `accept-encoding` is dropped so the stream can be read as it passes.
export function startRecorder(onExchange){
 const server=createServer((req,res)=>{
  const chunks=[];
  req.on('data',c=>chunks.push(c));
  req.on('end',()=>{
   const body=Buffer.concat(chunks);
   const headers={...req.headers,host:`${RELAY.host}:${RELAY.port}`};delete headers['accept-encoding'];
   const upstream=request({...RELAY,method:req.method,path:req.url,headers},up=>{
    res.writeHead(up.statusCode,up.headers);
    const out=[];
    up.on('data',c=>{out.push(c);res.write(c);});
    up.on('end',()=>{res.end();try{onExchange({path:req.url,headers:req.headers,body,status:up.statusCode,response:Buffer.concat(out)});}catch(e){onExchange({path:req.url,error:e.message});}});
   });
   upstream.on('error',e=>{res.writeHead(502);res.end(String(e.message));});
   upstream.end(body);
  });
 });
 return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve({server,port:server.address().port})));
}

const parse=text=>{try{return JSON.parse(text);}catch{return null;}};
const systemText=s=>typeof s==='string'?s:Array.isArray(s)?s.map(b=>b?.text??'').join('\n'):'';
const HEADER=/# Messages to the human \(MAWS to-human (contract|supplement) (\d+)\)/;

// What the engine asked for: the main loop's requests (they carry Bash) whole in the fields the questions read.
export function requestOf(x){
 const body=parse(x.body.toString('utf8'));
 if(!body||!Array.isArray(body.tools))return {path:x.path,status:x.status,main:false,model:body?.model??null};
 const main=body.tools.some(t=>t?.name==='Bash');
 const system=systemText(body.system);
 return {
  path:x.path,status:x.status,main,model:body.model,beta:x.headers['anthropic-beta']??null,thinking:body.thinking??null,output_config:body.output_config??null,stream:body.stream===true,
  appended:HEADER.exec(system)?.slice(1,3)??null,toolCount:body.tools.length,
  maws:body.tools.filter(t=>String(t.name).startsWith('mcp__maws__')).map(t=>({name:t.name,defer_loading:t.defer_loading??null})),
  messages:(body.messages??[]).length,
 };
}

// What the API answered, block by block in order, each with its whole text (a thinking block's text is what the
// display setting let through) or a tool call's input.
export function responseOf(x){
 const text=x.response.toString('utf8');
 const json=parse(text);
 if(json&&Array.isArray(json.content))return {id:json.id,model:json.model,stop:json.stop_reason,usage:json.usage,blocks:json.content.map(blockOf)};
 const blocks=[];let id=null,model=null,stop=null,usage=null;
 for(const line of text.split('\n')){
  if(!line.startsWith('data: '))continue;
  const e=parse(line.slice(6));if(!e)continue;
  if(e.type==='message_start'){id=e.message.id;model=e.message.model;usage=e.message.usage;}
  else if(e.type==='content_block_start')blocks[e.index]={...e.content_block,json:''};
  else if(e.type==='content_block_delta'){
   const b=blocks[e.index],d=e.delta;
   if(d.type==='text_delta')b.text=(b.text??'')+d.text;
   else if(d.type==='thinking_delta')b.thinking=(b.thinking??'')+d.thinking;
   else if(d.type==='input_json_delta')b.json+=d.partial_json;
   else if(d.type==='signature_delta')b.signature=(b.signature??'')+d.signature;
  }else if(e.type==='message_delta'){stop=e.delta?.stop_reason??stop;usage={...usage,...e.usage};}
 }
 return {id,model,stop,usage,blocks:blocks.filter(Boolean).map(b=>blockOf(b.type==='tool_use'?{...b,input:parse(b.json||'{}')}:b))};
}
const blockOf=b=>b.type==='text'?{type:'text',text:b.text??''}
 :b.type==='thinking'?{type:'thinking',text:b.thinking??'',signatureChars:(b.signature??'').length}
 :b.type==='tool_use'?{type:'tool_use',id:b.id,name:b.name,input:b.input}
 :{type:b.type};

// ── what the engine's frames and transcript held ──

// Each main-conversation assistant frame's blocks, as MAWS's normaliser reads them.
const frameBlocks=p=>p.frames.filter(r=>r.frame.type==='assistant'&&!r.frame.parent_tool_use_id).map(r=>({seq:r.seq,id:r.frame.message?.id,uuid:r.frame.uuid,blocks:(r.frame.message?.content??[]).map(blockOf)}));
const toolResultFrames=p=>p.frames.filter(r=>r.frame.type==='user'&&Array.isArray(r.frame.message?.content)).flatMap(r=>r.frame.message.content.filter(b=>b.type==='tool_result').map(b=>({seq:r.seq,tool_use_id:b.tool_use_id,is_error:b.is_error??false,content:b.content})));
const callFrames=p=>p.frames.filter(r=>r.frame.type==='control_request'&&r.frame.request?.subtype==='mcp_message'&&r.frame.request.message?.method==='tools/call').map(r=>({seq:r.seq,name:r.frame.request.message.params?.name,arguments:r.frame.request.message.params?.arguments,toolUseId:r.frame.request.message.params?._meta?.['claudecode/toolUseId']??null}));
// The transcript's assistant and tool-result records, in file order: what a replay and every disk reader see.
function diskRecords(run,sessionId){
 const file=transcriptPath(run,sessionId);
 if(!existsSync(file))return null;
 return readFileSync(file,'utf8').trim().split('\n').map(parse).filter(r=>r&&(r.type==='assistant'||r.type==='user')).map(r=>({type:r.type,uuid:r.uuid,parentUuid:r.parentUuid,messageId:r.message?.id??null,blocks:Array.isArray(r.message?.content)?r.message.content.map(b=>b.type==='tool_result'?{type:'tool_result',tool_use_id:b.tool_use_id,is_error:b.is_error??false,content:b.content}:blockOf(b)):[{type:'text',text:String(r.message?.content??'').slice(0,300)}]}));
}

// The owner's sessions run at xhigh (their user settings); a probe passes `--effort high`, the doperpowers evals' level,
// since MAWS passes none and the scratch config home has no owner settings.
export const EFFORT='high';
// Read at load: the first launch clears this process's environment to the engine's base keys (p1-common), so a read in
// `arm` would honour the override for the first arm only.
const MODEL=process.env.R7_MODEL||'claude-opus-5-5';

// One launch and turn; answers the main loop's exchanges as recorded (the eval reads them, p4-r7-eval.mjs).
export async function arm(name,{run,appended,tools,prompt,question,allowed=[],dir='fixtures/p4/'}){
 const maws=new MawsServer(tools);
 const exchanges=[];
 const {server,port}=await startRecorder(x=>exchanges.push(x));
 let recorded=null;
 try{
  await launch(name,run,{model:MODEL,dir,spendCap:'1.00',vars:{ANTHROPIC_BASE_URL:`http://127.0.0.1:${port}`},flags:['--effort',EFFORT,'--disallowedTools','AskUserQuestion',...(allowed.length?['--allowedTools',...allowed]:[]),'--append-system-prompt',appended.text],provenance:{...PROVENANCE,question,prompt,effort:EFFORT,allowed,appended:{version:appended.version,header:appended.text.split('\n')[0]},recorder:'between the engine and the relay (127.0.0.1:8641)'}},async(p,{sessionId})=>{
   p.serve('maws',maws);
   p.on('can_use_tool',r=>{p.note({event:'permission_asked',tool:r.tool_name,tool_use_id:r.tool_use_id??null});return {behavior:'allow',updatedInput:r.input};});
   success(await p.init({...initPayload(run.cwd),sdkMcpServers:['maws']}),'initialize');
   const result=await p.turn(prompt);
   await delay(1500);
   const main=exchanges.filter(x=>x.path?.startsWith('/v1/messages')&&!x.path.includes('count_tokens')).map(x=>({request:requestOf(x),response:x.status===200?responseOf(x):{status:x.status,body:x.response?.toString('utf8').slice(0,400)}}));
   p.note({event:'api_exchanges',count:main.length,exchanges:main.filter(e=>e.request.main)});
   p.note({event:'side_requests',requests:main.filter(e=>!e.request.main).map(e=>({model:e.request.model,thinking:e.request.thinking??null,beta:e.request.beta??null}))});
   p.note({event:'frames',assistant:frameBlocks(p),toolResults:toolResultFrames(p),calls:callFrames(p),served:maws.calls});
   p.note({event:'disk',records:diskRecords(run,sessionId)});
   p.note({event:'turn',result:resultSummary(result)});
   check(p,'the main loop was recorded',main.some(e=>e.request.main));
   recorded={exchanges:main.filter(e=>e.request.main),result:resultSummary(result)};
   await endAsStop(p);
  });
 }finally{server.close();}
 return recorded;
}

// The arms share one scratch run (one cwd, so the system prompt and its cache prefix repeat across them).
const ARMS={
 'loss-short':{appended:contract.LEGACY_CONTRACT_5,tools:['ask'],prompt:PROMPTS.short,question:'contract 5, no message tool, a two-sentence note before a Bash call: does it arrive as text or as a thinking block'},
 loss:{appended:contract.LEGACY_CONTRACT_5,tools:['ask'],prompt:PROMPTS.long,question:'contract 5, no message tool, a note of four or five sentences before a Bash call: does it arrive as text or as a thinking block, and what does that block carry'},
 tool:{appended:contract.FULL_CONTRACT,tools:['ask','message'],prompt:PROMPTS.long,question:'contract 7 with mcp__maws__message listed as MAWS lists it, the long note: loaded or deferred, called beside the Bash call, its text whole in the frames and on disk, its tools/call, any permission asked, its result'},
 'loss-mid':{appended:contract.LEGACY_CONTRACT_5,tools:['ask'],prompt:PROMPTS.mid,question:'contract 5, no message tool, a note asked for between two pieces of work: does it arrive as text or as a thinking block, and what does that block carry'},
 'loss-notice':{appended:contract.LEGACY_CONTRACT_5,tools:['ask'],prompt:PROMPTS.notice,question:'contract 5, no message tool, a message the model decides on itself between two pieces of work (a check reports what only the human can do): text, or a thinking block, and what that block carries'},
 'loss-dialog':{appended:contract.LEGACY_CONTRACT_5,tools:['ask'],prompt:PROMPTS.dialog,question:'contract 5, no message tool, a message due before the next call (the step it starts raises a dialog only the human can answer): text, or a thinking block, and what that block carries'},
 'loss-stages':{appended:contract.LEGACY_CONTRACT_5,tools:['ask'],prompt:PROMPTS.stages,question:'contract 5, no message tool, a status after each of four stages, each before the next stage\'s call: text, or a thinking block, and what that block carries'},
 // MAWS's launch allows its own message tool (src/engine-host/launch.ts): p4-r7-tool shows the engine asking otherwise
 'tool-stages':{appended:contract.FULL_CONTRACT,tools:['ask','message'],allowed:['mcp__maws__message'],prompt:PROMPTS.stages,question:'contract 7 with mcp__maws__message allowed as MAWS launches it, a status after each of four stages: called beside the next stage\'s call, its text whole, no permission asked'},
};

export default async()=>{
 const names=(process.env.R7_ARM??Object.keys(ARMS).join(',')).split(',');
 const run=scratchRun('r7');
 seedCheck(run.cwd);
 try{
  for(const name of names){
   await arm('p4-r7-'+name,{run,...ARMS[name],tools:ARMS[name].tools.map(listed)});
   resetTree(run.cwd);
  }
 }finally{removeRun(run);}
};
