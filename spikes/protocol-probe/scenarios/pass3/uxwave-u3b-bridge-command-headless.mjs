// UX wave U3b, probe 2, the live wire (docs/doperpowers/plans/2026-11-15-ux-wave-U3b-transcript-rows-find.md, "Probes"
// 2): the sminos bridge's `command` op in a headless session launched as MAWS launches it
// (uxwave-common-arrivals.mjs), with the plugin by --plugin-dir from the VM's marketplace copy and
// CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1, its state the scratch HOME's (containment as uxwave-u3-sminos.mjs). Two arms
// (UXW_ARMS): `maws`, MAWS_LANE=B (the bridge observes only), and `bridge`, without MAWS_LANE (the bridge controls, as in
// any headless run outside MAWS). In each: `/rename` typed (sent as a prompt, as MAWS's composer sends it), then the
// same command posted to the bridge as lane A's driver posts it, then typed again; the wire frames and file rows of each
// step are noted as `uxw_case` rows, with the bridge's answer.
import {mawsLaunch,wireArrivals,fileArrivals,rowsOf,keepTranscript,waitFor,idle,prompt,turn,delay,cost} from './uxwave-common-arrivals.mjs';
import {redact} from '../../harness.mjs';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {userInfo} from 'node:os';
import http from 'node:http';

const PLUGIN='/var/lib/devcloud/marketplaces/doperpowers/sminos';
const ARMS=(process.env.UXW_ARMS||'bridge,maws').split(',').filter(Boolean);
const TAG=process.env.UXW_TAG||'u3b-bridge-command-headless';
const WORK=process.env.PROBE_WORK;
function contained(){
 const why=[],OWNER_HOME=userInfo().homedir;
 if(!process.env.HOME?.startsWith('/tmp/'))why.push('HOME is not a scratch folder');
 for(const k of ['SMINOS_HOME','DAEMON_HOME','AGORA_HOME','SMINOS_RL10','MAWS_USER_DATA','XDG_CONFIG_HOME','MAWS_HOLDER_SOCKET'])if(process.env[k])why.push(k+' is set');
 if(existsSync(join(OWNER_HOME,'.config/MAWS/mawsd/endpoint/rl10.json')))why.push("the owner's mawsd endpoint file is visible");
 if(existsSync(join(OWNER_HOME,'.claude/sminos')))why.push("the owner's sminos state is visible");
 if(existsSync(join(process.env.HOME,'.claude/sminos/daemon/identity.json')))why.push('the scratch sminos state is enrolled');
 if(existsSync('/etc/claude-code/managed-settings.json'))why.push('managed settings are visible');
 return why;
}
const call=(sock,method,path,body)=>new Promise(resolve=>{const data=body?JSON.stringify(body):'';const req=http.request({socketPath:sock,path,method,headers:body?{'content-type':'application/json','content-length':Buffer.byteLength(data)}:{}},res=>{let t='';res.setEncoding('utf8');res.on('data',d=>t+=d);res.on('end',()=>{let j;try{j=JSON.parse(t);}catch{j=t.slice(0,500);}resolve({status:res.statusCode,body:j});});});req.on('error',e=>resolve({error:e.message}));req.end(data);});

export default async()=>{
 const why=contained();if(why.length)throw new Error('refusing to run, not contained: '+why.join('; '));
 const env={PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',TMPDIR:'/tmp',USER:process.env.USER??'',SHELL:'/bin/bash'};
 if(!existsSync(join(WORK,'.smns')))execFileSync('sminos',['project','init','--name','uxw'],{cwd:WORK,env,encoding:'utf8',timeout:60000});
 for(const arm of ARMS){
  await mawsLaunch(TAG+'-'+arm,{model:process.env.UXW_MODEL||'haiku',spendCap:'0.30',lane:arm==='maws',flags:['--plugin-dir',PLUGIN],env:{CLAUDE_CODE_ENABLE_FUNCTION_HOOKS:'1'},provenance:{probe:'U3b probe 2 (headless)',arm,plugin:PLUGIN}},async(p,{sessionId,transcript})=>{
   const sock=join(process.env.HOME,'.claude/sminos/bridge',sessionId+'.sock');
   let lastLine=0;
   const record=(name,from,extra={})=>{const rows=rowsOf(transcript);const file=fileArrivals(rows,lastLine);lastLine=rows.length;p.note({event:'uxw_case',case:name,arm,fromSeq:from,toSeq:p.seq,...extra,wire:wireArrivals(p,from),file});console.log(arm,name,JSON.stringify(extra.answer??''));};
   let from=p.seq;await turn(p,'Without using any tool, reply with only the word READY.');await idle(p,60000,3000);record('warm',from);
   let st=null;for(let i=0;i<30&&!(st?.status===200);i++){await delay(1000);if(existsSync(sock))st=await call(sock,'GET','/status');}
   const status=st?.body??null;const launch=typeof status?.launch==='string'?status.launch:null;
   p.note({event:'bridge_status',reachable:st?.status===200,sminos:status?.capabilities?.sminos,observer:status?.capabilities?.observer??status?.observer??null,ops:status?.capabilities?.ops??null,controls:status?.capabilities?.controls?Object.fromEntries(Object.entries(status.capabilities.controls).map(([k,v])=>[k,v])):null});
   const typed=async args=>{const from=p.seq;const s=prompt(p,'/rename '+args);await waitFor(p,f=>f.type==='result',{after:s.seq,timeout:60000});await idle(p,30000,3000);record('typed '+args,from);};
   const viaBridge=async args=>{const from=p.seq;const a=st?.status===200?await call(sock,'POST','/command?wait=30000',{op:'command',name:'rename',args,...(launch&&{launch})}):{error:'no bridge'};await delay(3000);await idle(p,30000,3000);record('bridge '+args,from,{answer:JSON.parse(redact(JSON.stringify(a)))});};
   await typed('uxw typed one');
   await viaBridge('uxw bridge one');
   await viaBridge('uxw bridge two');
   await typed('uxw typed two');
   keepTranscript(transcript,TAG+'-'+arm);
   console.log(arm,'cost',cost(p));
  });
 }
};
