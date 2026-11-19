// UX wave U2b, check 1, E4: a reader that reads one file in a loop, as fast as it can, until the file `<out>.stop`
// appears; then writes to <out> what it saw: how many reads, how many found no file, every read that did not parse as
// JSON (its length and its first characters), and every distinct version (by inode and content digest) in the order
// first seen, with whether it parsed, its shape and its number of runs. Usage: node uxwave-u2b-folds-reader.mjs <file> <out>
import {openSync,fstatSync,readFileSync,closeSync,existsSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const [file,out]=process.argv.slice(2);
let reads=0,missing=0;const bad=[];const versions=new Map();const t0=Date.now();
for(let i=0;;i++){
 if(i%200===0&&existsSync(out+'.stop'))break;
 let fd;
 try{fd=openSync(file,'r');}catch{missing++;continue;}
 try{
  const st=fstatSync(fd);const text=readFileSync(fd,'utf8');reads++;
  const sha=createHash('sha256').update(text).digest('hex').slice(0,16);const key=st.ino+':'+sha;
  if(!versions.has(key)){let parsed=null;try{parsed=JSON.parse(text);}catch{}versions.set(key,{ino:st.ino,sha,size:text.length,ms:Date.now()-t0,parses:parsed!==null,shape:parsed?.shape??null,runs:Array.isArray(parsed?.runs)?parsed.runs.length:null,firsts:Array.isArray(parsed?.runs)?parsed.runs.map(r=>r[0]):null,reads:0});}
  const v=versions.get(key);v.reads++;
  if(!v.parses&&bad.length<50)bad.push({size:text.length,head:text.slice(0,40),ms:Date.now()-t0});
 }finally{closeSync(fd);}
}
const list=[...versions.values()];
writeFileSync(out,JSON.stringify({file:file.split('/').pop(),ms:Date.now()-t0,reads,missing,notParsed:list.filter(v=>!v.parses).reduce((a,v)=>a+v.reads,0),badSamples:bad,distinctVersions:list.length,distinctInodes:new Set(list.map(v=>v.ino)).size,versions:list},null,1));
