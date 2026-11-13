// UX wave U11a, P3 (docs/doperpowers/plans/2026-11-12-ux-wave-U11a-settings-connectors-org.md on ux-wave/U11a, "P3" and
// §D "Skills"): is a skill's name on disk the engine's name for it? "Use in chat" will insert `/<name> ` for a person's
// and a project's skill and `/<plugin>:<name> ` for a plugin's, `<name>` being what MAWS's inventory shows
// (src/engine-host/customization/inventory.ts: the front matter's `name`, else the folder's name) and `<plugin>` the
// installed plugin's key up to its `@`. Run as ./vm-run.sh --prefix <p> run run-pass3.mjs uxwave-u11-skill-names
// Invented skills under vm-run.sh's scratch HOME (config home $HOME/.claude) and its scratch repository, each in two
// variants: "same" (front matter `name` equal to the folder's name) and "dir" (a different front-matter name):
//   person   $HOME/.claude/skills/<folder>/SKILL.md
//   project  <repository>/.claude/skills/<folder>/SKILL.md
//   plugin   a local marketplace `p3u-market` added and its plugin installed with the engine's own CLI, as a person
//            does (`claude plugin marketplace add <dir>`, `claude plugin install p3u-plugin@p3u-market`), and a second
//            plugin whose manifest name differs from its marketplace entry's (`p3u-entry`, manifest `p3u-manifest`).
// Each skill's body asks for one codeword, so a reply holding it shows the body reached the model. The engine's own
// lists: the initialize answer's `commands`, `system/init`'s `skills` and `slash_commands`, get_skills_dialog. Then one
// MAWS launch per form (uxwave-common-arrivals.mjs mawsLaunch; a fresh session, so no earlier expansion is in context),
// whose first and only message is `/<form> now`. It ran when the wire replays the command (`<command-name>`), the
// session's transcript holds the skill's body as a user row (the wire does not carry it) and the result is the codeword. Written: the journals fixtures/uxwave/<tag>-<form>.jsonl and the
// record fixtures/uxwave/<tag>.ndjson; the scratch HOME is kept for the inventory read (uxwave-u11-skill-inventory.test.ts).
import {mawsLaunch,turn,delay,BIN,ENGINE_VERSION,FIXTURES,textOf,rowsOf} from './uxwave-common-arrivals.mjs';
import {redact} from '../../harness.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';

