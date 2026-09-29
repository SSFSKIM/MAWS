// Debt wave 3 (docs/tech-debt-tracker.md, the C3 row "Nothing emits context.sample"; C3 execution document
// docs/doperpowers/plans/2026-09-28-c3-engine-host.md): two turns, each followed by the `get_context_usage` read C3's
// session issues at every turn's end, so the replay suites carry the answer the normaliser turns into
// `context.sample`. Notes set the result frame's usage beside the read's figures: the result carries the last
// request's API usage and the model's `contextWindow`, not the engine's own total or its auto-compact threshold.
import {scratch} from '../../harness.mjs';
import {launch,scratchConfigHome,initPayload,success,check,endAsStop,answer,RELAY_ENV} from './c10-common.mjs';
import {realpathSync} from 'node:fs';

const PROVENANCE={child:'C3',document:'docs/doperpowers/plans/2026-09-28-c3-engine-host.md',milestone:'debt wave 3',row:'context.sample has no producer'};

export default async()=>{
 const repo=realpathSync(scratch('/tmp/maws-probe3-context-'));
 const configHome=scratchConfigHome();
 const samples=[];
 const {p}=await launch('context-sample',{cwd:repo,env:{CLAUDE_CONFIG_DIR:configHome,...RELAY_ENV},flags:['--max-budget-usd','0.10'],provenance:PROVENANCE},async p=>{
  success(await p.init(initPayload()),'initialize');
  for(const prompt of ['Reply with exactly OK','Use the Read tool to read one.txt and reply with only the single word it contains.']){
   const result=await p.turn(prompt);
   const usage=success(await p.request('get_context_usage',{detail:'summary'}),'get_context_usage');
   const model=Object.values(result.modelUsage??{})[0]??{};
   const sample={totalTokens:usage.totalTokens,maxTokens:usage.maxTokens,percentage:usage.percentage,autoCompactThreshold:usage.autoCompactThreshold??null,isAutoCompactEnabled:usage.isAutoCompactEnabled,model:usage.model};
   samples.push(sample);
   p.note({event:'context_vs_result',answer:answer(p),sample,resultUsage:result.usage,resultContextWindow:model.contextWindow??null,resultKeys:Object.keys(result).sort()});
  }
  check(p,'each read carries the context figures',samples.every(s=>typeof s.totalTokens==='number'&&typeof s.maxTokens==='number'&&typeof s.percentage==='number'&&typeof s.isAutoCompactEnabled==='boolean'),samples);
  // first run, 2026-09-29: both reads answered totalTokens 30304 with the `Messages` category at 1 while
  // `messageBreakdown` grew (163 then 543 assistant tokens): the engine's total does not follow the conversation here
  p.note({event:'totals',totalTokens:samples.map(s=>s.totalTokens)});
  await endAsStop(p);
 });
 console.log('context-sample recorded',p.file);
};
