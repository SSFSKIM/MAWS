// UX wave U11a, P2 (docs/doperpowers/plans/2026-11-12-ux-wave-U11a-settings-connectors-org.md on ux-wave/U11a, "P2" and
// §C "<place>"): where engine 2.1.322 records a connector switched off over the control protocol, and whether a NEW
// session in another folder of the same repository starts with it off. Run as
//   ./vm-run.sh --prefix <p> run run-pass3.mjs uxwave-u11-connector-place
// Folders, all under vm-run.sh's scratch root: the scratch repository (PROBE_WORK, "root"), one linked worktree of it
// (`git worktree add`, "worktree", beside it), a second linked worktree inside the repository where MAWS and the
// owner's sessions put theirs (`<root>/.claude/worktrees/<name>`, "nested"), and a subfolder of the repository ("sub"). Two invented stdio servers
// that sessions in every folder load: `p3u-user` (user scope, top-level `mcpServers` of the scratch .claude.json) and
// `p3u-project` (the repository's committed .mcp.json, so the worktree's checkout has it too; approved through
// `enableAllProjectMcpServers` in the user settings file). Every session is MAWS's launch (uxwave-common-arrivals.mjs
// mawsLaunch: its flags, setting sources user,project,local, its environment and initialize, which accepts trust for
// the session's folder); no prompt is sent, so no model is called.
// Per origin folder O (the scratch .claude.json restored to its baseline before each): a session in O waits for both
// servers to settle (mcp_status), sends `mcp_toggle {serverName, enabled: false}` for each as src/engine-host/ipc.ts
// sends it, reads mcp_status again, ends; the `projects` keys of .claude.json are read. Then one new session in each
// of root, worktree, nested and sub (O included, as the control) reads mcp_status at start. A second run
// (UXW_TAG=u11-connector-place-plain UXW_ORIGINS=plain,plainsub UXW_FOLDERS=root,sub,plain,plainsub) does the same for
// a folder in no repository ("plain", under the scratch root) and its subfolder ("plainsub"); only p3u-user loads there. Written: the journals
// fixtures/uxwave/<tag>-<origin>-<step>.jsonl and the record fixtures/uxwave/<tag>.ndjson (one case per line).
import {mawsLaunch,delay,BIN,ENGINE_VERSION,FIXTURES} from './uxwave-common-arrivals.mjs';
import {redact} from '../../harness.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {join} from 'node:path';

const TAG=process.env.UXW_TAG||'u11-connector-place';
const ROOT=process.env.PROBE_ROOT, HOME=process.env.HOME, REPO=process.env.PROBE_WORK;
const WT=join(ROOT,'worktree'), NEST=join(REPO,'.claude/worktrees/p3u-nested'), SUB=join(REPO,'sub'), GLOBAL=join(HOME,'.claude.json'), BASE=join(ROOT,'claude.json.baseline');
const PLAIN=join(ROOT,'plain'), PLAINSUB=join(PLAIN,'sub');
const ALL={root:REPO,worktree:WT,nested:NEST,sub:SUB,plain:PLAIN,plainsub:PLAINSUB};
const FOLDERS=Object.fromEntries((process.env.UXW_FOLDERS||'root,worktree,nested,sub').split(',').map(k=>[k,ALL[k]]));
const ORIGINS=(process.env.UXW_ORIGINS||'root,worktree,nested,sub').split(',');
const SERVERS=['p3u-user','p3u-project'];
const git=(...a)=>execFileSync('git',['-c','user.name=Probe','-c','user.email=probe@localhost',...a],{cwd:REPO,encoding:'utf8'});
const anon=s=>typeof s==='string'?s.split(WT).join('<worktree>').split(NEST).join('<root>/.claude/worktrees/p3u-nested').split(SUB).join('<root>/sub').split(PLAIN).join('<scratch>/plain').split(REPO).join('<root>').split(ROOT).join('<scratch>'):s;
const projects=()=>{const d=JSON.parse(readFileSync(GLOBAL,'utf8'));return Object.fromEntries(Object.entries(d.projects??{}).map(([k,v])=>[anon(k),{keys:Object.keys(v).sort(),disabledMcpServers:v.disabledMcpServers,enabledMcpServers:v.enabledMcpServers,disabledMcpjsonServers:v.disabledMcpjsonServers}]));};
const SERVER_JS=`import {createInterface} from 'node:readline';
const out=m=>process.stdout.write(JSON.stringify(m)+'\\n');
createInterface({input:process.stdin}).on('line',l=>{let m;try{m=JSON.parse(l);}catch{return;}
 if(m.method==='initialize')out({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params?.protocolVersion??'2025-06-18',capabilities:{tools:{}},serverInfo:{name:process.argv[2],version:'0.0.1'}}});
 else if(m.method==='tools/list')out({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'ping',description:'Answers pong.',inputSchema:{type:'object',properties:{}}}]}});
 else if(m.method==='tools/call')out({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'pong'}]}});
 else if(m.id!==undefined)out({jsonrpc:'2.0',id:m.id,result:{}});});
`;

