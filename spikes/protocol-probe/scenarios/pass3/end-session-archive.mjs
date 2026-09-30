// Debt wave 4 (docs/tech-debt-tracker.md, the C3 / C10 row "`end_session { reason: 'archive' }` reaches the engine on
// every archive"): C3's session ends an archived session with `end_session { reason: 'archive' }` (the recorded stop
// reason, src/engine-host/session.ts endSession), where every earlier fixture carries only `stop` and `quit`. One turn,
// then that frame; the notes record the engine's answer, how long it took to exit, its debug log's line for the
// request (it logs the reason it received), and what the session's transcript holds afterwards.
import {scratch} from '../../harness.mjs';
import {launch,initPayload,success,check,answer,RELAY_ENV,records,projectListing} from './c10-common.mjs';
import {mkdirSync,writeFileSync,readFileSync,existsSync,realpathSync} from 'node:fs';

const PROVENANCE={child:'C3',document:'docs/doperpowers/plans/2026-09-28-c3-engine-host.md',pin:'99a406c43c23863383d94b4e0aa98e30d1566b54',milestone:'debt wave 4',row:"end_session { reason: 'archive' } reaches the engine on every archive"};

export default async()=>{
 const base=`/private/tmp/maws-w4a-${Math.floor(Date.now()/1000)}`;
 const configHome=`${base}/config`;mkdirSync(configHome,{recursive:true});writeFileSync(`${configHome}/settings.json`,'{}\n');
 const repo=realpathSync(scratch(`${base}-repo-`));
 const debugFile=`${base}/engine-debug.log`;
 let ended={};
 const {p,sessionId}=await launch('end-session-archive',{cwd:repo,env:{CLAUDE_CONFIG_DIR:configHome,...RELAY_ENV},flags:['--max-budget-usd','0.10','--debug-file',debugFile],provenance:PROVENANCE},async p=>{
  success(await p.init(initPayload()),'initialize');
  await p.turn('Reply with exactly OK');
  const sent=Date.now();
  const response=await p.request('end_session',{reason:'archive'},10000);
  const answeredMs=Date.now()-sent;
  const exit=await p.closed;
  ended={response,answeredMs,exitMs:Date.now()-sent,exit};
  p.note({event:'archive_answer',answer:answer(p),response,answeredMs,exitMs:ended.exitMs,exit});
  check(p,'the engine acknowledged end_session archive',response.subtype==='success',response);
 });
 const log=existsSync(debugFile)?readFileSync(debugFile,'utf8').split('\n').filter(l=>/end_session/.test(l)).map(l=>l.replace(/^\S+\s+/,'').slice(0,300)):[];
 const listing=projectListing(configHome,repo);
 const transcript=records(`${listing.dir}/${sessionId}.jsonl`);
 const tail=transcript.slice(-4).map(r=>({type:r.type,subtype:r.subtype??null}));
 console.log('end-session-archive recorded',p.file,JSON.stringify({ended,log,entries:listing.entries,tail}));
 // Notes appended after the exit row keep the file's order; they sit outside the engine's lifetime and say so.
 p.note({event:'archive_after_exit',debugLines:log,projectEntries:listing.entries,transcriptTail:tail});
};
