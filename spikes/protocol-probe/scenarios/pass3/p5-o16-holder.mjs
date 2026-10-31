// P5 O16 M0, the -p spike (U6) (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M0; parent
// docs/doperpowers/plans/2026-10-27-p5-org.md, child O16; document blob b429c8f3e697aaa8b4d7bf837c81db5f66ffe841;
// 2026-10-31): what the session host and the reap rely on the engine for, measured on MAWS's own launch line before
// anything is built on it (charter D-1):
//   1  does sminos's observe-only bridge load in a `claude -p` under MAWS's launch line (MAWS_LANE=B, SMNS_MEMBER the
//      engine's parent), and does a `turn.step` fence mod hold an engine-started turn (a cron fire; a background task's
//      completion notification) before the main model request?
//   2  what do `end_session` and SIGTERM each do to a -p process with a background shell running, and with a permission
//      pending: SessionEnd's reason, the transcript's flush, the exit code and time, the shell's fate, and after one the
//      engine ignored, whether a turn on the same stdin still runs?
//   3  after a second `initialize` on the same stdin: the pending requests in its answer, the old hook callbacks
//      (retired or kept), an outstanding `tools/call` (kept, its late response taken), a late `control_response` to an
//      id the engine never sent, a `background_tasks_changed` snapshot; and whether Stop's `background_tasks` carry
//      `ambient`?
//   4  what lives under a resting -p session (sminos, two stdio MCP servers) and a working one (a foreground Bash, a
//      background Bash, a Monitor, a subagent), and does get_settings carry each MCP server's command and args?
//   5  does the engine take --await-initialize, and does it hold a resurrected cron's fire until initialize?
// (Question 6, the relay hop, is ../../p5-o16-relay/bench.mjs.)
// Each launch is MAWS's (p1-common: the launch line, the initialize payload, a scratch config home; spawned detached,
// as transport.ts spawns) against a scripted Messages API (stub-api.mjs's sseOf; nothing spent) keyed by content: a
// prompt's `[[O16:<plan>]]` marker picks its plan, a tool_result continues the plan of the tool_use it answers, and a
// background task's notification is answered as one. sminos is installed into each scratch config home from a
// doperpowers checkout (`claude plugin marketplace add`, `claude plugin install sminos@doperpowers`; O16_DOPERPOWERS
// names it, O16_DOPERPOWERS_REV its commit); the fence is a plugin of its own under --plugin-dir, its mode a file the
// scenario rewrites before each step, its trace `$.ui.log` lines on the wire. Mods load under
// CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1, the owner's switch. Fixtures fixtures/p5/p5-o16-holder-<arm>[O16_SUFFIX].jsonl,
// findings in findings-p5-o16-holder.txt. Run on a devcloud VM as a dedicated user with /etc/claude-code hidden, never
// on the owner's MacBook:
//   PROBE_ENGINE=<binary> O16_DOPERPOWERS=<checkout> O16_DOPERPOWERS_REV=<sha> [O16_SUFFIX=-installed] \
//     [O16_ARMS=main,end-session,sigterm,reinit,await] node run-pass3.mjs p5-o16-holder
import {launch,scratchRun,removeRun,initPayload,success,check,endAsStop,delay,randomUUID,existsSync,ENGINE_VERSION,BIN,transcriptPath,join,writeFileSync,mkdirSync,summarise} from './p1-common.mjs';
import {sseOf,jsonOf,textTurn,toolTurn} from '../../stub-api.mjs';
import {blocks,textOf} from './e7-common.mjs';
import {idle} from './c8b-common.mjs';
import {redact} from '../../harness.mjs';
import {sdkMcpAnswer} from '../../sdk-mcp.mjs';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';

// Read at load: every launch clears this process's environment to its base keys.
const DOPERPOWERS=process.env.O16_DOPERPOWERS??null;
const DOPERPOWERS_REV=process.env.O16_DOPERPOWERS_REV??null;
const SUFFIX=process.env.O16_SUFFIX??'';
const ARMS=(process.env.O16_ARMS??'main,end-session,sigterm,reinit,await').split(',');
const NODE=process.execPath;
const PATH_AT_LOAD=process.env.PATH;

const PROVENANCE={child:'P5-O16',pin:'b429c8f3e697aaa8b4d7bf837c81db5f66ffe841',document:'docs/doperpowers/plans/2026-10-31-p5-o16-holder.md',spike:'M0: the -p spike (U6)',api:'a content-keyed script over stub-api.mjs sseOf (nothing spent)'};
const STOP_HOOKS={Stop:[{hookCallbackIds:['maws_Stop_1'],timeout:10}]};
const MANAGED=['/etc/claude-code/managed-settings.json','/Library/Application Support/ClaudeCode/managed-settings.json'];
const DEBUG=/hooks? module|function hooks|turn\.step|O16|bridge|sminos|resurrect|cron|schedul|await|SessionEnd|shutdown|SIGTERM|end_session|reinit|redeliver|retire|Monitor|plugin/i;
const MAWS_TOOL_FLAGS=['--disallowedTools','AskUserQuestion','--allowedTools','mcp__maws__ask']; // launch.ts, when the maws server is offered

