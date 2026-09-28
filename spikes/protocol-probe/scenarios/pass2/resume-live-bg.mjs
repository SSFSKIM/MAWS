// Item 10, second half: --resume a session that a `claude --bg` job (daemon-hosted TUI) still holds. Usage: PROBE_BG_SESSION=<id> PROBE_BG_CWD=<trusted dir>.
import {probe,initPayload,transcriptPath,jsonl,summarizeRecord} from './common.mjs';
export default async()=>{const sid=process.env.PROBE_BG_SESSION,cwd=process.env.PROBE_BG_CWD;const file=transcriptPath(sid);const before=jsonl(file).length;
 const b=probe('resume-live-bg',{cwd,model:'sonnet',flags:['--resume',sid]});b.note({event:'bg_holder',session:sid,linesBefore:before});
 try{await b.request('initialize',initPayload());await b.turn('What word did I ask you to remember? Reply with just that word, then the word SECOND.');}catch(e){b.note({event:'refused',error:e.message});}
 await b.stop();
 const recs=jsonl(file);b.log('meta',{event:'jsonl_after',holderSession:sid,secondSession:b.sessionId,sameSession:b.sessionId===sid,linesBefore:before,linesAfter:recs.length,records:recs.filter(r=>['user','assistant'].includes(r.type)).map(summarizeRecord)});
};
