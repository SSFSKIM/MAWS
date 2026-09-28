import {run,delay} from '../harness.mjs';
import {randomUUID} from 'node:crypto';
export default ()=>run('queue-and-interrupt',async p=>{await p.init();p.on('can_use_tool',r=>r.tool_name==='Bash'?{behavior:'allow',updatedInput:r.input}:{behavior:'deny',message:'Only Bash is in scope.'});
 const start=p.seq;p.user('Count to 30 slowly. For each number use a separate Bash call sleep 1; echo NUMBER. Start now.');
 await p.wait(f=>f.type==='assistant'&&f.message.content.some(b=>b.type==='tool_use'),{after:start});const q=p.user('After counting, reply exactly QUEUED.');await delay(1200);await p.request('interrupt',{reason:'probe',cancel_queued:true});await p.wait(f=>f.type==='result',{after:start});await p.turn('Counting is cancelled. Reply exactly RESUMED.');
 const after=p.seq;p.send({type:'bash_command',command:'printf BASH_MODE_OK',cwd:p.cwd,uuid:randomUUID()});await p.wait(f=>f.type==='user'&&JSON.stringify(f).includes('BASH_MODE_OK'),{after,timeout:15000});await delay(500);
},{flags:['--replay-user-messages']});