// ---- the scripted API ----
const search=names=>toolTurn(null,'ToolSearch',{query:'select:'+names.join(','),max_results:names.length});
const tool=(name,input)=>toolTurn(null,name,input);
const bg=(command,description)=>tool('Bash',{command,description,run_in_background:true});
// A one-shot cron at the first whole minute at least 70 s away (the engine runs under TZ=UTC).
export function oneShotCron(at=Date.now()){const t=new Date(at+70000);t.setUTCSeconds(0,0);t.setUTCMinutes(t.getUTCMinutes()+1);return `${t.getUTCMinutes()} ${t.getUTCHours()} ${t.getUTCDate()} ${t.getUTCMonth()+1} *`;}
const PLANS={
 PLAIN:()=>[textTurn('OK.')],
 FG:()=>[tool('Bash',{command:'sleep 6',description:'o16 foreground sleep'}),textTurn('Slept.')],
 BG600:()=>[bg('sleep 600','o16 background sleep'),textTurn('Started.')],
 BG300:()=>[bg('sleep 300','o16 background sleep'),textTurn('Started.')],
 BG900:()=>[bg('sleep 900','o16 background sleep'),textTurn('Started.')],
 MON:()=>[search(['Monitor']),s=>tool('Monitor',{command:`tail -f ${s.monitorFile}`,description:'o16 monitor tail',persistent:true}),textTurn('Watching.')],
 SUB:()=>[s=>tool(s.agentTool,{description:'Sleep briefly',prompt:'[[O16:SUBTASK]] Run the sleep.',subagent_type:'general-purpose'}),textTurn('The subagent is running.')],
 SUBTASK:()=>[tool('Bash',{command:'sleep 8',description:'o16 subagent sleep'}),textTurn('Slept.')],
 NOTE0:()=>[bg('sleep 4','o16 notification baseline'),textTurn('Started.')],
 NOTE:()=>[bg('sleep 4','o16 notification held'),textTurn('Started.')],
 NOTE2:()=>[bg('sleep 4','o16 notification refused'),textTurn('Started.')],
 CRON:()=>[search(['CronCreate','CronList']),()=>tool('CronCreate',{cron:oneShotCron(),prompt:'[[O16:FIRE]] one-shot job',recurring:false}),textTurn('Scheduled.')],
 SEED:()=>[search(['CronCreate','CronList']),tool('CronCreate',{cron:'* * * * *',prompt:'[[O16:FIRE]] minute job',recurring:true}),textTurn('Scheduled.')],
 FIRE:()=>[textTurn('Fired.')],
 NOTIFIED:()=>[textTurn('Noted.')],
 PENDING:()=>[tool('Bash',{command:'curl -s http://127.0.0.1:9/O16_PENDING',description:'o16 pending permission'}),textTurn('(after the permission)')],
 // three calls in one message, each concurrency-safe, so each can be outstanding at once: the maws server's `hold`
 // (its tools/call held), a Read outside the cwd (its permission held), the server's `hooked` (its PreToolUse
 // callback held; 2.1.283 offers no Grep)
 PAR:()=>[{blocks:[{type:'tool_use',name:'mcp__maws__hold',input:{}},{type:'tool_use',name:'Read',input:{file_path:'/etc/hostname'}},{type:'tool_use',name:'mcp__maws__hooked',input:{}}],stop:'tool_use'},textTurn('All three answered.')],
};
const MARK=/\[\[O16:([A-Z0-9_]+)\]\]/;
const isMainLoop=body=>Array.isArray(body.tools)&&body.tools.some(t=>t?.name==='Bash'||t?.name==='Read');
const userBlocks=m=>m?.role!=='user'?[]:typeof m.content==='string'?[{type:'text',text:m.content}]:m.content??[];
const resultText=b=>typeof b.content==='string'?b.content:Array.isArray(b.content)?b.content.map(x=>x.text??'').join('\n'):'';

export async function startScriptedApi(state={}){
 const requests=[];const issued=new Map();let n=0;state.agentTool??='Agent';
 const answer=body=>{
  if(!isMainLoop(body))return {kind:'side',turn:textTurn('ok')};
  const names=body.tools.map(t=>t.name);
  if(names.includes('Agent'))state.agentTool='Agent';else if(names.includes('Task'))state.agentTool='Task';
  // the last user message: 2.1.316 sends a `system` message after it (the budget line)
  const last=userBlocks([...(body.messages??[])].reverse().find(m=>m?.role==='user'));
  const text=last.filter(b=>b.type==='text').map(b=>b.text).join('\n');
  const results=last.filter(b=>b.type==='tool_result').map(b=>({id:b.tool_use_id,tool:issued.get(b.tool_use_id)?.name??null,is_error:b.is_error??false,text:resultText(b).slice(0,240)}));
  let plan,step,marker;
  const m=text.match(MARK);
  if(m&&PLANS[m[1]]){marker=m[1];plan=PLANS[marker]();step=0;}
  else{
   const prior=last.filter(b=>b.type==='tool_result').map(b=>issued.get(b.tool_use_id)).find(Boolean);
   if(prior){({plan,marker}=prior);step=prior.step+1;}
   else if(/task-notification|<task-id>|background/i.test(text)){marker='NOTIFIED';plan=PLANS.NOTIFIED();step=0;}
   else return {kind:'unscripted',turn:textTurn('ok'),head:text.slice(0,300),results,shape:(body.messages??[]).slice(-3).map(m=>({role:m.role,blocks:typeof m.content==='string'?[{type:'string',text:m.content.slice(0,160)}]:(m.content??[]).map(b=>({type:b.type,text:typeof b.text==='string'?b.text.slice(0,160):undefined}))}))};
  }
  let turn=plan[step]??textTurn('(the plan has no more turns)');
  if(typeof turn==='function')turn=turn(state);
  turn={...turn,blocks:turn.blocks.map(b=>{if(b.type!=='tool_use')return b;const id=`toolu_o16_${String(++n).padStart(3,'0')}`;issued.set(id,{name:b.name,input:b.input,plan,step,marker});return {...b,id};})};
  return {kind:'main',marker,step,turn,head:text.slice(0,300),results,offered:['Monitor','CronCreate','ToolSearch',state.agentTool].filter(c=>names.includes(c))};
 };
 const server=createServer((req,res)=>{
  const chunks=[];req.on('data',c=>chunks.push(c));
  req.on('end',()=>{
   const path=req.url.split('?')[0];
   if(req.method==='POST'&&path==='/v1/messages/count_tokens'){requests.push({n:requests.length+1,at:new Date().toISOString(),path});res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({input_tokens:1000}));}
   if(req.method!=='POST'||path!=='/v1/messages'){requests.push({n:requests.length+1,at:new Date().toISOString(),method:req.method,path,status:404});res.writeHead(404,{'content-type':'application/json'});return res.end(JSON.stringify({type:'error',error:{type:'not_found_error',message:'stub'}}));}
   let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{res.writeHead(400);return res.end();}
   const {turn,...why}=answer(body);
   requests.push({n:requests.length+1,at:new Date().toISOString(),path,stream:body.stream===true,messages:(body.messages??[]).length,...why,reply:turn.blocks.map(b=>b.type==='tool_use'?{tool_use:b.name,id:b.id,input:b.input}:{text:b.text})});
   const id=`msg_o16_${requests.length}`;
   if(body.stream===true){res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});return res.end(sseOf(turn,{id,model:body.model}));}
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(jsonOf(turn,{id,model:body.model})));
  });
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {url:`http://127.0.0.1:${server.address().port}`,requests,state,close:()=>new Promise(r=>server.close(()=>r()))};
}

