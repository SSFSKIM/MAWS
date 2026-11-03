// P5 O16 post-landing fix (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, the descendant veto's registration, M5,
// Interfaces §F, D17, D48, D52): what the descendant veto can bind a session's real infrastructure by, on the pinned
// engine, for the server shapes the owner runs (charter D-1):
//   a  does `mcp_status` carry `config` for a plugin's stdio server (scope `dynamic`), and is `${CLAUDE_PLUGIN_ROOT}`
//      expanded in it? (fixtures/p4/p4-r8-owner.jsonl lists the owner's plugin servers without one, but its curation
//      kept only name, status, scope and type)
//   b  what lives under a `-p` stream-json session from its spawn to its rest, with a plugin carrying a bare-`node`
//      server (cua's shape), an exec'ing launcher (ptc's: a `#!/usr/bin/env python3` script that execs another
//      binary), a forking launcher (npx's: the server a child of the launcher) and a configured absolute-path server
//      (--mcp-config); sminos's bridge child; and when does `mcp_status` first report every stdio server settled?
//   c  the tree after a turn that leaves a background Bash, and after its stop_task;
//   d  what mcp_status says of a server whose direct child is gone: killed outright, and a forking launcher killed while
//      the server it started lives on with the same pipes (the count rule rests on a connected server having its process).
// MAWS's launch line and initialize (p1-common), the engine spawned detached as transport.ts spawns it, MAWS_LANE=B and
// SMNS_MEMBER the probe's own pid, CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1, against a scripted Messages API (stub-api.mjs;
// nothing spent). The plugin is installed from a directory marketplace, as the owner's are; sminos from a doperpowers
// checkout (O16_DOPERPOWERS, its commit O16_DOPERPOWERS_REV), as M0 installed it. Fixture
// fixtures/p5/p5-o16-veto-mcp[O16_SUFFIX].jsonl, findings in findings-p5-o16-veto-mcp.txt. Run on a devcloud VM as a
// dedicated user with /etc/claude-code hidden, never on the owner's MacBook:
//   PROBE_ENGINE=<binary> O16_DOPERPOWERS=<checkout> O16_DOPERPOWERS_REV=<sha> [O16_SUFFIX=-installed] \
//     node run-pass3.mjs p5-o16-veto-mcp
import {launch,scratchRun,removeRun,initPayload,success,check,endAsStop,delay,randomUUID,existsSync,ENGINE_VERSION,BIN,join,writeFileSync,mkdirSync} from './p1-common.mjs';
import {startScriptedApi,treeOf} from './p5-o16-holder.mjs';
import {idle} from './c8b-common.mjs';
import {redact} from '../../harness.mjs';
import {readFileSync,chmodSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const DOPERPOWERS=process.env.O16_DOPERPOWERS??null;
const DOPERPOWERS_REV=process.env.O16_DOPERPOWERS_REV??null;
const SUFFIX=process.env.O16_SUFFIX??'';
const NODE=process.execPath;
const PATH_AT_LOAD=process.env.PATH;
const PROVENANCE={child:'P5-O16',document:'docs/doperpowers/plans/2026-10-31-p5-o16-holder.md',spike:'the descendant veto\'s registration (post-landing fix)',api:'a content-keyed script over stub-api.mjs sseOf (nothing spent)'};
const STOP_HOOKS={Stop:[{hookCallbackIds:['maws_Stop_1'],timeout:10}]};
const MANAGED=['/etc/claude-code/managed-settings.json','/Library/Application Support/ClaudeCode/managed-settings.json'];
const DEBUG=/mcp|o16-veto|stdio|plugin|bridge|sminos|spawn|inhibit|caffeinate/i;

// ---- the plugin: four stdio servers of the owner's shapes over one script ----
const SERVER=`// P5 O16 veto probe: a stdio MCP server (one tool), so each server's process is in the tree
import {createInterface} from 'node:readline';
const name=process.argv[2]??'o16';
createInterface({input:process.stdin}).on('line',line=>{let m;try{m=JSON.parse(line);}catch{return;}if(m.id===undefined||m.id===null)return;
 const reply=r=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,...r})+'\\n');
 if(m.method==='initialize')reply({result:{protocolVersion:m.params?.protocolVersion??'2025-06-18',capabilities:{tools:{}},serverInfo:{name,version:'0.0.1'}}});
 else if(m.method==='tools/list')reply({result:{tools:[{name:'ping',description:'Answers pong.',inputSchema:{type:'object',properties:{}}}]}});
 else if(m.method==='tools/call')reply({result:{content:[{type:'text',text:'pong'}]}});
 else reply({error:{code:-32601,message:'method not found'}});});
`;
// ptc's shape (ptc-launch): python3 by env, a pause (ptc provisions or checks its venv first), then exec into another
// binary, so the process keeps its pid and start time and changes its whole command line
const EXEC_LAUNCHER=node=>`#!/usr/bin/env python3
import os, sys, time
time.sleep(1.5)
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.execv(${JSON.stringify(node)}, [${JSON.stringify(node)}, os.path.join(root, 'server.mjs'), 'exec'])
`;
// npx's shape: the launcher stays, the server runs as its child
const FORK_LAUNCHER=node=>`#!/bin/sh
${JSON.stringify(node)} "$(dirname "$0")/../server.mjs" fork
`;
function writePlugin(run){
 const market=join(run.root,'market'),dir=join(market,'o16-veto');
 for(const d of [join(market,'.claude-plugin'),join(dir,'.claude-plugin'),join(dir,'bin')])mkdirSync(d,{recursive:true});
 writeFileSync(join(market,'.claude-plugin/marketplace.json'),JSON.stringify({name:'o16-market',owner:{name:'o16'},plugins:[{name:'o16-veto',source:'./o16-veto',description:'P5 O16 veto probe'}]})+'\n');
 const mcpServers={
  bare:{command:'node',args:['--disable-sigusr1','${CLAUDE_PLUGIN_ROOT}/server.mjs','bare'],env:{O16_SHAPE:'bare'}}, // cua's
  launcher:{command:'${CLAUDE_PLUGIN_ROOT}/bin/o16-launch'}, // ptc's
  fork:{command:'${CLAUDE_PLUGIN_ROOT}/bin/o16-fork'}, // npx's
 };
 writeFileSync(join(dir,'.claude-plugin/plugin.json'),JSON.stringify({name:'o16-veto',version:'0.1.0',description:'P5 O16 veto probe: four server shapes',mcpServers},null,1)+'\n');
 writeFileSync(join(dir,'server.mjs'),SERVER);
 writeFileSync(join(dir,'bin/o16-launch'),EXEC_LAUNCHER(NODE));chmodSync(join(dir,'bin/o16-launch'),0o755);
 writeFileSync(join(dir,'bin/o16-fork'),FORK_LAUNCHER(NODE));chmodSync(join(dir,'bin/o16-fork'),0o755);
 return {market,dir,mcpServers,script:join(dir,'server.mjs')};
}
const cli=(run,args)=>{const r=spawnSync(BIN,args,{env:{PATH:PATH_AT_LOAD,HOME:process.env.HOME,CLAUDE_CONFIG_DIR:run.home,DISABLE_AUTOUPDATER:'1'},encoding:'utf8',timeout:120000});return {args,status:r.status,out:redact((r.stdout+r.stderr).trim()).slice(-400)};};
function install(run,plugin){
 const steps=[cli(run,['plugin','marketplace','add',plugin.market]),cli(run,['plugin','install','o16-veto@o16-market'])];
 if(DOPERPOWERS)steps.push(cli(run,['plugin','marketplace','add',DOPERPOWERS]),cli(run,['plugin','install','sminos@doperpowers']));
 let sminos=null;try{sminos=JSON.parse(readFileSync(join(DOPERPOWERS,'sminos/.claude-plugin/plugin.json'),'utf8')).version;}catch{}
 return {steps,doperpowers:DOPERPOWERS?{checkout:DOPERPOWERS,rev:DOPERPOWERS_REV,sminos}:null,settings:JSON.parse(readFileSync(join(run.home,'settings.json'),'utf8'))};
}

// ---- the reads ----
const rowsOf=p=>treeOf(p.child.pid).map(r=>({...r,command:redact(r.command).slice(0,400)}));
const noteTree=(p,label,extra={})=>{const rows=rowsOf(p);p.note({event:'tree',label,claudePid:p.child.pid,...extra,rows});return rows;};
// One mcp_status entry as the veto reads it: everything but the tool list and the server's self-description.
const entryOf=s=>{const {tools,serverInfo,capabilities,...rest}=s;return {...rest,toolCount:Array.isArray(tools)?tools.length:null};};
const stdioOf=answer=>(answer?.mcpServers??[]).filter(s=>(s.config?.type??s.transport??s.type)==='stdio');
const settled=answer=>Array.isArray(answer?.mcpServers)&&stdioOf(answer).length>0&&stdioOf(answer).every(s=>s.status!=='pending');

async function veto(){
 const run=scratchRun('p5o16-veto');const plugin=writePlugin(run);const installed=install(run,plugin);
 const flagConfig={mcpServers:{flag:{type:'stdio',command:NODE,args:[plugin.script,'flag']}}};
 const api=await startScriptedApi();
 const managed=MANAGED.filter(f=>existsSync(f));
 try{
  await launch('p5-o16-veto-mcp'+SUFFIX,run,{dir:'fixtures/p5/',relay:false,spendCap:'0.05',debugPattern:DEBUG,detached:true,sessionId:randomUUID(),
   vars:{ANTHROPIC_BASE_URL:api.url,ANTHROPIC_AUTH_TOKEN:'stub-token',TZ:'UTC',CLAUDE_CODE_ENABLE_FUNCTION_HOOKS:'1',SMNS_MEMBER:String(process.pid),MAWS_LANE:'B'},
   flags:['--mcp-config',JSON.stringify(flagConfig)],
   provenance:{...PROVENANCE,question:'a, b and c: mcp_status config for plugin stdio servers, the tree from spawn to rest, after a background Bash',managedSettings:managed,engineVersion:ENGINE_VERSION,engine:BIN,spawnerPid:process.pid,installed,pluginServers:plugin.mcpServers,mcpConfig:flagConfig}},async p=>{
   check(p,'no managed settings file routes the engine',managed.every(f=>!/ANTHROPIC_BASE_URL/.test(readFileSync(f,'utf8'))),managed);
   p.on('can_use_tool',(r)=>({behavior:'allow',updatedInput:r.input}));
   p.on('hook_callback',(r,frame)=>{p.note({event:'hook_callback_seen',request_id:frame.request_id,hook_event_name:r.input?.hook_event_name??null});return {};});
   // b: the tree from the spawn, every 250 ms, until initialize is sent (the engine starts its servers at its own start)
   const t0=Date.now();const early=[];
   for(let i=0;i<8;i++){early.push({ms:Date.now()-t0,rows:rowsOf(p).filter(r=>r.depth>0).map(r=>({pid:r.pid,ppid:r.ppid,depth:r.depth,stat:r.stat,lstart:r.lstart,command:r.command}))});await delay(250);}
   p.note({event:'tree_before_initialize',samples:early});
   const init=success(await p.request('initialize',{...initPayload(run.cwd),hooks:STOP_HOOKS},30000),'initialize');
   p.note({event:'initialize_answer',keys:Object.keys(init).sort(),ms:Date.now()-t0});
   // a and b: mcp_status every 300 ms until every stdio server is settled (bounded 45 s), the tree beside each answer
   const polls=[];let last=null;const end=Date.now()+45000;
   while(Date.now()<end){
    const answer=await p.request('mcp_status',{},15000).then(r=>r.response??r,e=>({error:e.message}));
    const rows=rowsOf(p).filter(r=>r.depth===1);
    polls.push({ms:Date.now()-t0,servers:(answer.mcpServers??[]).map(s=>({name:s.name,status:s.status})),children:rows.map(r=>({pid:r.pid,lstart:r.lstart,stat:r.stat,command:r.command}))});
    last=answer;if(settled(answer))break;await delay(300);
   }
   p.note({event:'mcp_status_polls',polls});
   p.note({event:'mcp_status_settled',ms:polls.at(-1)?.ms??null,settled:settled(last),servers:(last?.mcpServers??[]).map(entryOf)});
   noteTree(p,'settled');
   // b: the rest, the bridge child given time to start (bounded 30 s)
   const rest=Date.now()+30000;
   while(Date.now()<rest&&!rowsOf(p).some(r=>/sminos(\.py)? bridge/.test(r.command))&&DOPERPOWERS)await delay(500);
   await delay(3000);noteTree(p,'rest');
   p.note({event:'mcp_status',response:{mcpServers:(await p.request('mcp_status',{},15000).then(r=>r.response??r,e=>({error:e.message}))).mcpServers?.map(entryOf)??null}});
   // c: a turn that leaves a background Bash, then its stop
   const from=p.seq;p.user('[[O16:BG600]] Start the background sleep.');
   await p.wait(f=>f.type==='result',{after:from,timeout:180000});await idle(p,120000,3000);
   noteTree(p,'background-bash');
   const tasks=p.frames.filter(r=>r.frame.type==='system'&&r.frame.subtype==='background_tasks_changed').at(-1)?.frame?.tasks??[];
   const stops=[];for(const t of tasks)stops.push({task_id:t.task_id,answer:await p.request('stop_task',{task_id:t.task_id},15000).then(r=>r.subtype,e=>e.message)});
   p.note({event:'stop_tasks',stops});
   await idle(p,60000,4000);noteTree(p,'rest-after-stop');
   // d: what mcp_status says once a server's direct child is gone: the bare server killed outright, and the forking
   // launcher killed while the server it started (holding the same pipes) lives on
   for(const [label,pick] of [['bare-killed',r=>/server\.mjs bare$/.test(r.command)],['fork-launcher-killed',r=>/bin\/o16-fork$/.test(r.command)]]){
    const victim=rowsOf(p).find(r=>r.depth===1&&pick(r));
    if(!victim){p.note({event:'kill',label,missing:true});continue;}
    try{process.kill(victim.pid,'SIGKILL');}catch(e){p.note({event:'kill',label,error:e.message});continue;}
    const k0=Date.now();const seen=[];
    while(Date.now()-k0<6000){
     const answer=await p.request('mcp_status',{},15000).then(r=>r.response??r,e=>({error:e.message}));
     seen.push({ms:Date.now()-k0,servers:(answer.mcpServers??[]).map(s=>({name:s.name,status:s.status})),children:rowsOf(p).filter(r=>r.depth===1).map(r=>({pid:r.pid,stat:r.stat,command:r.command.slice(0,120)}))});
     await delay(200);
    }
    p.note({event:'kill',label,pid:victim.pid,command:victim.command,polls:seen});
    noteTree(p,label);
   }
   p.note({event:'requests',requests:api.requests.map(q=>({n:q.n,at:q.at,kind:q.kind,marker:q.marker,reply:q.reply}))});
   await endAsStop(p);
  });
 }finally{await api.close();removeRun(run);}
}

export default async()=>{
 console.log('engine',ENGINE_VERSION,BIN,'suffix',SUFFIX||'(none)');
 await veto();
};
