import {run} from '../harness.mjs';
export default ()=>run('question-roundtrip',async p=>{
 await p.init();p.on('can_use_tool',r=>{if(r.tool_name!=='AskUserQuestion')return {behavior:'deny',message:'Only questions are in scope.'};const answers=Object.fromEntries(r.input.questions.map(q=>[q.question,q.multiSelect?q.options.slice(0,2).map(o=>o.label).join(', '):q.options[0].label]));return {behavior:'allow',updatedInput:{...r.input,answers}};});
 await p.turn('Call AskUserQuestion once with two questions: choose Red or Blue (include a short preview for each option), and choose fruits Apple and Pear (multiSelect true). After receiving answers, repeat them briefly.');
});