// ---- the plugins: sminos from the checkout, the fence written per run ----
function installSminos(run){
 if(!DOPERPOWERS)return {skipped:'O16_DOPERPOWERS unset'};
 const env={PATH:PATH_AT_LOAD,HOME:process.env.HOME,CLAUDE_CONFIG_DIR:run.home,DISABLE_AUTOUPDATER:'1'};
 const steps=[['plugin','marketplace','add',DOPERPOWERS],['plugin','install','sminos@doperpowers']].map(args=>{const r=spawnSync(BIN,args,{env,encoding:'utf8',timeout:120000});return {args,status:r.status,out:redact((r.stdout+r.stderr).trim()).slice(-400)};});
 let version=null;try{version=JSON.parse(readFileSync(join(DOPERPOWERS,'sminos/.claude-plugin/plugin.json'),'utf8')).version;}catch{}
 return {checkout:DOPERPOWERS,rev:DOPERPOWERS_REV,version,steps,settings:JSON.parse(readFileSync(join(run.home,'settings.json'),'utf8'))};
}
const FENCE=bus=>`// P5 O16 M0's turn.step fence (spikes/protocol-probe/scenarios/pass3/p5-o16-holder.mjs): before a turn's first main
// request it reads its mode, then holds for mode.delay ms, refuses (mode.block) or passes; every step is a ui_log line.
const MODE = ${JSON.stringify(bus+'/mode.json')}
const say = ($, text) => { try { $.ui.log('O16_FENCE ' + text) } catch {} }
async function mode($) { try { return JSON.parse(await $.fs.read(MODE)) } catch (error) { say($, 'mode unreadable ' + String(error)); return {} } }
export const register = (on) => {
  on('session.start', async ($, e, next) => { const result = await next(e); say($, 'loaded'); return result })
  on('turn.step', async function* ($, e, next) {
    const m = await mode($)
    const first = e.index === 0 || e.index === undefined
    say($, 'enter ' + JSON.stringify({ turnId: e.turnId, index: e.index, keys: Object.keys(e).sort(), mode: m }))
    if (first && m.delay) { await $.clock.sleep(m.delay); say($, 'held ' + e.turnId + ' ' + m.delay) }
    if (first && m.block) {
      say($, 'refuse ' + e.turnId)
      yield { kind: 'text', index: 0, text: 'O16 fence refused this turn.' }
      yield { kind: 'stop', stopReason: 'end_turn', usage: null }
      return { turnId: e.turnId, index: e.index, answer: 'O16 fence refused this turn.', toolUses: [], stopReason: 'end_turn', usage: null }
    }
    say($, 'next ' + e.turnId)
    return yield* next(e)
  })
}
`;
function writeFence(run){
 const dir=join(run.root,'fence'),bus=join(run.root,'fence-bus');
 for(const d of [join(dir,'.claude-plugin'),join(dir,'hooks'),bus])mkdirSync(d,{recursive:true});
 writeFileSync(join(dir,'.claude-plugin/plugin.json'),JSON.stringify({name:'o16-fence',version:'0.1.0',description:'P5 O16 M0: a turn.step fence'})+'\n');
 writeFileSync(join(dir,'hooks/hooks.json'),JSON.stringify({modules:['./register.ts']})+'\n');
 writeFileSync(join(dir,'hooks/register.ts'),FENCE(bus));
 const fence={dir,bus,set:m=>writeFileSync(join(bus,'mode.json'),JSON.stringify(m))};fence.set({});return fence;
}
// A stdio MCP server with one tool, so a server's process is in the tree.
const MCP=`// P5 O16 M0: a stdio MCP server (one tool), so the resting tree holds a server process
import {createInterface} from 'node:readline';
const name=process.argv[2]??'o16';
createInterface({input:process.stdin}).on('line',line=>{let m;try{m=JSON.parse(line);}catch{return;}if(m.id===undefined||m.id===null)return;
 const reply=r=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,...r})+'\\n');
 if(m.method==='initialize')reply({result:{protocolVersion:m.params?.protocolVersion??'2025-06-18',capabilities:{tools:{}},serverInfo:{name,version:'0.0.1'}}});
 else if(m.method==='tools/list')reply({result:{tools:[{name:'ping',description:'Answers pong.',inputSchema:{type:'object',properties:{}}}]}});
 else if(m.method==='tools/call')reply({result:{content:[{type:'text',text:'pong'}]}});
 else reply({error:{code:-32601,message:'method not found'}});});
`;

