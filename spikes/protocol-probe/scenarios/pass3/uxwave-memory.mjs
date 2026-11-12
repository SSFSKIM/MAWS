// UX wave, U2 check 2 "the memory recall" (#351): one system/memory_recall frame and the transcript row beside it.
// The engine's recall (cli.pretty.js, QOi near :462279) runs only when auto memory is on (Ih) and either the gate
// tengu_moth_copse or CLAUDE_MEMORY_STORES is set (Rwe), or account recall is on. The owner's user settings turn auto
// memory off and the owner's feature cache holds the gate false, so three cases, each one launch as MAWS's with one turn
// whose prompt the memory answers:
//   owner      the owner's settings and cache as they are (auto memory off, gate off)
//   memory-on  auto memory on, gate as cached (off)
//   provoked   auto memory on, gate on in this scratch home's cache copy (the only change to the owner's cache)
//   stores     auto memory on, gate off, CLAUDE_MEMORY_STORES='[]' (Rwe's other arm)
//   fc         auto memory on, the gate on through CLAUDE_INTERNAL_FC_OVERRIDES (did not reach the gate: no recall ran)
// The memories are of type `reference`: the selector's instructions tell it to be conservative with [user] and [project]
// memories, and with type `user` it selected none in seven launches.
// Each launch writes an engine debug log; its memory lines are copied into the fixture (`debug_lines`).
// The memory folder is written where the engine reads it (the init frame's memory_paths.auto, checked after the turn).
import {mawsLaunch,transcriptFiles,rows,WORK,join,writeFileSync,mkdirSync,readFileSync} from './uxwave-common.mjs';
import {homedir} from 'node:os';
import {existsSync} from 'node:fs';
const CASES=(process.env.PZ_CASES||'owner,memory-on,provoked,provoked').split(',');
const DEBUG_RE=/memdir|memory_recall|relevant_memor|memory-watcher|moth_copse|selectRelevant|memory_scan|memory/i;
// The recall's selector runs beside the turn and its result joins at the turn's next model request, so the prompt asks
// for one tool call first: a turn answered with no call never reaches that point (seen 2026-11-12, uxwave-memory trials).
const PROMPT='First run `date` in Bash. Then tell me in one sentence: on which days of the week do I water the tomatoes in my greenhouse?';
const FILES={
 'MEMORY.md':'- [Greenhouse watering](greenhouse_watering.md) — when the tomatoes in the greenhouse are watered\n- [Bicycle](bicycle.md) — the bicycle\'s tyre pressure\n',
 'greenhouse_watering.md':'---\nname: Greenhouse watering\ndescription: Which days and at what time the user waters the tomato plants in their greenhouse\ntype: reference\n---\n\nThe tomatoes in the greenhouse are watered on Tuesdays and Fridays at seven in the morning.\n',
 'bicycle.md':'---\nname: Bicycle\ndescription: The tyre pressure the user keeps on their bicycle\ntype: reference\n---\n\nFront tyre 4.5 bar, rear 5 bar.\n',
};
const slug=p=>p.replace(/[^a-zA-Z0-9]/g,'-');
function setGate(on){const f=homedir()+'/.claude.json';const d=JSON.parse(readFileSync(f,'utf8'));d.cachedGrowthBookFeatures={...d.cachedGrowthBookFeatures,tengu_moth_copse:on};writeFileSync(f,JSON.stringify(d));}
export default async()=>{let k=0;for(const c of CASES){k++;
 const dir=join(homedir(),'.claude/projects',slug(WORK),'memory');mkdirSync(dir,{recursive:true});for(const [n,t] of Object.entries(FILES))writeFileSync(join(dir,n),t);
 setGate(c==='provoked');
 const debug=`${process.env.PROBE_ROOT}/debug-memory-${k}.log`;
 await mawsLaunch(`uxwave-memory-${c}-${k}`,{model:'haiku',userSettings:{autoMemoryEnabled:c!=='owner'},flags:['--debug-file',debug],env:c==='stores'?{CLAUDE_MEMORY_STORES:'[]'}:c==='fc'?{CLAUDE_INTERNAL_FC_OVERRIDES:JSON.stringify({tengu_moth_copse:true})}:{}},async p=>{
  p.note({event:'memory_case',case:c,gate:c==='provoked',autoMemoryEnabled:c!=='owner',memoryDir:dir,files:Object.keys(FILES)});
  const from=p.seq;const r=await p.turn(PROMPT);
  const init=p.frames.find(x=>x.frame.type==='system'&&x.frame.subtype==='init')?.frame;
  const recall=p.frames.filter(x=>x.seq>from&&x.frame.type==='system'&&x.frame.subtype==='memory_recall').map(x=>({seq:x.seq,frame:x.frame}));
  const file=transcriptFiles(p.sessionId)[0];const all=file?rows(file):[];
  const att=all.map((r,i)=>({i,r})).filter(({r})=>r.type==='attachment'&&/memor/.test(r.attachment?.type||'')).map(({i,r})=>({row:i,uuid:r.uuid,parentUuid:r.parentUuid,attachment:{type:r.attachment.type,keys:Object.keys(r.attachment),memories:(r.attachment.memories||[]).map(m=>({keys:Object.keys(m),path:m.path,contentChars:m.content?.length}))}}));
  const rec={case:c,initMemoryPaths:init?.memory_paths,initMemory:init?.memory,memoryDirMatches:init?.memory_paths?.auto?.replace(/\/$/,'')===dir,recall,attachmentRows:att,rowTypes:all.map(r=>r.type+(r.attachment?':'+r.attachment.type:'')),answer:String(r.result).slice(0,200)};
  p.note({event:'memory_record',...rec});
  const lines=existsSync(debug)?readFileSync(debug,'utf8').split('\n').filter(l=>DEBUG_RE.test(l)).map(l=>l.slice(0,300)):null;p.note({event:'debug_lines',count:lines?.length??null,lines:lines?.slice(0,60)??null});
  console.log(JSON.stringify({case:c,k,memoryPaths:init?.memory_paths,dirOk:rec.memoryDirMatches,recall:recall.map(x=>x.seq),att:att.map(a=>[a.row,a.attachment.type,a.attachment.memories.length]),answer:rec.answer.slice(0,90)}));
 });
}};
