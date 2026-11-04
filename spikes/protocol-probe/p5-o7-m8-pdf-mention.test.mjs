// P5 O7 M8, task m8-1 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M8's *The PDF*): what the pinned
// engine attaches for an `@<path>` mention in a stream-json user frame, the form a PDF dropped on a remote session
// reaches its machine in (`remoteMessage`, src/renderer/src/composer/editor/remote-uploads.ts: the upload's path under
// `.claude/desk-uploads/<appSessionId>/`, relative to the cwd, after the words). One launch against the scripted
// Messages API (stub-api.mjs), so nothing is spent; three turns: the PDF mention as MAWS sends it (a string), the same
// in a text block (the form beside an inline image), and a text file's mention as the control (does the engine expand
// any mention here?). Recorded: each turn's first main-loop request, every message's blocks in brief, and what the
// transcript keeps. Runs on CI's Linux probe lane only (`scripts/ci-gate.sh <worktree> --gates probes`), which
// provisions the engine by checksum (scripts/provision-engine.sh); anywhere else it is skipped, so no engine starts on a
// workstation. Its findings: findings-p5-o7-m8-pdf-mention.txt.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync,realpathSync,rmSync} from 'node:fs';
import {join,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const ENGINE='2.1.312'; // src/engine-host/engine-compat.ts TESTED_ENGINE_VERSION
const HERE=fileURLToPath(new URL('.',import.meta.url));
const REPO=join(HERE,'..','..');
const PDF_MARKER='PDFMARKER7Q';
const TEXT_MARKER='TEXTMARKER4K';
const APP='5a2c8f1e-0d3b-4c7a-9e6f-1b2d3c4e5f60';
const UPLOAD=`.claude/desk-uploads/${APP}/brief.pdf`;
const ARMS=[
 {label:'pdf-string',content:`Summarise the attached brief.\n\n@${UPLOAD}`},
 {label:'pdf-block',content:[{type:'text',text:`Summarise the attached brief.\n\n@${UPLOAD}`}]},
 {label:'text-control',content:'What does this note say?\n\n@notes.txt'},
];
const onProbeLane=process.env.GITHUB_ACTIONS==='true'&&process.platform==='linux';

// A one-page PDF whose page draws PDF_MARKER, its cross-reference table at the right offsets.
function pdf(){
 const stream=`BT /F1 24 Tf 72 720 Td (${PDF_MARKER}) Tj ET`;
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 let out='%PDF-1.4\n';const offsets=[];
 objects.forEach((body,i)=>{offsets.push(out.length);out+=`${i+1} 0 obj\n${body}\nendobj\n`;});
 const xref=out.length;
 out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.map(o=>`${String(o).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 return out;
}

// A block in brief: a text block's size, head and markers; a document's or an image's source; a tool result's text.
function brief(b){
 const markers=text=>[PDF_MARKER,TEXT_MARKER,UPLOAD,'notes.txt'].filter(m=>text.includes(m));
 if(typeof b==='string')return {type:'text',chars:b.length,head:b.slice(0,240),markers:markers(b)};
 if(b.type==='text')return {type:'text',chars:b.text.length,head:b.text.slice(0,240),markers:markers(b.text)};
 if(b.type==='document'||b.type==='image')return {type:b.type,source:{type:b.source?.type,media_type:b.source?.media_type??null,bytes:typeof b.source?.data==='string'?b.source.data.length:null}};
 if(b.type==='tool_result'){const text=JSON.stringify(b.content??'');return {type:'tool_result',chars:text.length,markers:markers(text)};}
 if(b.type==='tool_use')return {type:'tool_use',name:b.name,input:b.input};
 return {type:b.type};
}
const messagesOf=body=>(body.messages??[]).map((m,i)=>({i,role:m.role,blocks:(typeof m.content==='string'?[m.content]:m.content??[]).map(brief)}));

// The engine at ENGINE for this runner, provisioned by checksum into a scratch cache.
function provision(cache){
 const out=execFileSync('bash',[join(REPO,'scripts/provision-engine.sh'),ENGINE],{encoding:'utf8',env:{PATH:process.env.PATH,HOME:process.env.HOME,MAWS_ENGINE_CACHE:cache}});
 return out.match(/^export MAWS_E2E_ENGINE_BIN=(.*)$/m)[1].replace(/^'|'$/g,'');
}

test(`p5 O7 M8: what engine ${ENGINE} attaches for an @<path> mention in a stream-json user frame (a PDF, as a remote drop sends it; a text file as the control)`,{skip:onProbeLane?false:'runs on CI\'s Linux probe lane only',timeout:300000},async t=>{
 const {Probe}=await import('./harness.mjs');
 const {startStubApi,textTurn}=await import('./stub-api.mjs');
 const root=realpathSync(mkdtempSync(join(tmpdir(),'maws-m8-pdf-')));
 const stub=await startStubApi({script:ARMS.map(a=>textTurn(`ok ${a.label}`)),record:body=>({messages:messagesOf(body)})});
 let p;
 try{
  const bin=provision(join(root,'engine'));
  const home=join(root,'config');mkdirSync(home);
  const cwd=join(root,'repo');mkdirSync(join(cwd,'.claude','desk-uploads',APP),{recursive:true});
  writeFileSync(join(cwd,UPLOAD),pdf(),'latin1');
  writeFileSync(join(cwd,'notes.txt'),`The note reads ${TEXT_MARKER}.\n`);
  execFileSync('git',['init','-q'],{cwd});
  writeFileSync(join(home,'settings.json'),'{}\n');
  writeFileSync(join(home,'.claude.json'),JSON.stringify({hasCompletedOnboarding:true,projects:{[cwd]:{hasTrustDialogAccepted:true,hasCompletedProjectOnboarding:true}}})+'\n');
  p=new Probe('p5-o7-m8-pdf-mention',{cwd,bin,dir:relative(HERE,root)+'/',dropInheritedClaude:true,settingSources:'user,project,local',strictMcp:false,
   flags:['--forward-subagent-text','--replay-user-messages','--include-hook-events','--settings',JSON.stringify({dialogExpiry:'never'}),'--max-budget-usd','0.01'],
   env:{CLAUDE_CONFIG_DIR:home,ANTHROPIC_BASE_URL:stub.url,ANTHROPIC_AUTH_TOKEN:'stub-token',DISABLE_AUTOUPDATER:'1',CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING:'1',CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS:'1',TERM:'dumb'}});
  const init=await p.init({workspaceTrust:{accepted:true,directory:cwd}});
  assert.equal(init.subtype,'success',JSON.stringify(init));
  const arms=[];
  for(const arm of ARMS){
   const from=stub.requests.length;
   const result=await p.turn(arm.content);
   const main=stub.requests.slice(from).filter(q=>q.main);
   // the turn's own messages: those after the model's last answer in its first main-loop request
   const messages=main[0]?.messages??[];
   const last=messages.findLastIndex(m=>m.role==='assistant');
   arms.push({label:arm.label,sent:arm.content,result:{subtype:result.subtype,is_error:result.is_error},mainRequests:main.length,messages:messages.slice(last+1)});
  }
  // what the engine echoed of each human frame, and what its transcript keeps
  const echoed=p.frames.filter(r=>r.frame.type==='user'&&!r.frame.parent_tool_use_id).map(r=>({isReplay:r.frame.isReplay??null,isSynthetic:r.frame.isSynthetic??null,blocks:(typeof r.frame.message?.content==='string'?[r.frame.message.content]:r.frame.message?.content??[]).map(brief)}));
  const projects=join(home,'projects');
  const kept=existsSync(projects)?readdirSync(projects).flatMap(d=>readdirSync(join(projects,d)).filter(f=>f.endsWith('.jsonl')).flatMap(f=>readFileSync(join(projects,d,f),'utf8').trim().split('\n').map(l=>JSON.parse(l)))).filter(r=>r.type==='user'||r.type==='attachment').map(r=>({type:r.type,isMeta:r.isMeta??null,attachment:r.attachment?{type:r.attachment.type,filename:r.attachment.filename??null,contentType:r.attachment.content?.type??null}:null,blocks:r.message?(typeof r.message.content==='string'?[r.message.content]:r.message.content??[]).map(brief):null})):[];
  const summary={engine:ENGINE,arms,echoed,kept};
  // the record leaves the runner in the job's log; findings-p5-o7-m8-pdf-mention.txt copies it
  for(const line of JSON.stringify(summary,null,1).split('\n'))t.diagnostic(`m8-pdf ${line}`);
  for(const arm of arms){assert.equal(arm.result.subtype,'success',arm.label);assert.ok(arm.mainRequests>=1,arm.label);}
 }finally{
  await p?.stop();
  await stub.close();
  rmSync(root,{recursive:true,force:true});
 }
});
