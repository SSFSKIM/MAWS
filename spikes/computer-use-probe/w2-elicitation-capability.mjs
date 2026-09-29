// W2-1h: does a host advertising bare `elicitation:{}` (Claude Code's default) receive app-approval requests?
// The approval is always declined, so no app is launched or touched.
import {run} from './mcp-client.mjs';
import {cuaRepl} from './cua-env.mjs';
for (const [name,capabilities] of [['w2-elicit-cap-bare',{elicitation:{}}],['w2-elicit-cap-form',{elicitation:{form:{}}}],['w2-elicit-cap-none',{}]])
 await run(name,async p=>{
  let seen=0;p.on('elicitation/create',()=>{seen++;return {action:'decline'};});
  await p.init();
  const r=await p.callTool('js',{title:'policy',code:'try { await cua.getApp("TextEdit"); nodeRepl.write("RESULT getApp returned"); } catch (e) { nodeRepl.write(`RESULT ${e.message}`); }'});
  const text=r.content.filter(c=>c.type==='text').map(c=>c.text).join(' ');
  console.log(name.padEnd(20),'elicitations received:',seen,'|',(text.match(/RESULT .*/)||['?'])[0]);
 },{...cuaRepl(),capabilities});
