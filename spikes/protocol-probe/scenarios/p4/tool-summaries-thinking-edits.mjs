// Verify Opus default progress thinking, explicit summarized thinking, and file-result patch sidecars.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {Probe} from '../../harness.mjs';
const config=mkdtempSync('/tmp/maws-thinking-config-');
const cwd=mkdtempSync('/tmp/maws-thinking-work-');
writeFileSync(cwd+'/index.txt','Title: draft\nStatus: pending\n');
const probe=new Probe('p4-tool-summaries-thinking-edits',{cwd,bin:'/Users/new/.local/share/claude/versions/2.1.309',dir:'fixtures/p4/',model:'claude-opus-5-5',dropInheritedClaude:true,
 flags:['--tools','Read,Edit,Write','--allowedTools','Read,Edit,Write','--max-turns','6','--max-budget-usd','0.50','--no-session-persistence','--effort','low'],env:{CLAUDE_CONFIG_DIR:config,CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES:'true'}});
try {
 probe.note({event:'provenance',engineVersion:'2.1.309',model:'claude-opus-5-5',isolation:'temporary files/config; no personal settings or hooks',thinkingFirstTurn:'engine default',summaryEnv:true});
 probe.on('can_use_tool',r=>['Read','Edit','Write'].includes(r.tool_name)&&r.input?.file_path?.startsWith(cwd+'/')?{behavior:'allow',updatedInput:r.input}:{behavior:'deny',message:'Only scratch files allowed.'});
 assert.equal((await probe.init({workspaceTrust:{accepted:true,directory:cwd}})).subtype,'success');
 const result=await probe.turn(`Read ${cwd}/index.txt, then use Edit to replace 'Status: pending' with 'Status: ready'. Also use Write to create ${cwd}/notes.txt with exactly 'Ready for review.\n'. You may edit and write together after the read. Do not use any other files. Briefly state progress between steps, then finish with 'Done'.`);
 assert.equal(result.is_error,false);
 const setting=await probe.request('set_max_thinking_tokens',{max_thinking_tokens:null,thinking_display:'summarized'});
 assert.equal(setting.subtype,'success');
 const result2=await probe.turn('Without tools, find the smallest positive integer n that leaves remainder 2 on division by 5, remainder 3 on division by 7, and remainder 4 on division by 9. Give only n as the final answer.');
 assert.equal(result2.is_error,false);
 probe.note({event:'probe_complete',cost:result2.total_cost_usd,modelUsage:result2.modelUsage,results:probe.frames.filter(r=>r.frame.type==='result').map(r=>({seq:r.seq,cost:r.frame.total_cost_usd}))});
 console.log(JSON.stringify({fixture:probe.file,cost:result2.total_cost_usd}));
} finally {await probe.stop();rmSync(config,{recursive:true,force:true});rmSync(cwd,{recursive:true,force:true});}
