import {run,scratch} from '../harness.mjs';
export default async()=>{const cwd=scratch();const first=await run('resume-fork-start',async p=>{await p.init();await p.turn('Remember the word ZEBRA. Reply OK.');},{cwd});if(!first.sessionId)return;
 for(const replay of [false,true])await run('resume-fork-'+(replay?'replay':'no-replay'),async p=>{await p.init();await p.turn('What word did I ask you to remember? Reply with just that word.');if(replay)await p.request('fork_conversation',{title:'MAWS probe fork'});},{cwd,flags:['--resume',first.sessionId,...(replay?['--replay-user-messages']:[])]});
 await run('resume-fork-cli',async p=>{await p.init();await p.turn('What word did I ask you to remember? Reply with just that word.');},{cwd,flags:['--resume',first.sessionId,'--fork-session']});};
