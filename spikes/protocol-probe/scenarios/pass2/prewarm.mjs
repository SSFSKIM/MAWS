// Item 12: --await-claim spare, then claim_session with a cwd; frames and timing.
import {probe,scratch2,delay,initPayload} from './common.mjs';
import {mkdtempSync,realpathSync} from 'node:fs';
export default async()=>{const neutral=realpathSync(mkdtempSync('/tmp/maws-probe2-neutral-'));const target=scratch2();
 const t0=Date.now();const p=probe('prewarm',{cwd:neutral,model:'sonnet',flags:['--await-claim']});
 await delay(8000);p.note({event:'parked',msSinceSpawn:Date.now()-t0,framesWhileParked:p.frames.map(r=>r.frame.type+(r.frame.subtype?'/'+r.frame.subtype:''))});p.tree('parked');
 const c0=Date.now();let r;try{r=await p.request('claim_session',{cwd:target,include_initialize:true,permission_mode:'auto'},60000);}catch(e){p.note({event:'claim_failed',error:e.message});}
 p.note({event:'claimed',claimLatencyMs:Date.now()-c0,status:r?.response?.status,session_id:r?.response?.session_id,parked_ms:r?.response?.parked_ms,sdk_settled:r?.response?.sdk_mcp_settled,hasInitialize:!!r?.response?.initialize,error:r?.error});
 if(r?.subtype==='success'){const i=await p.request('initialize',initPayload());p.note({event:'post_claim_initialize',status:i.subtype});const f0=Date.now();await p.turn('Reply with exactly OK');p.note({event:'first_turn_ms',ms:Date.now()-f0});}
 await p.stop();console.log('prewarm',JSON.stringify({sessionId:p.sessionId}));
};
