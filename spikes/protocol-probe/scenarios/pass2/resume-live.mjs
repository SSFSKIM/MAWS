// Item 10: resume a session from a second process while the first is still live; inspect the JSONL afterwards.
import {probe,initPayload,scratch2,transcriptPath,jsonl,summarizeRecord} from './common.mjs';
export default async()=>{const cwd=scratch2();
 const a=probe('resume-live-holder',{cwd,model:'sonnet'});await a.request('initialize',initPayload());await a.turn('Remember the word KIWI. Reply OK.');
 const sid=a.sessionId;const file=transcriptPath(sid);const before=jsonl(file).length;
 const b=probe('resume-live-second',{cwd,model:'sonnet',flags:['--resume',sid]});await b.request('initialize',initPayload());
 await b.turn('What word did I ask you to remember? Reply with just that word, then the word SECOND.');
 await a.turn('Reply exactly: HOLDER-AGAIN');
 await b.stop();await a.stop();
 const recs=jsonl(file);const other=b.sessionId!==sid?transcriptPath(b.sessionId):null;
 a.log('meta',{event:'jsonl_after',holderSession:sid,secondSession:b.sessionId,sameSession:b.sessionId===sid,linesBefore:before,linesAfter:recs.length,records:recs.filter(r=>['user','assistant'].includes(r.type)).map(summarizeRecord),secondFileRecords:other?jsonl(other).filter(r=>['user','assistant'].includes(r.type)).map(summarizeRecord):null});
 console.log('resume-live',JSON.stringify({sid,second:b.sessionId}));
};