// ---- the process tree ----
const PS_ROW=/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\w{3} \w{3} [ \d]\d \d\d:\d\d:\d\d \d{4})\s+(.*)$/;
// The descendant veto's read (Interfaces §F names `ps -axo`); `-eo` only if this ps refuses it, and which one ran is noted.
export const psForm={args:null,refused:null};
function psAll(){
 const run=args=>execFileSync('ps',[args,'pid=,ppid=,pgid=,stat=,lstart=,command='],{encoding:'utf8',env:{PATH:PATH_AT_LOAD,LC_ALL:'C',TZ:'UTC'},maxBuffer:64<<20,stdio:['ignore','pipe','pipe']});
 let out;try{out=run('-axo');psForm.args??='-axo';}catch(e){psForm.refused=String(e.stderr??e.message).slice(0,200);out=run('-eo');psForm.args='-eo';}
 return out.split('\n').map(l=>PS_ROW.exec(l)).filter(Boolean).map(m=>({pid:+m[1],ppid:+m[2],pgid:+m[3],stat:m[4],lstart:m[5],command:m[6]}));
}
export function treeOf(root,rows=psAll()){const out=[];const walk=(pid,depth)=>{for(const r of rows)if(r.ppid===pid){out.push({...r,depth});walk(r.pid,depth+1);}};const self=rows.find(r=>r.pid===root);if(self)out.push({...self,depth:0});walk(root,1);return out;}
function noteTree(p,label){const rows=treeOf(p.child.pid).map(r=>({...r,command:redact(r.command).slice(0,400)}));p.note({event:'tree',label,claudePid:p.child.pid,ps:{...psForm},rows});return rows;}
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};

// ---- the wire ----
function brief(r){
 const f=r.frame,o={seq:r.seq,at:r.at,dir:r.direction,type:f.type};
 if(r.direction==='stderr')return {...o,text:String(f.text).slice(0,300)};
 if(f.type==='control_request'){const q=f.request??{};Object.assign(o,{request_id:f.request_id,subtype:q.subtype});
  if(q.subtype==='hook_callback'){const i=q.input??{};Object.assign(o,{callback_id:q.callback_id,hook_event_name:i.hook_event_name,reason:i.reason,session_crons:i.session_crons,background_tasks:i.background_tasks,inputKeys:Object.keys(i).sort()});}
  else if(q.subtype==='can_use_tool')Object.assign(o,{tool:q.tool_name,tool_use_id:q.tool_use_id});
  else if(q.subtype==='mcp_message')Object.assign(o,{server:q.server_name,method:q.message?.method??null,id:q.message?.id??null});
  else if(q.subtype!=='initialize')o.request=q;}
 else if(f.type==='control_response'){const s=f.response??{};Object.assign(o,{request_id:s.request_id,subtype:s.subtype,error:s.error,keys:Object.keys(s.response??{}).sort(),...(s.pending_permission_requests!==undefined?{pending_permission_requests:s.pending_permission_requests}:{}),...(s.pending_user_dialog_requests!==undefined?{pending_user_dialog_requests:s.pending_user_dialog_requests}:{})});}
 else if(f.type==='control_cancel_request')o.request_id=f.request_id;
 else if(f.type==='result')Object.assign(o,{subtype:f.subtype,is_error:f.is_error,terminal_reason:f.terminal_reason??null,result:typeof f.result==='string'?f.result.slice(0,200):null});
 else if(f.type==='assistant')Object.assign(o,{parent_tool_use_id:f.parent_tool_use_id??null,blocks:blocks(f).map(b=>b.type==='tool_use'?{tool_use:b.name,id:b.id}:b.type==='text'?{text:b.text.slice(0,160)}:{type:b.type})});
 else if(f.type==='user')Object.assign(o,{uuid:f.uuid,parent_tool_use_id:f.parent_tool_use_id??null,origin:f.origin??null,isReplay:f.isReplay??null,blocks:blocks(f).length?blocks(f).map(b=>b.type==='tool_result'?{tool_result:b.tool_use_id,is_error:b.is_error??false,text:textOf(b.content).slice(0,240)}:{text:textOf([b]).slice(0,240)}):[{text:textOf(f.message?.content).slice(0,240)}]});
 else if(f.type==='command_lifecycle')Object.assign(o,{state:f.state,command_uuid:f.command_uuid});
 else if(f.type==='system')Object.assign(o,{subtype:f.subtype,...(f.subtype==='ui_log'?{plugin:f.plugin,text:f.text}:{}),...(['background_tasks_changed','session_state_changed','task_started','task_notification','hook_started','hook_response'].includes(f.subtype)?{detail:f}:{})});
 return o;
}
const journal=p=>readFileSync(p.file,'utf8').split('\n').filter(Boolean).map(JSON.parse);
const KEEP=r=>r.direction!=='meta'&&r.frame.type!=='stream_event'&&!(r.frame.type==='system'&&r.frame.subtype==='init');
const rowsAfter=(p,from)=>journal(p).filter(r=>r.seq>from&&KEEP(r)).map(brief);
const rowOf=(p,f)=>p.frames.find(r=>r.frame===f);
const waitRow=(p,test,opts)=>p.wait(test,opts).then(f=>rowOf(p,f));
const isInit=f=>f.type==='system'&&f.subtype==='init';
const isResult=f=>f.type==='result';
const fenceLines=(p,from)=>p.frames.filter(r=>r.seq>from&&r.frame.type==='system'&&r.frame.subtype==='ui_log'&&/^O16_FENCE /.test(r.frame.text??'')).map(r=>({seq:r.seq,at:r.at,text:r.frame.text}));

