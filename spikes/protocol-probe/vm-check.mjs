// VM.md: the check of what vm-run.sh gives an engine. One launch on the harness's line with MAWS's setting sources
// (user,project,local, no --strict-mcp-config, as c10-common launches; the environment vm-run.sh
// built, inherited), one short turn, then the facts a probe on the VM rests on, each noted as a `vm_check` row and
// printed: the engine's version, the route, what system/init lists (plugins, skills, MCP servers, the gated Monitor
// tool), and every instructions file the session loaded. Its working folder holds a CLAUDE.md of its own as the positive
// control, so the right answer is that one file and no other.
// Run: spikes/protocol-probe/vm-run.sh --out /tmp/<prefix>-fixtures run vm-check.mjs
import {run,scratch} from './harness.mjs';
import {readFileSync,readdirSync,existsSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {userInfo} from 'node:os';

const OWNER_HOME=userInfo().homedir;
const cwd=scratch();writeFileSync(join(cwd,'CLAUDE.md'),'The project word is TEAL.\n');
await run('vm-check',async p=>{
 await p.init();
 const result=await p.turn('Without using any tool, reply with only the project word your instructions name, or NONE.');
 const init=p.frames.find(r=>r.frame.type==='system'&&r.frame.subtype==='init');
 const dir=join(process.env.HOME,'.claude/projects');
 const transcript=existsSync(dir)?readdirSync(dir).flatMap(d=>readdirSync(join(dir,d)).filter(f=>f===p.sessionId+'.jsonl').map(f=>join(dir,d,f)))[0]:undefined;
 const text=transcript?readFileSync(transcript,'utf8'):'';
 const attachments=text.split('\n').filter(Boolean).map(l=>JSON.parse(l)).filter(r=>r.type==='attachment').map(r=>r.attachment);
 const loaded=attachments.flatMap(a=>a.type==='instructions'?(a.files||[]).map(f=>f.path):a.type==='nested_memory'?[a.path??a.content?.path]:[]);
 const f=init.frame;
 const facts={
  initSeq:init.seq,version:f.claude_code_version,model:f.model,apiKeySource:f.apiKeySource,routed:p.frames.length&&JSON.parse(readFileSync(p.file,'utf8').split('\n')[0]).frame.routed,
  plugins:f.plugins.map(x=>x.source??x.name),skills:f.skills,mcpServers:f.mcp_servers,monitor:f.tools.includes('Monitor'),toolCount:f.tools.length,
  result:{seq:p.frames.find(r=>r.frame===result)?.seq,subtype:result.subtype,isError:result.is_error,text:result.result},
  transcript:!!transcript,attachmentTypes:[...new Set(attachments.map(a=>a.type))],
  instructionsLoaded:[...new Set(loaded)].map(f=>f===join(cwd,'CLAUDE.md')?'<cwd>/CLAUDE.md (the control)':f),
  transcriptNamesOwnerHome:text.includes(OWNER_HOME+'/'),
 };
 p.note({event:'vm_check',...facts});
 console.log(JSON.stringify(facts,null,1));
},{cwd,settingSources:'user,project,local',strictMcp:false});
