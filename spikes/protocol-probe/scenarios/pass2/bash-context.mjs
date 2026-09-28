// Item 11: does bash_command output reach the model's context, alone or followed by a non-querying user frame?
import {run,initPayload,delay} from './common.mjs';
import {randomUUID} from 'node:crypto';
const body=(token,echo)=>async p=>{await p.request('initialize',initPayload());
 const cmd='printf '+token;let after=p.seq;p.send({type:'bash_command',command:cmd,cwd:p.cwd,uuid:randomUUID()});
 await p.wait(f=>f.type==='user'&&JSON.stringify(f).includes('bash-stdout')&&JSON.stringify(f).includes(token),{after,timeout:20000});await delay(1000);
 if(echo){after=p.seq;p.send({type:'user',uuid:randomUUID(),shouldQuery:false,parent_tool_use_id:null,origin:{kind:'human'},message:{role:'user',content:'<bash-input>'+cmd+'</bash-input>\n<bash-stdout>'+token+'</bash-stdout><bash-stderr></bash-stderr>'}});await delay(4000);p.note({event:'after_non_querying_user',framesSince:p.frames.filter(r=>r.seq>after).map(r=>r.frame.type+(r.frame.subtype?'/'+r.frame.subtype:'')+(r.frame.state?':'+r.frame.state:''))});}
 await p.turn('I just ran a shell command with the ! prefix. What exactly did it print? Reply with only the printed text, or NONE if you cannot see it.');
};
export default async()=>{await run('bash-context-alone',body('MAWS_BASH_4417',false),{model:'sonnet',flags:['--replay-user-messages']});await run('bash-context-echoed',body('MAWS_BASH_8823',true),{model:'sonnet',flags:['--replay-user-messages']});};