// The probe end of a launch: every tool allowed (`hold` decides otherwise for a request it keeps), every hook callback
// answered {} and noted, initialize with `hooks` (and `extra`).
async function open(p,run,{hooks=STOP_HOOKS,extra={},hold=null}={}){
 p.on('can_use_tool',(r,frame)=>{p.note({event:'permission_asked',request_id:frame.request_id,tool:r.tool_name,input:r.input});return hold?.('permission',r,frame)??{behavior:'allow',updatedInput:r.input};});
 p.on('hook_callback',(r,frame)=>{p.note({event:'hook_callback_seen',request_id:frame.request_id,callback_id:r.callback_id,hook_event_name:r.input?.hook_event_name??null,reason:r.input?.reason??null});return hold?.('hook',r,frame)??{};});
 const init=success(await p.init({...initPayload(run.cwd),hooks,...extra}),'initialize');
 p.note({event:'initialize_answer',hooks_applied:init.hooks_applied??null,capabilities:init.capabilities??null,keys:Object.keys(init).sort()});
 return init;
}
const noteInit=p=>{const f=p.frames.find(r=>isInit(r.frame))?.frame;p.note({event:'init_frame',plugins:f?.plugins??null,mcp_servers:f?.mcp_servers??null,capabilities:f?.capabilities??null,tools:f?.tools??null,claude_code_version:f?.claude_code_version??null});};
// One step: a prompt (or none), `during` while it runs, then until the engine is idle; its rows and requests noted.
async function step(p,api,label,prompt,{during=null,after=null,quiet=4000}={}){
 const from=p.seq,before=api.requests.length;
 if(prompt!==null)p.user(prompt);
 if(during)await during(from);
 if(prompt!==null)await p.wait(isResult,{after:from,timeout:180000});
 if(after)await after(from);
 await idle(p,180000,quiet);
 p.note({event:'step',label,prompt,from,rows:rowsAfter(p,from),requests:api.requests.slice(before)});
 return from;
}
// A turn the engine starts by itself after `from`: its init row and its result row (null on a timeout).
async function engineTurn(p,from,timeout){
 const init=await waitRow(p,isInit,{after:from,timeout}).catch(()=>null);
 const result=init?await waitRow(p,isResult,{after:init.seq,timeout:120000}).catch(()=>null):null;
 return {init,result};
}
const tasksOf=p=>{const snap=p.frames.filter(r=>r.frame.type==='system'&&r.frame.subtype==='background_tasks_changed').at(-1)?.frame;return snap?.tasks??[];};
async function stopTasks(p,label){
 const tasks=tasksOf(p);const answers=[];
 for(const t of tasks)answers.push({task_id:t.task_id,task_type:t.task_type,description:t.description,answer:await p.request('stop_task',{task_id:t.task_id},15000).catch(e=>({error:e.message}))});
 p.note({event:'stop_tasks',label,answers});
}
function noteDebugFull(p,run){if(!existsSync(run.debugFile))return;const lines=readFileSync(run.debugFile,'utf8').split('\n').filter(l=>DEBUG.test(l.split(run.root).join(''))).map(l=>redact(l).slice(0,300));p.note({event:'debug_full',count:lines.length,lines:lines.slice(0,600)});}

async function withLaunch(name,run,api,{question,flags=[],resume=null,vars={},extra={},expectExit=false},body){
 const managed=MANAGED.filter(f=>existsSync(f));
 const opts={dir:'fixtures/p5/',relay:false,spendCap:'0.05',debugPattern:DEBUG,detached:true,sessionId:resume?null:randomUUID(),pinned:resume===null,
  vars:{ANTHROPIC_BASE_URL:api.url,ANTHROPIC_AUTH_TOKEN:'stub-token',TZ:'UTC',CLAUDE_CODE_ENABLE_FUNCTION_HOOKS:'1',SMNS_MEMBER:String(process.pid),MAWS_LANE:'B',...vars},
  flags:[...(resume?['--resume',resume]:[]),...flags],
  provenance:{...PROVENANCE,question,managedSettings:managed,engineVersion:ENGINE_VERSION,spawnerPid:process.pid,...extra}};
 try{
  return await launch(name+SUFFIX,run,opts,async p=>{
   // a managed settings file applies whatever --setting-sources says; one naming a gateway would route past the stub
   check(p,'no managed settings file routes the engine',managed.every(f=>!/ANTHROPIC_BASE_URL/.test(readFileSync(f,'utf8'))),managed);
   try{await body(p);}finally{noteDebugFull(p,run);}
  });
 }catch(e){if(expectExit&&/ exited with /.test(e.message)){console.log(name+SUFFIX,'exit expected:',e.message);return null;}throw e;}
}

