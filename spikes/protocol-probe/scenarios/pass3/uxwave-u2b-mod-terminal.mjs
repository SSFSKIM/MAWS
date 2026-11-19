// UX wave U2b, check 1, second round, item 3: the mod in a terminal session (docs/doperpowers/plans/2026-11-15-ux-wave-U2b-
// to-human-view.md, check 1; the branch's `joinGroup` sits in the ToolGroup hook every terminal session runs).
//
// Run directly with node from spikes/protocol-probe/ (not under vm-run.sh: it calls `vm-run.sh ... term` itself, so the
// engine runs in vm-run's namespace, scratch HOME and gateway route, as VM.md's terminal sessions do):
//   U2B_DOPER=<folder with before/ and after/> node scenarios/pass3/uxwave-u2b-mod-terminal.mjs [before|after ...]
// For each installation: the checkout's whole to-human/ and sminos/ folders and a plugin of the output style alone are
// copied into /tmp/u2bterm-<which>-plugins and loaded with --plugin-dir in an interactive engine (tmux, haiku,
// --permission-mode default, no MAWS_NATIVE_TO_HUMAN, CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1, the style and the owner's
// plugin order in --settings). Turn 1 asks for one marked message (so the view folds from turn 2 on); turn 2 for four
// read-only tool calls, one per response, then a marked message. The pane is captured every 700 ms while turn 2 runs
// and for 45 s after (each distinct capture kept with its time), then the session's folds file is read. Fixture
// fixtures/uxwave/u2b-mod-terminal-<which>.json.
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,existsSync,cpSync,rmSync,readdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE=join(dirname(fileURLToPath(import.meta.url)),'../..');
const DOPER=process.env.U2B_DOPER;if(!DOPER)throw new Error('U2B_DOPER names the folder holding before/ and after/');
const WHICH=process.argv.slice(2).length?process.argv.slice(2):['before','after'];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const TURN1='Reply with exactly <message>Ready.</message> and nothing else. Use no tool.';
const TURN2='This is a test of your tools. Do exactly these steps in order, one tool call per response, and write no text between them. Step 1: use the Read tool on one.txt. Step 2: use the Glob tool with the pattern *.txt. Step 3: use the Grep tool with the pattern ONE. Step 4: use the Read tool on one.txt again. Step 5: reply with exactly <message>Done reading.</message> and nothing else.';

function plugins(which){
 const dir=join(DOPER,which),root=`/tmp/u2bterm-${which}-plugins`;rmSync(root,{recursive:true,force:true});mkdirSync(root);
 for(const n of ['to-human','sminos'])cpSync(join(dir,n),join(root,n),{recursive:true});
 const style=join(root,'doperpowers');mkdirSync(join(style,'.claude-plugin'),{recursive:true});mkdirSync(join(style,'output-styles'));
 writeFileSync(join(style,'.claude-plugin/plugin.json'),JSON.stringify({name:'doperpowers',version:JSON.parse(readFileSync(join(dir,'.claude-plugin/plugin.json'),'utf8')).version,description:'the output style alone'}));
 cpSync(join(dir,'output-styles/to-human.md'),join(style,'output-styles/to-human.md'));
 return {root,commit:execFileSync('git',['-C',dir,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),version:JSON.parse(readFileSync(join(dir,'to-human/.claude-plugin/plugin.json'),'utf8')).version};
}

async function session(which){
 const p=plugins(which);const name=`u2bt-${which}`;
 const settings={outputStyle:'doperpowers:to-human',prependPlugins:['to-human@inline','sminos@inline']};
 const args=['--prefix','u2bterm','-e','CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1','term',name,'--model','haiku','--permission-mode','default','--settings',JSON.stringify(settings),...['to-human','sminos','doperpowers'].flatMap(n=>['--plugin-dir',join(p.root,n)])];
 const out=spawnSync(join(HERE,'vm-run.sh'),args,{cwd:HERE,encoding:'utf8'});
 const scratch=/scratch (\/tmp\/u2bterm-\S+),/.exec(out.stderr)?.[1];if(!scratch)throw new Error('vm-run.sh: '+out.stderr);
 const tmux=(...a)=>execFileSync('tmux',['-L',name,...a],{encoding:'utf8'});
 const pane=()=>{try{return tmux('capture-pane','-p','-t',name);}catch{return '';}};
 const type=async t=>{tmux('send-keys','-t',name,'-l',t);await delay(500);tmux('send-keys','-t',name,'Enter');};
 const busy=()=>/esc to interrupt/i.test(pane());
 const until=async(test,ms,step=500)=>{const end=Date.now()+ms;while(Date.now()<end){if(await test())return true;await delay(step);}return false;};
 const quiet=()=>until(async()=>{if(busy())return false;await delay(3000);return !busy();},180000,1000);
 const t0=Date.now();const captures=[];let last='';
 const take=(phase)=>{const c=pane();if(c!==last){last=c;captures.push({ms:Date.now()-t0,phase,pane:c});}};
 try{
  await until(()=>/❯|>\s*$/m.test(pane()),60000);await delay(3000);take('ready');
  await type(TURN1);await delay(4000);await quiet();take('after turn 1');
  await type(TURN2);
  const end2=Date.now()+180000;let idleSince=null;
  while(Date.now()<end2){take('turn 2');if(busy())idleSince=null;else idleSince??=Date.now();if(idleSince&&Date.now()-idleSince>4000)break;await delay(700);}
  const endAfter=Date.now()+45000;while(Date.now()<endAfter){take('after turn 2');await delay(700);}
  const home=join(scratch,'home','.claude');const foldsDir=join(home,'to-human','folds');
  const folds=existsSync(foldsDir)?readdirSync(foldsDir).map(f=>({name:f,text:readFileSync(join(foldsDir,f),'utf8')})):[];
  const projects=join(home,'projects');const calls=[];
  if(existsSync(projects))for(const d of readdirSync(projects))for(const f of readdirSync(join(projects,d)).filter(f=>f.endsWith('.jsonl')))for(const l of readFileSync(join(projects,d,f),'utf8').split('\n').filter(Boolean)){const r=JSON.parse(l);if(r.type==='assistant')for(const b of r.message?.content??[])if(b.type==='tool_use')calls.push({id:b.id,name:b.name,input:b.input});}
  const record={provenance:{plan:'docs/doperpowers/plans/2026-11-15-ux-wave-U2b-to-human-view.md',section:'check 1, second round, item 3',installation:{which,commit:p.commit,version:p.version},engine:'2.1.322 (vm-run.sh term)',launch:'interactive, tmux 160x48, --model haiku --permission-mode default, --settings '+JSON.stringify(settings)+', three --plugin-dir, CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1, no MAWS_NATIVE_TO_HUMAN',prompts:[TURN1,TURN2]},captures,foldsFiles:folds,calls};
  const fx=join(HERE,'fixtures/uxwave');mkdirSync(fx,{recursive:true});writeFileSync(join(fx,`u2b-mod-terminal-${which}.json`),JSON.stringify(record,null,1)+'\n');
  console.log(which,'captures',captures.length,'folds',folds.length,'calls',calls.length);
 }finally{try{tmux('kill-server');}catch{}rmSync(p.root,{recursive:true,force:true});}
}
for(const w of WHICH)await session(w);
