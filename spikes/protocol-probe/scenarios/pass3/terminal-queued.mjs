// W1 (the UX fundamentals wave, docs/charter.md): a prompt queued by the interactive terminal while a turn runs, recorded
// as the main transcript the terminal writes, to compare with what a stream-json `next` steer writes (the live suite's
// `W1 delivered next steer on disk`). The pinned binary runs interactively in a PTY under a scratch CLAUDE_CONFIG_DIR
// (settings `{}`, onboarding and the scratch repository's trust seeded in its `.claude.json`, as launch-env-common's
// terminal arm does), through the relay, Sonnet, Bash allowed by flag so no permission question interrupts the count. It
// types the slow count, waits for the first Bash call on disk, types a second prompt with Enter while that call runs,
// waits for the session to go quiet, exits with /exit, and writes the redacted transcript to
// test/fixtures/transcripts/w1-terminal-queued.jsonl. Usage: node run-pass3.mjs terminal-queued
import {createRequire} from 'node:module';
import {existsSync,readFileSync,writeFileSync,statSync,realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {root,scratch,redact,delay} from '../../harness.mjs';
import {BIN,RELAY_ENV,slug,tempDir,assertScratch,records} from './c10-common.mjs';

const REPO_ROOT=realpathSync(root+'../..');
const DEST=join(REPO_ROOT,'test/fixtures/transcripts/w1-terminal-queued.jsonl');
const SLEEP=6;
// The live suite's SLOW_COUNT, word for word.
const PROMPT=`Count to 8 with separate Bash sleep ${SLEEP} calls: for each number n from 1 to 8, make exactly one Bash call \`sleep ${SLEEP} && echo n\`, one call at a time, never in parallel. Then reply COUNTED.`;
const QUEUED='Reply TERMINAL_QUEUED';
// eslint-disable-next-line no-control-regex -- the terminal's escape sequences are what this strips
const ANSI=/\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]/g;
const BASE_KEYS=['PATH','HOME','USER','LOGNAME','SHELL','TMPDIR','LANG'];

export default async function terminalQueued(){
 const home=tempDir('/tmp/maws-w1-config-');
 writeFileSync(join(home,'settings.json'),'{}\n');
 const cwd=realpathSync(scratch('/tmp/maws-w1-repo-'));
 writeFileSync(join(home,'.claude.json'),JSON.stringify({hasCompletedOnboarding:true,theme:'light',projects:{[cwd]:{hasTrustDialogAccepted:true,hasCompletedProjectOnboarding:true}}},null,2));
 // Built from nothing: the base keys, the scratch home, the owner's model aliases and the relay.
 const aliases=Object.fromEntries(Object.entries(process.env).filter(([k,v])=>/^ANTHROPIC_DEFAULT_[A-Z]+_MODEL$/.test(k)&&v));
 const env={...Object.fromEntries(BASE_KEYS.filter(k=>process.env[k]).map(k=>[k,process.env[k]])),TERM:'xterm-256color',CLAUDE_CONFIG_DIR:home,...aliases,...RELAY_ENV};
 assertScratch(env);
 const sessionId=randomUUID();
 const args=['--model','sonnet','--allowedTools','Bash','--session-id',sessionId];
 const transcript=join(home,'projects',slug(cwd),sessionId+'.jsonl');
 const pty=createRequire(join(REPO_ROOT,'package.json'))('node-pty');
 const term=pty.spawn(BIN,args,{name:'xterm-256color',cols:140,rows:45,cwd,env});
 console.log('spawned',JSON.stringify({pid:term.pid,cwd,home,sessionId}));
 let screen='';term.onData(d=>{screen+=d;});
 const exited=new Promise(resolve=>term.onExit(e=>resolve(e)));
 const plain=()=>screen.replace(ANSI,'');
 const until=async(probe,ms,what)=>{for(const end=Date.now()+ms;Date.now()<end;await delay(250)){const v=probe();if(v)return v;}throw new Error(`timed out waiting for ${what}; screen tail: ${plain().slice(-800)}`);};
 const disk=()=>records(transcript);
 const bashUses=()=>disk().filter(r=>r.type==='assistant').flatMap(r=>r.message?.content??[]).filter(b=>b.type==='tool_use'&&b.name==='Bash');
 let exit=null;let typedAt=null;
 try{
  await until(()=>/for shortcuts|❯/.test(plain()),60_000,'the prompt');
  await delay(1500);term.write(PROMPT);await delay(500);term.write('\r');
  await until(()=>bashUses().length>=1,120_000,'the first Bash call on disk');
  await delay(1000);
  typedAt=new Date().toISOString();term.write(QUEUED);await delay(500);term.write('\r');
  console.log('queued prompt typed at',typedAt,'with',bashUses().length,'Bash call(s) on disk');
  // Done when a turn has ended after the second prompt (an interactive turn writes system/turn_duration) and the
  // transcript has then been still for 20 s; a permission question, should one appear, is answered with its default.
  let answered=0;let lastSize=-1;let stillSince=Date.now();
  for(const end=Date.now()+8*60_000;Date.now()<end;await delay(1000)){
   const asks=(plain().match(/Do you want to proceed/g)??[]).length;
   if(asks>answered){answered=asks;term.write('\r');console.log('answered a permission question with its default');}
   const size=existsSync(transcript)?statSync(transcript).size:0;
   if(size!==lastSize){lastSize=size;stillSince=Date.now();continue;}
   const ended=disk().some(r=>r.type==='system'&&r.subtype==='turn_duration'&&r.timestamp>typedAt);
   if(ended&&Date.now()-stillSince>=20_000)break;
  }
  term.write('/exit');await delay(500);term.write('\r');
  exit=await Promise.race([exited,delay(20_000).then(()=>null)]);
 }finally{
  if(exit===null){term.kill();exit=await Promise.race([exited,delay(5000).then(()=>({exitCode:null,signal:'killed'}))]);}
 }
 let alive='';try{alive=execFileSync('/bin/ps',['-p',String(term.pid),'-o','pid='],{encoding:'utf8'}).trim();}catch{}
 console.log('exit',JSON.stringify(exit),'ps -p',term.pid,JSON.stringify(alive));
 if(!existsSync(transcript))throw new Error(`no transcript at ${transcript}; screen tail: ${plain().slice(-1500)}`);
 writeFileSync(DEST,redact(readFileSync(transcript,'utf8')));
 const rows=records(DEST);
 const carrying=rows.map((r,i)=>({line:i+1,r})).filter(({r})=>JSON.stringify(r).includes('TERMINAL_QUEUED'));
 for(const {line,r} of carrying)console.log('line',line,r.type,r.attachment?.type??r.operation??r.subtype??'',JSON.stringify(r).slice(0,300));
 console.log('wrote',DEST,rows.length,'records');
 writeFileSync('/tmp/maws-w1-terminal-screen.txt',plain());
}

if(process.argv[1]&&import.meta.url.endsWith(process.argv[1].split('/').pop()))await terminalQueued();
