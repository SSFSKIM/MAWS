// E7 M0 step 6, optional (docs/doperpowers/plans/2026-10-06-e7-orchestration.md, Design §5; SPEC 39 §39.2.1, §39.8.1,
// §39.25): with CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 in MAWS's environment, does the Agent tool take a `name`, does a
// named background agent become a teammate the ListAgents listing names under `Teammates`, and what does its sidecar
// meta carry? If the gate refuses (the name stripped, no Teammates section), that is the finding: teammate grouping
// ships tested on hand-built listings and unverified live (Decision Log 7).
import {launch,scratchRun,removeRun,initPayload,success,endAsStop,initFrame,join,existsSync,slug} from './p1-common.mjs';
import {E7,E7_DEBUG,allowAll,pairsAfter,resultsAfter,framesBetween,idle,cost,snapshotDir} from './e7-common.mjs';

const PROMPT='Spawn a general-purpose Agent named "scout" in the background, model haiku: read one.txt and reply. Then call ListAgents (find it with ToolSearch) and reply with the listing.';
const LIST='Call ListAgents again and reply with the listing verbatim.';

export default async()=>{
 const run=scratchRun('e7-team');
 try{
  await launch('e7-team',run,{vars:{CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS:'1'},spendCap:'0.80',debugPattern:E7_DEBUG,provenance:{...E7,question:'Design §5: a named agent under the experimental teams gate, the Teammates section, the sidecar meta'}},async(p,{sessionId})=>{
   allowAll(p);
   success(await p.init(initPayload(run.cwd)),'initialize');
   let from=p.seq;await p.turn(PROMPT);
   const init=initFrame(p);
   const agents=[...pairsAfter(p,from,'Agent'),...pairsAfter(p,from,'Task')];
   p.note({event:'e7_team_spawn',tools:init?.tools??null,agents,listings:pairsAfter(p,from,'ListAgents'),results:resultsAfter(p,from),nameOnWire:agents.some(a=>a.use.input?.name==='scout'),frames:framesBetween(p,from)});
   // let the background agent finish (its task_notification), then list again
   await p.wait(f=>f.type==='system'&&f.subtype==='task_notification',{after:from,timeout:150000}).catch(()=>null);
   await idle(p,150000,4000);
   from=p.seq;await p.turn(LIST);
   p.note({event:'e7_team_listing',listings:pairsAfter(p,from,'ListAgents'),results:resultsAfter(p,from)});
   await idle(p,60000,3000);
   const dir=join(run.home,'projects',slug(run.cwd),sessionId);
   const files=snapshotDir(join(dir,'subagents'));
   p.note({event:'e7_team_disk',teamsDir:existsSync(join(run.home,'teams'))?snapshotDir(join(run.home,'teams')):null,sidecarMeta:Object.fromEntries(Object.entries(files).filter(([k])=>k.endsWith('.meta.json')).map(([k,v])=>[k,v.content])),sidecarFiles:Object.keys(files)});
   p.note({event:'e7_spend',total_cost_usd:cost(p)});
   await endAsStop(p);
  });
 }finally{removeRun(run);}
};