// ---- questions 1 and 4: one session with sminos, the fence and two stdio MCP servers ----
function mcpRun(label){
 const run=scratchRun(label);const script=join(run.root,'o16-mcp.mjs');writeFileSync(script,MCP);
 const config=JSON.parse(readFileSync(join(run.home,'.claude.json'),'utf8'));
 config.mcpServers={'o16-user':{type:'stdio',command:NODE,args:[script,'user']}};
 writeFileSync(join(run.home,'.claude.json'),JSON.stringify(config)+'\n');
 return {run,flagConfig:{mcpServers:{'o16-flag':{command:NODE,args:[script,'flag']}}}};
}
async function mainArm(){
 const {run,flagConfig}=mcpRun('p5o16-main');
 const fence=writeFence(run);const install=installSminos(run);
 const monitorFile=join(run.root,'monitor.log');writeFileSync(monitorFile,'one\n');
 const api=await startScriptedApi({monitorFile});
 try{
  await withLaunch('p5-o16-holder-main',run,api,{question:'1 and 4: the bridge in -p, the fence on engine-started turns, the resting and working trees, get_settings',flags:['--plugin-dir',fence.dir,'--mcp-config',JSON.stringify(flagConfig)],extra:{install,mcpConfig:flagConfig,userMcpServers:['o16-user']}},async p=>{
   await open(p,run);
   // the rest: the bridge's child and both servers up (bounded 30 s)
   const end=Date.now()+30000;let rows;
   while(Date.now()<end){rows=treeOf(p.child.pid);if(rows.some(r=>/sminos.*bridge/.test(r.command))&&rows.filter(r=>/o16-mcp\.mjs/.test(r.command)).length>=2)break;await delay(500);}
   p.note({event:'get_settings',response:await p.request('get_settings',{},15000).catch(e=>({error:e.message}))});
   p.note({event:'mcp_status',response:await p.request('mcp_status',{},15000).catch(e=>({error:e.message}))});
   noteTree(p,'rest');
   await step(p,api,'foreground-bash','[[O16:FG]] Sleep in the foreground.',{during:async from=>{await p.wait(f=>f.type==='assistant'&&blocks(f).some(b=>b.type==='tool_use'&&b.name==='Bash'),{after:from,timeout:60000}).catch(()=>null);await delay(2500);noteTree(p,'foreground-bash');}});
   await step(p,api,'background-bash','[[O16:BG600]] Start the background sleep.');
   noteInit(p);
   noteTree(p,'background-bash');
   await step(p,api,'monitor','[[O16:MON]] Watch the log.');
   await delay(1500);noteTree(p,'monitor');
   await step(p,api,'subagent','[[O16:SUB]] Have a subagent sleep.',{after:async from=>{
    const end=Date.now()+30000;while(Date.now()<end&&!treeOf(p.child.pid).some(r=>/^sleep 8\b/.test(r.command)))await delay(300);
    noteTree(p,'subagent');
    const first=p.frames.filter(r=>r.seq>from&&isResult(r.frame))[0];
    const turn=await engineTurn(p,first.seq,60000);p.note({event:'subagent_notification',init:turn.init?.seq??null,result:turn.result?.seq??null});
   }});
   await stopTasks(p,'working');
   await idle(p,60000,4000);noteTree(p,'rest-after-stop');
   // question 1: engine-started turns under the fence
   for(const [label,plan,mode,timeout] of [['task-baseline','NOTE0',{},60000],['task-held','NOTE',{delay:3000},60000],['cron-held','CRON',{delay:3000},240000],['task-refused','NOTE2',{block:true},60000]]){
    fence.set({}); // the prompt's own turn passes; the mode applies from its result on, to the turn the engine starts
    const before=api.requests.length;
    await step(p,api,label,`[[O16:${plan}]] Start it.`,{after:async from=>{
     fence.set(mode);
     const first=p.frames.filter(r=>r.seq>from&&isResult(r.frame))[0];
     const turn=await engineTurn(p,first.seq,timeout);
     const fl=fenceLines(p,turn.init?.seq??first.seq);
     const enter=fl.find(l=>/^O16_FENCE enter /.test(l.text));
     const main=api.requests.slice(before).filter(q=>q.kind==='main'&&turn.init&&q.at>=turn.init.at&&(q.marker==='FIRE'||q.marker==='NOTIFIED'))[0]??null;
     const heldMs=enter&&main?Date.parse(main.at)-Date.parse(enter.at):null;
     p.note({event:'q1',label,origin:plan==='CRON'?'cron':'task',mode,turnStart:turn.init?{seq:turn.init.seq,at:turn.init.at}:null,turnResult:turn.result?{seq:turn.result.seq,at:turn.result.at,subtype:turn.result.frame.subtype,result:turn.result.frame.result??null}:null,fence:fl,mainRequest:main?{n:main.n,at:main.at,marker:main.marker}:null,heldMs,startToRequestMs:turn.init&&main?Date.parse(main.at)-Date.parse(turn.init.at):null});
    }});
   }
   fence.set({});
   await stopTasks(p,'end');
   await endAsStop(p);
  });
 }finally{await api.close();removeRun(run);}
}

