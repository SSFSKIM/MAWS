// Item 4: rewind_files dry run, rewind_conversation refusal and success, and what happens to the JSONL on disk.
import {run,initPayload,transcriptPath,jsonl,summarizeRecord} from './common.mjs';
const snap=(p,label)=>{const t=transcriptPath(p.sessionId);const recs=jsonl(t);p.note({event:'jsonl_snapshot',label,lines:recs.length,records:recs.filter(r=>['user','assistant','last-prompt','system'].includes(r.type)||r.rewound).map(summarizeRecord)});};
export default ()=>run('rewind',async p=>{await p.request('initialize',initPayload());
 const say=async text=>{const after=p.seq;const f=p.user(text);await p.wait(x=>x.type==='result',{after});return f.uuid;};
 const u1=await say('Remember the word APPLE. Reply OK.');const u2=await say('Also remember the word BANANA. Reply OK.');
 p.note({event:'anchors',u1,u2});snap(p,'before');
 await p.request('rewind_files',{user_message_id:u2,dry_run:true});
 await p.request('rewind_conversation',{target_message_uuid:u1});
 await p.request('rewind_conversation',{target_message_uuid:u2,last_seen_user_message_uuid:u2});
 snap(p,'after-rewind');
 await say('List every word I asked you to remember, comma separated, nothing else.');snap(p,'after-next-turn');
},{model:'sonnet'});
