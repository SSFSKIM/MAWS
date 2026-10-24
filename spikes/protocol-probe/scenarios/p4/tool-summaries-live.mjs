// Live bidirectional stream-json probe: three dependent tool batches, then a second user turn.
// No engine patches; temporary config and workspace; capped inference spend.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {Probe} from '../../harness.mjs';
const config=mkdtempSync('/tmp/maws-summaries-config-');
const cwd=mkdtempSync('/tmp/maws-summaries-work-');
writeFileSync(cwd+'/first.txt','Next read second.txt.\n');
writeFileSync(cwd+'/second.txt','Final target third.txt.\n');
writeFileSync(cwd+'/third.txt','Answer: violet.\n');
const bin='/Users/new/.local/share/claude/versions/2.1.309';
const probe=new Probe('p4-tool-summaries-live',{cwd,bin,dir:'fixtures/p4/',model:'claude-haiku-5-5',dropInheritedClaude:true,
 flags:['--tools','Read','--allowedTools','Read','--max-turns','6','--max-budget-usd','0.45','--no-session-persistence','--effort','low'],
 env:{CLAUDE_CONFIG_DIR:config,CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES:'true'}});
try {
 probe.note({event:'provenance',engineVersion:execFileSync(bin,['--version'],{encoding:'utf8'}).trim(),summaryEnv:'CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES=true',isolation:'temporary workspace and empty config; stdin kept open across two user turns',model:'claude-haiku-5-5',helperModelOverride:process.env.ANTHROPIC_SMALL_FAST_MODEL??null,haikuAlias:process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL??null});
 probe.on('can_use_tool',r=>r.tool_name==='Read'&&r.input?.file_path?.startsWith(cwd+'/')?{behavior:'allow',updatedInput:r.input}:{behavior:'deny',message:'Only scratch-file reads allowed.'});
 assert.equal((await probe.init({workspaceTrust:{accepted:true,directory:cwd}})).subtype,'success');
 const result=await probe.turn(`Use Read on ${cwd}/first.txt and follow its pointer, then follow the second file's pointer. Read each file in a separate step after receiving its predecessor. Read nothing else and change nothing. After the three reads answer with the final file's answer only.`);
 assert.equal(result.is_error,false);
 const second=await probe.turn(`Read ${cwd}/third.txt once again and reply with its answer only.`);
 assert.equal(second.is_error,false);
 const summaries=probe.frames.filter(r=>r.frame.type==='tool_use_summary');
 probe.note({event:'probe_complete',summaries:summaries.map(r=>({seq:r.seq,at:r.at,summary:r.frame.summary,ids:r.frame.preceding_tool_use_ids})),results:probe.frames.filter(r=>r.frame.type==='result').map(r=>({seq:r.seq,cost:r.frame.total_cost_usd,modelUsage:r.frame.modelUsage}))});
 console.log(JSON.stringify({fixture:probe.file,summaries:summaries.length,cost:second.total_cost_usd}));
} finally {await probe.stop();rmSync(config,{recursive:true,force:true});rmSync(cwd,{recursive:true,force:true});}
