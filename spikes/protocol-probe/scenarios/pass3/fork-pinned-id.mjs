// C10 M1, the pinned fork id (C10 document, Ask of C3 (3); SPEC §35 16.5-16.6): a start turn in a scratch repository
// pinned with `--session-id X`, then `--resume X --fork-session --session-id Y` with a fresh Y in the same directory and
// a turn. Expected: the fork's system/init.session_id is Y (the pin, not a minted id), `<slug>/Y.jsonl` holds the
// copied history under Y, `<slug>/X.jsonl` is unchanged, X !== Y. Two journals (the source and the fork, distinct ids),
// which the fork e2e replays; turns go through the relay because a scratch config home holds no credentials.
import {scratch} from '../../harness.mjs';
import {launch,scratchConfigHome,initPayload,success,check,endAsStop,initFrame,answer,records,stat,slug,join,existsSync,randomUUID,RELAY_ENV} from './c10-common.mjs';
import {realpathSync} from 'node:fs';

const MANGO='Remember the word MANGO. Reply OK.';
const RECALL='What word did I ask you to remember? Reply with just that word.';
const text=r=>{const c=r.message?.content;return typeof c==='string'?c:Array.isArray(c)?c.filter(b=>b.type==='text').map(b=>b.text).join(''):null;};

export default async()=>{
 const repo=realpathSync(scratch('/tmp/maws-probe3-fork-'));
 const configHome=scratchConfigHome();
 const env={CLAUDE_CONFIG_DIR:configHome,...RELAY_ENV};
 const transcript=id=>join(configHome,'projects',slug(repo),id+'.jsonl');
 const X=randomUUID(),Y=randomUUID();
 const opts={cwd:repo,env,flags:['--max-budget-usd','0.05']};
 const start=await launch('fork-pinned-id-start',{...opts,sessionId:X},async p=>{
  success(await p.init(initPayload()),'start initialize');
  const result=await p.turn(MANGO);
  const init=initFrame(p);
  p.note({event:'start_turn',pinned:X,init:init?{session_id:init.session_id,cwd:init.cwd}:null,answer:answer(p),result:{subtype:result.subtype,is_error:result.is_error}});
  check(p,'system/init.session_id is the pin',init?.session_id===X,{init:init?.session_id,pin:X});
  await endAsStop(p);
  check(p,'the start transcript exists under the pin',existsSync(transcript(X)),transcript(X));
 });
 const xBefore=stat(transcript(X));
 start.p.note({event:'start_transcript',path:transcript(X),stat:xBefore,count:records(transcript(X)).length});
 await launch('fork-pinned-id-fork',{...opts,sessionId:Y,flags:['--resume',X,'--fork-session',...opts.flags]},async p=>{
  p.note({event:'fork_paths',source:X,pinned:Y,repo});
  success(await p.init(initPayload()),'fork initialize');
  const result=await p.turn(RECALL);
  const init=initFrame(p);
  p.note({event:'fork_turn',source:X,pinned:Y,init:init?{session_id:init.session_id,cwd:init.cwd}:null,answer:answer(p),result:{subtype:result.subtype,is_error:result.is_error}});
  check(p,'system/init.session_id is the pinned fork id',init?.session_id===Y,{init:init?.session_id,pin:Y});
  check(p,'the pinned fork id differs from the source',X!==Y);
  check(p,'the fork recalls the source history',/MANGO/i.test(answer(p)??''),answer(p));
  await endAsStop(p);
  const yRecords=records(transcript(Y));
  const xAfter=stat(transcript(X));
  p.note({event:'fork_transcript_after_exit',path:transcript(Y),exists:existsSync(transcript(Y)),count:yRecords.length,sessionIds:[...new Set(yRecords.map(r=>r.sessionId??null))],firstUserText:text(yRecords.find(r=>r.type==='user')??{}),xBefore,xAfter});
  check(p,'the fork transcript exists under the pinned id',existsSync(transcript(Y)),transcript(Y));
  check(p,'the fork transcript carries the copied history',text(yRecords.find(r=>r.type==='user')??{})===MANGO);
  check(p,'the source transcript is unchanged',JSON.stringify(xBefore)===JSON.stringify(xAfter),{xBefore,xAfter});
 });
 console.log('fork-pinned-id recorded',X,Y);
};