// ---- question 2: end_session and SIGTERM, a background shell running, a permission pending or not ----
const SESSION_END=file=>`printf '{"at":"%s","input":%s}\\n' "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" "$(tr -d '\\n')" >> '${file}'`;
async function endArm(kind,pending){
 const name=`p5-o16-holder-${kind}${pending?'-pending':''}`;
 const run=scratchRun('p5o16-'+kind);const endFile=join(run.root,'session-end.jsonl');
 // installed first: the plugin commands are sessions of their own, and would run the hook
 const install=installSminos(run);
 const settings=JSON.parse(readFileSync(join(run.home,'settings.json'),'utf8'));
 writeFileSync(join(run.home,'settings.json'),JSON.stringify({...settings,hooks:{SessionEnd:[{hooks:[{type:'command',command:SESSION_END(endFile)}]}]}})+'\n');
 const api=await startScriptedApi();
 const held=[];
 try{
  await withLaunch(name,run,api,{question:`2: ${kind} with a background shell running${pending?' and a permission pending':''}`,expectExit:true,extra:{install}},async p=>{
   await open(p,run,{hooks:{...STOP_HOOKS,SessionEnd:[{hookCallbackIds:['maws_SessionEnd_1'],timeout:10}]},hold:(what,r,frame)=>{if(what==='permission'&&/O16_PENDING/.test(r.input?.command??'')){held.push(frame.request_id);p.note({event:'permission_held',request_id:frame.request_id});return new Promise(()=>{});}return null;}});
   await step(p,api,'background','[[O16:BG300]] Start the background sleep.');
   if(pending){const from=p.seq;p.user('[[O16:PENDING]] Echo it.');await p.wait(f=>f.type==='control_request'&&f.request?.subtype==='can_use_tool',{after:from,timeout:60000});await delay(1000);}
   const before=noteTree(p,'before');const shells=before.filter(r=>/\bsleep 300\b/.test(r.command)).map(r=>r.pid);
   const bridges=before.filter(r=>/sminos.*bridge/.test(r.command)).map(r=>r.pid);
   const from=p.seq;let exitAt=null;p.closed.then(()=>{exitAt=process.hrtime.bigint();});
   const t0=process.hrtime.bigint();
   let answer=null;
   if(kind==='end-session')answer=p.request('end_session',{reason:'stop'},15000).then(r=>({at:new Date().toISOString(),response:r}),e=>({error:e.message}));
   else process.kill(p.child.pid,'SIGTERM');
   p.note({event:'q2_sent',kind,pending,at:new Date().toISOString()});
   const exit=await Promise.race([p.closed,delay(10000).then(()=>null)]);
   const exitMs=exit&&exitAt?Number((exitAt-t0)/1000000n):null;
   await delay(1000);
   const sessionEnd=existsSync(endFile)?readFileSync(endFile,'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l);}catch{return {raw:l.slice(0,300)};}}):[];
   let stdinAfter=null;
   if(!exit){
    const f2=p.seq;p.user('[[O16:PLAIN]] Reply with OK.');
    stdinAfter=await p.wait(isResult,{after:f2,timeout:30000}).then(()=>'usable',()=>'dead');
   }
   p.note({event:'q2',kind,pending,exit,exitMs,answer:answer?await Promise.race([answer,delay(2000).then(()=>'unanswered')]):null,
    shells:shells.map(pid=>({pid,aliveAfter:alive(pid)})),bridges:bridges.map(pid=>({pid,aliveAfter:alive(pid)})),sessionEnd,stdinAfterIgnored:stdinAfter,rows:rowsAfter(p,from)});
   if(!exit){try{process.kill(-p.child.pid,'SIGKILL');}catch{}await p.closed;}
   // the transcript as the engine left it
   const tp=transcriptPath(run,p.sessionId);const text=existsSync(tp)?readFileSync(tp,'utf8'):null;
   const lines=text?text.split('\n').filter(Boolean):[];let bad=0;const recs=[];for(const l of lines){try{recs.push(JSON.parse(l));}catch{bad++;}}
   p.note({event:'transcript',exists:text!==null,bytes:text?.length??0,endsWithNewline:text?text.endsWith('\n'):null,records:recs.length,unparsable:bad,tail:recs.slice(-8).map(summarise)});
   for(const pid of [...shells,...bridges])if(alive(pid))try{process.kill(pid,'SIGKILL');}catch{}
  });
 }finally{await api.close();removeRun(run);}
}

// ---- question 3: a second initialize mid-session ----
async function reinitArm(){
 const run=scratchRun('p5o16-reinit');const install=installSminos(run);
 const api=await startScriptedApi();
 const HOOKS={...STOP_HOOKS,PreToolUse:[{matcher:'mcp__maws__hooked',hookCallbackIds:['maws_PreToolUse_1'],timeout:600}]};
 const held=new Map();
 try{
  await withLaunch('p5-o16-holder-reinit',run,api,{question:'3: a second initialize with a tools/call, a permission and a hook callback outstanding',flags:MAWS_TOOL_FLAGS,extra:{install,hooks:HOOKS}},async p=>{
   const keep=(key,frame,answer)=>new Promise(resolve=>{held.set(key,{request_id:frame.request_id,resolve:()=>resolve(answer)});p.note({event:'held',key,request_id:frame.request_id});});
   const hold=(what,r,frame)=>what==='permission'&&r.tool_name==='Read'?keep('permission:'+frame.request_id,frame,{behavior:'allow',updatedInput:r.input}):what==='hook'&&r.callback_id==='maws_PreToolUse_1'?keep('hook:'+frame.request_id,frame,{}):null;
   p.on('mcp_message',(r,frame)=>{
    const m=r.message??{};if(r.server_name!=='maws')return sdkMcpAnswer({},r);
    if(m.method==='tools/call'&&m.params?.name==='hooked')return {mcp_response:{jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'O16_HOOKED_RESULT'}]}}};
    if(m.method==='tools/call')return keep('call:'+frame.request_id,frame,{mcp_response:{jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'O16_HELD_RESULT'}]}}});
    if(m.method==='initialize')return {mcp_response:{jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params?.protocolVersion??'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'maws',version:'0.0.1'}}}};
    if(m.method==='tools/list')return {mcp_response:{jsonrpc:'2.0',id:m.id,result:{tools:[{name:'hold',description:'Holds until the host answers.',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true}},{name:'hooked',description:'Answers at once; its PreToolUse callback is held.',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true}}]}}};
    if(m.id===undefined||m.id===null)return {mcp_response:{jsonrpc:'2.0',result:{},id:0}};
    return {mcp_response:{jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'method not found'}}};
   });
   const payload={hooks:HOOKS,extra:{sdkMcpServers:['maws']},hold};
   await open(p,run,payload);
   await step(p,api,'background','[[O16:BG900]] Start the background sleep.');noteInit(p);
   // three outstanding at once (bounded 30 s)
   let from=p.seq;p.user('[[O16:PAR]] Run all three.');
   const end=Date.now()+30000;while(Date.now()<end&&!['call:','permission:','hook:'].every(k=>[...held.keys()].some(x=>x.startsWith(k))))await delay(200);
   await delay(1500);
   p.note({event:'q3_outstanding',held:[...held.keys()],rows:rowsAfter(p,from)});
   // a response to a request id the engine never sent
   from=p.seq;p.send({type:'control_response',response:{subtype:'success',request_id:'o16-never-sent-1',response:{}}});
   await delay(2000);
   p.note({event:'q3_stray',rows:rowsAfter(p,from),alive:!p.exited});
   // the second initialize, as an adopting manager sends it
   from=p.seq;const answer=await p.request('initialize',{...initPayload(run.cwd),hooks:HOOKS,sdkMcpServers:['maws']},30000).catch(e=>({error:e.message}));
   await delay(5000);
   p.note({event:'q3_reinit',answer,rows:rowsAfter(p,from)});
   // the late answers, one kind at a time
   for(const kind of ['hook:','permission:','call:']){
    from=p.seq;const keys=[...held.keys()].filter(k=>k.startsWith(kind));
    for(const k of keys){held.get(k).resolve();held.delete(k);}
    await delay(kind==='call:'?0:2500);
    if(kind==='call:')await p.wait(isResult,{after:from,timeout:90000}).catch(()=>null);
    p.note({event:'q3_late',kind:kind.slice(0,-1),keys,rows:rowsAfter(p,from)});
   }
   for(const [k,v] of held){v.resolve();held.delete(k);}
   await idle(p,60000,4000);
   p.note({event:'q3_requests',requests:api.requests});
   await stopTasks(p,'end');
   await endAsStop(p);
  });
 }finally{for(const v of held.values())v.resolve();await api.close();removeRun(run);}
}

