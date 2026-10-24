// Read-only headless tool_use_summary capture. Desktop Code disables this stream; Cowork's gate enables the env flag.
// Source checked before probing: engine 2.1.309 cli.pretty.js:471291,473102; Desktop 3.6556.2 main-process
// index.chunk-jPKPzV-P.js:316009 and index.chunk-Dl8NPgw7.js:20511. The engine binary is never patched.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Probe} from '../../harness.mjs';

const cwd=fileURLToPath(new URL('../../../../',import.meta.url));
const config=mkdtempSync(join(tmpdir(),'maws-tool-use-summary-'));
const target=join(cwd,'src/shared/engine/initialize.ts');
const pin=execFileSync('git',['rev-parse','HEAD'],{cwd,encoding:'utf8'}).trim();
const bin=process.env.PROBE_BIN||'claude';
const probe=new Probe('p4-ux1c-tool-use-summary',{
 cwd,bin,dir:'fixtures/p4/',model:'claude-opus-5-5',dropInheritedClaude:true,
 flags:['--tools','Read','--allowedTools','Read','--max-turns','3','--max-budget-usd','0.50','--no-session-persistence'],
 env:{CLAUDE_CONFIG_DIR:config,CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES:'true'},
});
try{
 probe.note({event:'provenance',charter:'docs/charter.md',child:'P4-UX1',finding:'l2-transcript-01',pin,engineVersion:execFileSync(bin,['--version'],{encoding:'utf8'}).trim(),isolation:'empty temporary CLAUDE_CONFIG_DIR; no personal settings or hooks',summaryEnv:'CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES=true'});
 probe.on('can_use_tool',request=>request.tool_name==='Read'&&request.input?.file_path===target?{behavior:'allow',updatedInput:request.input}:{behavior:'deny',message:'This probe permits only the one named source-file read.'});
 const initialized=await probe.init({workspaceTrust:{accepted:true,directory:cwd}});
 assert.equal(initialized.subtype,'success');
 const result=await probe.turn(`Use Read exactly once to read ${target}. Do not call any other tool, modify files, or delegate. Then reply with only the exported function name.`);
 assert.equal(result.is_error,false);
 const summaries=probe.frames.filter(row=>row.frame.type==='tool_use_summary');
 assert.ok(summaries.length>0,'headless engine emitted no tool_use_summary');
 probe.note({event:'summary_capture',summaries:summaries.map(row=>({seq:row.seq,at:row.at,frame:row.frame})),result:result.result});
 console.log(JSON.stringify({fixture:probe.file,summaries:summaries.map(row=>({seq:row.seq,at:row.at,frame:row.frame})),result:result.result}));
}catch(error){
 probe.note({event:'scenario_error',error:error.stack});
 throw error;
}finally{
 await probe.stop();
 rmSync(config,{recursive:true,force:true});
}
