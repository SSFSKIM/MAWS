import {run} from '../harness.mjs';
import {readdirSync,statSync,writeFileSync,realpathSync} from 'node:fs';
import {homedir} from 'node:os';
export default ()=>run('subagent',async p=>{writeFileSync(p.cwd+'/two.txt','TWO\n');await p.init();p.on('can_use_tool',r=>['Agent','Task','Read'].includes(r.tool_name)?{behavior:'allow',updatedInput:r.input}:{behavior:'deny',message:'Only Agent and Read in scope.'});
 await p.turn('Dispatch two general-purpose Agent subagents in parallel, model haiku. One reads one.txt, the other two.txt; each reports only its file line. Set run_in_background true for the second if supported. Summarize in one line after both finish.');
 for(let n=0;n<2;n++){const previous=p.frames.filter(r=>r.frame.subtype==='task_notification');if(previous.length>=2)break;await p.wait(f=>f.subtype==='task_notification',{after:p.seq});}
 const base=(process.env.CLAUDE_CONFIG_DIR||homedir()+'/.claude')+'/projects/'+realpathSync(p.cwd).replace(/[^a-zA-Z0-9]/g,'-');const files=[];function walk(dir){try{for(const e of readdirSync(dir,{withFileTypes:true})){const f=dir+'/'+e.name;if(e.isDirectory())walk(f);else files.push({path:f,bytes:statSync(f).size});}}catch(e){files.push({path:dir,error:e.code});}}walk(base);p.note({event:'project_files',base,files});
},{flags:['--forward-subagent-text']});
