// C3/C8c/C11: get_workspace_diff against a dirty repository, so perFileStats and hunks carry real items.
// The request schema is {subtype} only (no documented parameters); the variants are repository states (default branch, feature branch dirty and clean) plus one call with undocumented keys.
import {run} from '../pass2/common.mjs';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,realpathSync} from 'node:fs';
import {randomBytes} from 'node:crypto';

const git=(cwd,...args)=>execFileSync('git',['-C',cwd,'-c','user.name=Probe','-c','user.email=probe@localhost',...args],{encoding:'utf8'});
const lines=(prefix,n)=>Array.from({length:n},(_,i)=>`${prefix} line ${i+1}`).join('\n')+'\n';
const type=v=>v===null?'null':Array.isArray(v)?'array':typeof v;
const keysTypes=o=>o&&typeof o==='object'?Object.fromEntries(Object.entries(o).map(([k,v])=>[k,type(v)])):type(o);
const shape=r=>Object.fromEntries(Object.entries(r||{}).map(([k,v])=>[k,v===null?'null':Array.isArray(v)?{array:true,itemKeys:v[0]&&typeof v[0]==='object'?Object.keys(v[0]):typeof v[0]}:typeof v==='object'?Object.keys(v):typeof v]));

// Binary content is forced with NUL bytes (git's binary test); pure random bytes can pass as text.
const binary=n=>Buffer.concat([Buffer.from([0,0,0,0]),randomBytes(n-4)]);
function build(){
 const A=realpathSync(mkdtempSync('/tmp/maws-probe3-'));
 git(A,'init','-q','-b','main');
 writeFileSync(A+'/alpha.txt',lines('alpha',30));writeFileSync(A+'/beta.txt',lines('beta',10));writeFileSync(A+'/gamma.md','# Gamma\n\nFirst draft.\n');
 git(A,'add','-A');git(A,'commit','-qm','seed');
 writeFileSync(A+'/gamma.md','# Gamma\n\nSecond draft.\n');writeFileSync(A+'/pixel.bin',binary(256));
 git(A,'add','-A');git(A,'commit','-qm','second');
 // Dirty: two hunks in alpha.txt (unstaged), a staged edit to beta.txt, a modified tracked binary, and untracked text and binary files created before the session.
 const alpha=readFileSync(A+'/alpha.txt','utf8').split('\n');alpha[2]='alpha line 3 CHANGED';alpha[3]='alpha line 4 CHANGED';alpha.splice(25,1,'alpha line 26 CHANGED','alpha line 26b ADDED');alpha.splice(28,1);
 writeFileSync(A+'/alpha.txt',alpha.join('\n'));
 writeFileSync(A+'/beta.txt',lines('beta',10).replace('beta line 5\n','beta line 5 STAGED\n'));git(A,'add','beta.txt');
 writeFileSync(A+'/pixel.bin',binary(256));
 writeFileSync(A+'/early.txt','untracked before session\n');writeFileSync(A+'/early.bin',binary(300));
 return A;
}
const state=A=>({branch:git(A,'rev-parse','--abbrev-ref','HEAD').trim(),head:git(A,'rev-parse','HEAD').trim(),status:git(A,'status','--porcelain=v1','--untracked-files=all').split('\n').filter(Boolean)});
const opts=cwd=>({cwd,dir:'fixtures/pass3/',settingSources:'project,local',model:'haiku',flags:['--max-budget-usd','0.05']});
const asker=(p,A)=>async(variant,payload={})=>{
 p.note({event:'variant_state',variant,payload,...state(A)});
 try{
  const r=await p.request('get_workspace_diff',payload);const d=r.response?.diff;
  p.note({event:'response_shape',subtype:'get_workspace_diff',variant,status:r.subtype,error:r.error,shape:shape(r.response),diffShape:d?shape(d):type(d)});
  if(d)p.note({event:'item_shapes',variant,source:d.source,stats:d.stats,skippedLarge:d.skippedLarge,restricted:d.restricted,
   perFileStats:(d.perFileStats||[]).map(keysTypes),perFileStatKeys:d.perFileStats?.[0]?Object.keys(d.perFileStats[0]):null,
   hunksPaths:(d.hunks||[]).map(h=>h.path),hunkEntryKeys:d.hunks?.[0]?Object.keys(d.hunks[0]):null,
   firstHunkKeys:d.hunks?.[0]?.hunks?.[0]?Object.keys(d.hunks[0].hunks[0]):null,firstHunkTypes:keysTypes(d.hunks?.[0]?.hunks?.[0]??null),firstHunkLineTypes:[...new Set((d.hunks?.[0]?.hunks?.[0]?.lines||[]).map(type))]});
 }catch(e){p.note({event:'read_error',subtype:'get_workspace_diff',variant,error:e.message});}
};
const initialize=async p=>{const r=await p.init();if(r.subtype!=='success')throw new Error('initialize returned '+JSON.stringify(r));};

export default async()=>{
 const A=build();
 // Launch 1: HEAD on the default branch, so the source is expected to be the working tree.
 await run('workspace-diff-dirty',async p=>{
  const ask=asker(p,A);
  p.note({event:'repo_built',cwd:A,log:git(A,'log','--oneline').trim().split('\n'),numstatHead:git(A,'diff','--numstat','HEAD').trim().split('\n'),cachedNumstat:git(A,'diff','--cached','--numstat').trim().split('\n')});
  await initialize(p);
  // Untracked files created after the engine started (the collector drops untracked files whose mtime and ctime predate the session).
  mkdirSync(A+'/notes');writeFileSync(A+'/notes/late.txt','untracked one\nuntracked two\n');writeFileSync(A+'/late.bin',binary(300));
  await ask('default-main-dirty');
  await ask('undocumented-keys-main-dirty',{base:'HEAD~1',scope:'staged',staged:true,mode:'branch'});
  // Move HEAD to a feature branch one commit beyond main while the engine runs; the dirty tree rides along (commit --only leaves beta.txt staged).
  git(A,'checkout','-q','-b','feature');writeFileSync(A+'/feature.txt',lines('feature',4));git(A,'add','feature.txt');git(A,'commit','-qm','feature work','--only','feature.txt');
  await ask('feature-after-mid-session-checkout');
 },opts(A));
 // Launch 2: a fresh engine started with HEAD already on the feature branch.
 await run('workspace-diff-branch',async p=>{
  const ask=asker(p,A);
  await initialize(p);
  await ask('default-feature-dirty');
  git(A,'stash','push','-q','--include-untracked');
  await ask('default-feature-clean');
  git(A,'stash','pop','-q','--index');
  p.note({event:'variant_state',variant:'final',...state(A)});
 },opts(A));
};
