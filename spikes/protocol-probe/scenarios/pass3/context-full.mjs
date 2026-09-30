// Debt wave 4 (docs/tech-debt-tracker.md, the C3 row "The status line's `ctx` will read about 15 % all session"; C3
// execution document docs/doperpowers/plans/2026-09-28-c3-engine-host.md): a longer conversation than
// pass3/context-sample, each turn growing the context by one ~10k-token file read, with a `get_context_usage` read at
// `detail: 'summary'` (the one C3's session issues at each turn's end) and one at `detail: 'full'` after every turn.
// The notes set each read's total beside its `Messages` category, its non-deferred category sum and its `apiUsage`
// input-side total (input + cache creation + cache read of the last response), so the fixture settles which figure
// follows the conversation.
import {scratch} from '../../harness.mjs';
import {launch,initPayload,success,check,endAsStop,answer,RELAY_ENV} from './c10-common.mjs';
import {mkdirSync,writeFileSync,realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

const PROVENANCE={child:'C3',document:'docs/doperpowers/plans/2026-09-28-c3-engine-host.md',pin:'99a406c43c23863383d94b4e0aa98e30d1566b54',milestone:'debt wave 4',row:"The status line's ctx reads about 15 % all session"};
const FILES=4;

// ~40 kB of numbered lines per file (about 10k tokens), each file distinct so no read is deduplicated.
const body=n=>Array.from({length:800},(_,i)=>`file ${n} line ${String(i+1).padStart(4,'0')}: the quick brown fox jumps over the lazy dog ${(i*7919+n)%100003}`).join('\n')+`\nLAST-${n}\n`;

const figures=usage=>{
 const categories=usage.categories??[];
 const nonDeferred=categories.filter(c=>c.kind!=='deferred'&&c.kind!=='free'&&c.kind!=='buffer').reduce((a,c)=>a+c.tokens,0);
 const api=usage.apiUsage??null;
 const apiTotal=api?api.input_tokens+api.cache_creation_input_tokens+api.cache_read_input_tokens:null;
 const mb=usage.messageBreakdown??null;
 const breakdownTotal=mb?mb.toolCallTokens+mb.toolResultTokens+mb.attachmentTokens+mb.assistantMessageTokens+mb.userMessageTokens+mb.redirectedContextTokens+mb.unattributedTokens:null;
 return {totalTokens:usage.totalTokens,percentage:usage.percentage,maxTokens:usage.maxTokens,autoCompactThreshold:usage.autoCompactThreshold??null,isAutoCompactEnabled:usage.isAutoCompactEnabled,
  messagesCategory:categories.find(c=>c.name==='Messages')?.tokens??null,nonDeferredCategorySum:nonDeferred,categories:categories.map(c=>[c.name,c.kind,c.tokens]),apiUsage:api,apiTotal,messageBreakdownTotal:breakdownTotal};
};

export default async()=>{
 const base=`/private/tmp/maws-w4a-${Math.floor(Date.now()/1000)}`;
 const configHome=`${base}/config`;mkdirSync(configHome,{recursive:true});writeFileSync(`${configHome}/settings.json`,'{}\n');
 const repo=realpathSync(scratch(`${base}-repo-`));
 for(let n=1;n<=FILES;n++)writeFileSync(`${repo}/big${n}.txt`,body(n));
 execFileSync('git',['add','.'],{cwd:repo});execFileSync('git',['-c','user.name=Probe','-c','user.email=probe@localhost','commit','-qm','files'],{cwd:repo});
 const rows=[];
 const {p}=await launch('context-full',{cwd:repo,env:{CLAUDE_CONFIG_DIR:configHome,...RELAY_ENV},flags:['--max-budget-usd','1.00','--allowedTools','Read'],provenance:PROVENANCE},async p=>{
  success(await p.init(initPayload()),'initialize');
  const prompts=['Reply with exactly OK',...Array.from({length:FILES},(_,i)=>`Use the Read tool to read big${i+1}.txt in full (no offset or limit) and reply with only its final line.`)];
  for(const [turn,prompt] of prompts.entries()){
   const result=await p.turn(prompt);
   const summary=figures(success(await p.request('get_context_usage',{detail:'summary'}),'get_context_usage summary'));
   let full;try{full=figures(success(await p.request('get_context_usage',{detail:'full'},90000),'get_context_usage full'));}catch(e){full={error:e.message};}
   const row={turn,answer:answer(p),resultUsage:result.usage,summary,full};rows.push(row);
   p.note({event:'context_read',...row});
  }
  check(p,'every summary read carries the figures',rows.every(r=>typeof r.summary.totalTokens==='number'&&r.summary.apiTotal!==null),rows.map(r=>r.summary.totalTokens));
  p.note({event:'totals',summary:rows.map(r=>r.summary.totalTokens),full:rows.map(r=>r.full.totalTokens??null),apiTotal:rows.map(r=>r.summary.apiTotal),messagesSummary:rows.map(r=>r.summary.messagesCategory),messagesFull:rows.map(r=>r.full.messagesCategory??null),nonDeferredSummary:rows.map(r=>r.summary.nonDeferredCategorySum),nonDeferredFull:rows.map(r=>r.full.nonDeferredCategorySum??null)});
  await endAsStop(p);
 });
 console.log('context-full recorded',p.file,JSON.stringify(rows.map(r=>({turn:r.turn,summary:r.summary.totalTokens,full:r.full.totalTokens,api:r.summary.apiTotal,msgS:r.summary.messagesCategory,msgF:r.full.messagesCategory}))));
};
