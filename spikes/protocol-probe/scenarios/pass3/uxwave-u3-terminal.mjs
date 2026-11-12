// UX wave U3, probes 2 and 4, the terminal half (U3-transcript-rows.md, "Probes and checks" 2 and 4): what a terminal
// session's transcript file holds for a scheduled prompt's fire and for slash commands' output, the rows the file and
// remote routes of UC-2 read. Runs under vm-run.sh like any scenario and starts the interactive engine itself in tmux
// inside the same namespace and environment (what `vm-run.sh term` does: the pinned engine in the scratch work/, auto
// mode by the scratch home's defaults), types into it with send-keys and reads its transcript under the scratch HOME.
// Kept: the transcript (redacted) and the pane at each step, in fixtures/uxwave/<tag>.terminal.json.
// UXW_TERM=cron: one recurring job every minute, UXW_FIRES fires (2 by default), then deleted.
// UXW_TERM=commands: /compact on an empty session, one exchange, /compact, /cost, /context, /reload-plugins,
// /rename, /effort low, /model with a model that does not exist, a command that does not exist, /compact.
import {execFileSync} from 'node:child_process';
import {readdirSync,statSync,writeFileSync,mkdirSync,existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {redact} from '../../harness.mjs';
import {BIN,ENGINE_VERSION,FIXTURES,rowsOf,fileArrivals,keepTranscript,slug,delay,U3} from './uxwave-common.mjs';

const MODE=process.env.UXW_TERM;
const TAG=process.env.UXW_TAG||'u3-terminal-'+MODE;
const NAME='py-'+MODE+'-'+process.pid;
const WORK=process.env.PROBE_WORK;
const tmux=(...a)=>execFileSync('tmux',['-L',NAME,...a],{encoding:'utf8'});
const pane=()=>tmux('capture-pane','-p','-t',NAME);
const type=async text=>{tmux('send-keys','-t',NAME,'-l',text);await delay(400);tmux('send-keys','-t',NAME,'Enter');};
const projectDir=join(process.env.HOME,'.claude/projects',slug(WORK));
const transcript=()=>{if(!existsSync(projectDir))return null;const f=readdirSync(projectDir).filter(n=>n.endsWith('.jsonl')).map(n=>join(projectDir,n)).sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs)[0];return f??null;};
const until=async(test,timeout,step=2000)=>{const end=Date.now()+timeout;while(Date.now()<end){const v=test();if(v)return v;await delay(step);}return null;};

export default async()=>{
 if(!['cron','commands','checkin'].includes(MODE))throw new Error('UXW_TERM=cron, commands or checkin');
 if(MODE==='checkin'){ // the check-in's gate (the owner's cache has 0), in this scratch HOME's cache only
  const file=join(process.env.HOME,'.claude.json');const d=JSON.parse(readFileSync(file,'utf8'));d.cachedGrowthBookFeatures={...d.cachedGrowthBookFeatures,tengu_silent_heron:10000};writeFileSync(file,JSON.stringify(d));
 }
 const record={provenance:{...U3,probe:MODE==='cron'?'U3 probe 2 (terminal)':MODE==='checkin'?'U3 probe 1 (terminal, check-in, tengu_silent_heron 10000)':'U3 probe 4 (terminal)',engine:BIN,engineVersion:ENGINE_VERSION,launch:'interactive engine in tmux, as vm-run.sh term starts it',args:['--model','haiku'],route:'gateway (vm-run.sh loopback forward)'},steps:[]};
 tmux('new-session','-d','-s',NAME,'-x','160','-y','48','-c',WORK,'-e','TERM=xterm-256color',BIN,'--model','haiku');
 let lastLine=0;
 const step=async(name,extra={})=>{const t=transcript();const rows=t?rowsOf(t):[];const file=fileArrivals(rows,lastLine);lastLine=rows.length;record.steps.push({step:name,at:new Date().toISOString(),...extra,pane:redact(pane()),file:JSON.parse(redact(JSON.stringify(file)))});console.log(name,file.length);};
 const idlePane=()=>until(()=>{const s=pane();return !/esc to interrupt|Compacting/i.test(s)&&s;},180000,2500);
 try{
  await until(()=>/auto mode|>\s|❯/.test(pane()),60000);await delay(2000);await step('ready');
  if(MODE==='cron'){
   const fires=Number(process.env.UXW_FIRES||2);
   await type('Use CronCreate (find it with ToolSearch if it is not loaded) to schedule a recurring, session-only job with cron "* * * * *" and prompt "UXW tick: reply with only the word TOCK." Then reply with only the job id.');
   await delay(8000);await idlePane();await step('setup');
   for(let i=1;i<=fires;i++){
    const before=lastLine;
    const fired=await until(()=>{const t=transcript();return t&&rowsOf(t).slice(before).some(({row:r})=>(r.type==='system'&&/schedul/.test(r.subtype??''))||(r.type==='user'&&JSON.stringify(r.message?.content??'').includes('UXW tick')));},150000,3000);
    await delay(6000);await idlePane();await step('fire-'+i,{fireSeen:!!fired});
   }
   await type('Use CronDelete to delete every job you created (CronList first if you need the ids). Then reply with only the word DELETED.');
   await delay(8000);await idlePane();await step('delete');
  }else if(MODE==='checkin'){
   await type('Run exactly `sleep 300` with the Bash tool, run_in_background true, description "uxw quiet". Then reply with only the word STARTED. If you are later told it is quiet, reply with only the word NOTED and do nothing else.');
   await delay(8000);await idlePane();await step('started');
   const before=lastLine;
   const seen=await until(()=>{const t=transcript();return t&&rowsOf(t).slice(before).some(({row:r})=>JSON.stringify(r).includes('is still running after'));},180000,3000);
   await delay(8000);await idlePane();await step('checkin',{checkinSeen:!!seen});
   await type('Stop the background task "uxw quiet" with TaskStop. Then reply with only the word STOPPED.');
   await delay(8000);await idlePane();await step('stopped');
  }else{
   const commands=[['compact-empty','/compact'],['warm','Without using any tool, write two sentences about the colour blue, then end with the word READY.'],['compact-short','/compact'],['cost','/cost'],['context','/context'],['reload-plugins','/reload-plugins'],['rename','/rename uxw renamed'],['effort','/effort low'],['model-bad','/model uxw-no-such-model'],['unknown','/uxw-no-such-command'],['warm-2','Without using any tool, write two sentences about the colour green, then end with the word READY.'],['compact-ok','/compact']];
   for(const [name,text] of commands){
    await type(text);await delay(name.startsWith('compact')||name.startsWith('warm')?8000:4000);
    // a command that opens a picker or a menu is closed with Escape (noted in the pane before it)
    await idlePane();const before=pane();if(/Esc to (cancel|close|exit)|Enter to (select|confirm)/i.test(before)){await step(name,{dialogClosed:true});tmux('send-keys','-t',NAME,'Escape');await delay(1500);}else await step(name);
   }
  }
 }finally{
  const t=transcript();record.transcript=t?keepTranscript(t,TAG).replace(FIXTURES,'fixtures/uxwave/'):null;
  mkdirSync(FIXTURES,{recursive:true});writeFileSync(FIXTURES+TAG+'.terminal.json',redact(JSON.stringify(record,null,1))+'\n');
  try{tmux('kill-server');}catch{}
 }
};