function setup(){
 const server=join(ROOT,'p3u-mcp.mjs');writeFileSync(server,SERVER_JS);
 mkdirSync(SUB,{recursive:true});mkdirSync(PLAINSUB,{recursive:true});writeFileSync(join(SUB,'note.txt'),'sub\n');
 writeFileSync(join(REPO,'.mcp.json'),JSON.stringify({mcpServers:{'p3u-project':{type:'stdio',command:'node',args:[server,'p3u-project']}}},null,2)+'\n');
 git('add','.');git('commit','-qm','mcp and sub');
 git('worktree','add','-q','-b','p3u-wt',WT);
 git('worktree','add','-q','-b','p3u-nested',NEST);
 const d=JSON.parse(readFileSync(GLOBAL,'utf8'));
 d.mcpServers={'p3u-user':{type:'stdio',command:'node',args:[server,'p3u-user']}};
 writeFileSync(GLOBAL,JSON.stringify(d));
 const settings=join(HOME,'.claude/settings.json');
 writeFileSync(settings,JSON.stringify({...JSON.parse(readFileSync(settings,'utf8')),enableAllProjectMcpServers:true},null,2)+'\n');
 copyFileSync(GLOBAL,BASE);
}

const statusOf=r=>Object.fromEntries((r?.response?.mcpServers??[]).filter(s=>SERVERS.includes(s.name)).map(s=>[s.name,{status:s.status,scope:s.scope}]));
async function settled(p,bound=45000){
 const until=Date.now()+bound;let last;
 for(;;){last=await p.request('mcp_status',{},15000).catch(e=>({error:e.message}));
  const s=statusOf(last);if(s['p3u-user']&&SERVERS.every(n=>!s[n]||s[n].status!=='pending')||Date.now()>until)return {seq:p.seq,servers:s};
  await delay(1500);}
}

const record=[];
const keep=row=>{record.push(row);console.log(JSON.stringify(row));};

async function originCase(origin){
 copyFileSync(BASE,GLOBAL);
 const step=TAG+'-'+origin+'-toggle';
 const row={case:origin+'-toggle',origin,cwd:anon(ALL[origin]),fixture:'fixtures/uxwave/'+step+'.jsonl',projectsBefore:projects()};
 await mawsLaunch(step,{cwd:ALL[origin],provenance:{probe:'U11a P2',case:row.case}},async p=>{
  row.atStart=await settled(p);
  row.toggles=[];
  for(const n of SERVERS){const r=await p.request('mcp_toggle',{serverName:n,enabled:false},30000).catch(e=>({error:e.message}));row.toggles.push({server:n,seq:p.seq,subtype:r.subtype??null,error:r.error??null});}
  await delay(1500);
  const after=await p.request('mcp_status',{},15000).catch(e=>({error:e.message}));row.afterToggle={seq:p.seq,servers:statusOf(after)};
  row.projectsAfterToggle=projects();
 });
 await delay(1000);row.projectsAfterEnd=projects();keep(row);
 for(const [name,cwd] of Object.entries(FOLDERS)){
  const s=TAG+'-'+origin+'-then-'+name;
  const r={case:origin+'-then-'+name,origin,folder:name,cwd:anon(cwd),fixture:'fixtures/uxwave/'+s+'.jsonl'};
  await mawsLaunch(s,{cwd,provenance:{probe:'U11a P2',case:r.case}},async p=>{r.atStart=await settled(p);});
  await delay(500);r.projectsAfter=projects();keep(r);
 }
}

export default async()=>{
 if(!HOME?.startsWith('/tmp/'))throw new Error('HOME is not a scratch folder');
 mkdirSync(FIXTURES,{recursive:true});
 setup();
 keep({case:'setup',engine:ENGINE_VERSION,bin:anon(BIN),origins:ORIGINS,folders:Object.fromEntries(Object.entries(FOLDERS).map(([k,v])=>[k,anon(v)])),worktreeList:anon(git('worktree','list','--porcelain')),gitCommonDir:{worktree:anon(execFileSync('git',['rev-parse','--path-format=absolute','--git-common-dir'],{cwd:WT,encoding:'utf8'}).trim()),nested:anon(execFileSync('git',['rev-parse','--path-format=absolute','--git-common-dir'],{cwd:NEST,encoding:'utf8'}).trim())},projectsBaseline:projects()});
 try{for(const o of ORIGINS)await originCase(o);}
 finally{writeFileSync(FIXTURES+TAG+'.ndjson',redact(record.map(r=>JSON.stringify(r)).join('\n'))+'\n');console.log(TAG,FIXTURES+TAG+'.ndjson');}
};