// ---- question 5: --await-initialize and a resurrected cron ----
async function awaitArms(){
 const run=scratchRun('p5o16-await');const install=installSminos(run);
 const api=await startScriptedApi();
 let sessionId=null;
 try{
  await withLaunch('p5-o16-holder-await-seed',run,api,{question:'5: a session holding an every-minute session cron, the one the resumes read',extra:{install}},async p=>{
   await open(p,run);await step(p,api,'seed','[[O16:SEED]] Schedule the minute job.');sessionId=p.sessionId;await endAsStop(p);
  });
  for(const [label,flags] of [['await-resume',['--await-initialize']],['plain-resume',[]]])await withLaunch(`p5-o16-holder-${label}`,run,api,{question:`5: --resume${flags.length?' --await-initialize':''}, initialize withheld 75 s`,resume:sessionId,flags,expectExit:true,extra:{install}},async p=>{
   const before=api.requests.length;const t0=Date.now();
   p.on('can_use_tool',r=>({behavior:'allow',updatedInput:r.input}));p.on('hook_callback',()=>({}));
   await Promise.race([p.closed,delay(75000)]);
   p.note({event:'q5_withheld',ms:Date.now()-t0,exited:!!p.exited,rows:rowsAfter(p,0),requests:api.requests.slice(before)});
   if(p.exited)return;
   const from=p.seq,mid=api.requests.length;
   const answer=await p.request('initialize',{...initPayload(run.cwd),hooks:STOP_HOOKS},30000).catch(e=>({error:e.message}));
   const turn=await engineTurn(p,from,90000);
   await idle(p,60000,4000);
   p.note({event:'q5_after_initialize',answer:answer.subtype?{subtype:answer.subtype,error:answer.error??null}:answer,turnStart:turn.init?.seq??null,turnResult:turn.result?.seq??null,rows:rowsAfter(p,from),requests:api.requests.slice(mid)});
   await endAsStop(p);
  });
 }finally{await api.close();removeRun(run);}
}

export default async()=>{
 console.log('engine',ENGINE_VERSION,'suffix',SUFFIX||'(none)','arms',ARMS.join(','));
 if(ARMS.includes('main'))await mainArm();
 for(const kind of ['end-session','sigterm'])if(ARMS.includes(kind))for(const pending of [false,true])await endArm(kind,pending);
 if(ARMS.includes('reinit'))await reinitArm();
 if(ARMS.includes('await'))await awaitArms();
};