const TAG=process.env.UXW_TAG||'u11-skill-names';
const ROOT=process.env.PROBE_ROOT, HOME=process.env.HOME, REPO=process.env.PROBE_WORK;
const anon=s=>typeof s==='string'?s.split(REPO).join('<repo>').split(HOME).join('<home>').split(ROOT).join('<scratch>'):s;
const SKILLS=[
 {group:'person',variant:'same',base:join(HOME,'.claude/skills'),folder:'p3u-person-same',name:'p3u-person-same',word:'AMBER-PS'},
 {group:'person',variant:'dir',base:join(HOME,'.claude/skills'),folder:'p3u-person-dir',name:'p3u-person-label',word:'BIRCH-PD'},
 {group:'project',variant:'same',base:join(REPO,'.claude/skills'),folder:'p3u-project-same',name:'p3u-project-same',word:'CEDAR-JS'},
 {group:'project',variant:'dir',base:join(REPO,'.claude/skills'),folder:'p3u-project-dir',name:'p3u-project-label',word:'DAHLIA-JD'},
 {group:'plugin',variant:'same',plugin:'p3u-plugin',folder:'p3u-plug-same',name:'p3u-plug-same',word:'EMBER-GS'},
 {group:'plugin',variant:'dir',plugin:'p3u-plugin',folder:'p3u-plug-dir',name:'p3u-plug-label',word:'FERN-GD'},
 {group:'plugin',variant:'manifest-name',plugin:'p3u-entry',manifest:'p3u-manifest',folder:'p3u-mani-skill',name:'p3u-mani-skill',word:'GARNET-GM'},
];
const MARKET=join(ROOT,'p3u-market');
const skillMd=s=>`---\nname: ${s.name}\ndescription: Invented probe skill ${s.folder}; use only when asked by name.\n---\nReply with only the word ${s.word} and nothing else. Do not use any tool.\n`;
const cli=(...a)=>{try{return {ok:true,out:anon(execFileSync(BIN,a,{cwd:REPO,encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe']}).trim())};}catch(e){return {ok:false,out:anon(String(e.stdout??'')+String(e.stderr??'')).trim()};}};

function setup(){
 const put=(f,t)=>{mkdirSync(join(f,'..'),{recursive:true});writeFileSync(f,t);};
 for(const s of SKILLS.filter(s=>s.base))put(join(s.base,s.folder,'SKILL.md'),skillMd(s));
 const plugins=[...new Set(SKILLS.filter(s=>s.plugin).map(s=>s.plugin))];
 put(join(MARKET,'.claude-plugin/marketplace.json'),JSON.stringify({name:'p3u-market',owner:{name:'Probe'},plugins:plugins.map(p=>({name:p,source:'./'+p,description:'Invented probe plugin'}))},null,2)+'\n');
 for(const p of plugins){
  const manifest=SKILLS.find(s=>s.plugin===p).manifest??p;
  put(join(MARKET,p,'.claude-plugin/plugin.json'),JSON.stringify({name:manifest,version:'0.0.1',description:'Invented probe plugin'},null,2)+'\n');
  for(const s of SKILLS.filter(s=>s.plugin===p))put(join(MARKET,p,'skills',s.folder,'SKILL.md'),skillMd(s));
 }
 const steps=[{cmd:'plugin marketplace add',...cli('plugin','marketplace','add',MARKET)}];
 for(const p of plugins)steps.push({cmd:'plugin install '+p+'@p3u-market',...cli('plugin','install',p+'@p3u-market')});
 const installed=join(HOME,'.claude/plugins/installed_plugins.json');
 const inst=existsSync(installed)?JSON.parse(readFileSync(installed,'utf8')):null;
 const settings=JSON.parse(readFileSync(join(HOME,'.claude/settings.json'),'utf8'));
 return {steps,installedKeys:inst?Object.keys(inst.plugins??{}):null,installRows:inst?Object.fromEntries(Object.entries(inst.plugins??{}).map(([k,v])=>[k,v.map(r=>({scope:r.scope,installPath:anon(r.installPath)}))])):null,enabledPlugins:settings.enabledPlugins??null};
}

// The forms sent: the one MAWS would insert (the inventory's name; a plugin's key up to `@`), and where it differs the
// folder's name and, for the manifest variant, the manifest's name.
function forms(){
 const out=[];
 for(const s of SKILLS){
  const pre=s.plugin?s.plugin+':':'';
  out.push({skill:s,form:pre+s.name,kind:'inserted (inventory)'});
  if(s.name!==s.folder)out.push({skill:s,form:pre+s.folder,kind:'folder name'});
  if(s.manifest)out.push({skill:s,form:s.manifest+':'+s.name,kind:'manifest name'});
  if(s.plugin&&s.variant!=='dir')out.push({skill:s,form:s.name,kind:'bare (get_skills_dialog alias)'});
 }
 return out;
}
const mine=n=>typeof n==='string'&&/p3u/.test(n);
const record=[];const keep=row=>{record.push(row);console.log(JSON.stringify(row).slice(0,1500));};

export default async()=>{
 if(!HOME?.startsWith('/tmp/'))throw new Error('HOME is not a scratch folder');
 mkdirSync(FIXTURES,{recursive:true});
 try{
  keep({case:'setup',engine:ENGINE_VERSION,scratchHome:'<home> (kept for the inventory read)',skills:SKILLS.map(s=>({group:s.group,variant:s.variant,folder:s.folder,frontMatterName:s.name,plugin:s.plugin??null,manifest:s.manifest??null,word:s.word})),...setup()});
  // the engine's own lists, once
  await mawsLaunch(TAG+'-lists',{provenance:{probe:'U11a P3',case:'lists'}},async p=>{
   const init=p.frames.find(r=>r.frame.type==='control_response'&&r.frame.response?.response?.commands);
   const commands=(init?.frame.response.response.commands??[]).filter(c=>mine(c.name)).map(c=>({name:c.name,description:c.description,argumentHint:c.argumentHint}));
   const dialog=await p.request('get_skills_dialog',{},20000).catch(e=>({error:e.message}));
   const t=await turn(p,'Without using any tool, reply with only the word OK.',120000);
   const sinit=p.frames.find(r=>r.frame.type==='system'&&r.frame.subtype==='init');
   keep({case:'lists',fixture:'fixtures/uxwave/'+TAG+'-lists.jsonl',initializeCommands:{seq:init?.seq??null,commands},
    getSkillsDialog:{seq:p.seq,subtype:dialog.subtype??null,error:dialog.error??null,mine:JSON.parse(JSON.stringify(dialog.response??null,(k,v)=>v)),},
    systemInit:sinit?{seq:sinit.seq,skills:(sinit.frame.skills??[]).filter(mine),slashCommands:(sinit.frame.slash_commands??[]).filter(mine),plugins:(sinit.frame.plugins??[]).filter(x=>mine(x.name)).map(x=>({name:x.name,path:anon(x.path)}))}:null,
    result:t.result?.subtype??null});
  });
  for(const f of forms()){
   const name=TAG+'-'+f.form.replace(/[^a-z0-9-]/g,'_');
   const row={case:f.form,group:f.skill.group,variant:f.skill.variant,kind:f.kind,sent:'/'+f.form+' now',word:f.skill.word,fixture:'fixtures/uxwave/'+name+'.jsonl'};
   try{
    await mawsLaunch(name,{provenance:{probe:'U11a P3',case:f.form}},async (p,ctx)=>{
     const t=await turn(p,'/'+f.form+' now',150000);
     const after=p.frames.filter(r=>r.seq>t.seq);
     const users=after.filter(r=>r.frame.type==='user'&&r.direction==='in');
     row.commandFrames=users.filter(r=>/<command-name>/.test(textOf(r.frame.message?.content))).map(r=>({seq:r.seq,isReplay:r.frame.isReplay??null,text:textOf(r.frame.message.content).slice(0,300)}));
     row.bodyFrames=users.filter(r=>textOf(r.frame.message?.content).includes('Reply with only the word '+f.skill.word)).map(r=>({seq:r.seq,isSynthetic:r.frame.isSynthetic??null}));
     await delay(1000);
     row.bodyRows=rowsOf(ctx.transcript).filter(({row:r})=>r.type==='user'&&textOf(r.message?.content).includes('Reply with only the word '+f.skill.word)).map(({line,row:r})=>({line,isMeta:r.isMeta??null,sourceToolUseID:r.sourceToolUseID??null}));
     row.synthetic=after.filter(r=>r.frame.type==='assistant'&&r.frame.message?.model==='<synthetic>').map(r=>({seq:r.seq,text:textOf(r.frame.message.content).slice(0,300)}));
     row.replies=after.filter(r=>r.frame.type==='assistant'&&r.frame.message?.model!=='<synthetic>').map(r=>({seq:r.seq,text:textOf(r.frame.message.content).slice(0,200)})).filter(x=>x.text);
     const res=after.find(r=>r.frame===t.result);
     row.result=t.result?{seq:res?.seq??null,subtype:t.result.subtype,text:String(t.result.result??'').slice(0,300)}:null;
     row.ran=row.commandFrames.length>0&&row.bodyRows.length>0&&String(t.result?.result??'').includes(f.skill.word);
    });
   }catch(e){row.error=e.message;}
   keep(row);
  }
 }finally{writeFileSync(FIXTURES+TAG+'.ndjson',redact(record.map(r=>JSON.stringify(r)).join('\n'))+'\n');console.log(TAG,FIXTURES+TAG+'.ndjson','scratch',ROOT);}
};
