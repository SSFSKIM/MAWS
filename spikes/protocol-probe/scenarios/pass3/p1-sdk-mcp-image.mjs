// E2 M0 (docs/doperpowers/plans/2026-10-06-e2-deliverables.md, M0; parent docs/doperpowers/plans/2026-10-05-p1-extension.md
// §9 E2, G4): does an `image` content block in an SDK MCP tool result reach the model? The probe hosts an in-process MCP
// server named `maws` with one tool, `red_square`, whose tools/call answers a solid-red 64×64 PNG image block followed
// by a text block, and asks the model to name the colour. Recorded: the user frame carrying the tool_result (does it
// hold an image block, and the engine's appended "saved original" text block, SPEC 31 31-mcp-client.md:5142), its size,
// the model's reply, where the engine persisted the original (under the scratch home or elsewhere), and what the
// session JSONL keeps of the result (the disk path E2's transcript rows draw from). One fixture: p1-sdk-mcp-image.
import {launch,scratchRun,removeRun,initPayload,success,check,endAsStop,initFrame,answer,records,transcriptPath,toolResults,toolUses,resultSummary,join,delay} from './p1-common.mjs';
import {readFileSync,writeFileSync,readdirSync,statSync,existsSync,realpathSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';

// A solid-red (#ff0000) 64×64 RGB PNG, 132 bytes, generated once with zlib (M2's live case answers the capture with
// the same bytes, copied, since importing this module runs the engine's --version).
const RED_SQUARE_PNG='iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAS0lEQVR42u3PQQkAAAgAsetfWiP4FgYrsKZeS0BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEDgsqnc8OJg6Ln3AAAAAElFTkSuQmCC';
// The document's prompt, with the tool's full name and "yourself": on the first recording Haiku handed the call to a
// background Agent and ended its turn before the call ran (E2 M0 report, decision 1).
const PROMPT='Call the mcp__maws__red_square tool yourself (not through an agent) and tell me in one word what colour the picture is';
const PROVENANCE={charter:'docs/charter.md',child:'E2',spike:'E2',pin:'7094958a1431369ef699ff9875cd7e9259a37695',document:'docs/doperpowers/plans/2026-10-05-p1-extension.md',executionDocument:'docs/doperpowers/plans/2026-10-06-e2-deliverables.md',scenario:'p1-sdk-mcp-image',question:'M0: does an image content block in an SDK MCP tool result reach the model; where does the engine persist the original'};

const isRequest=m=>typeof m==='object'&&m!==null&&'method' in m&&m.id!==undefined&&m.id!==null;
const redSquare={name:'red_square',description:'Return a small picture; without this tool, say you cannot',inputSchema:{type:'object',properties:{},additionalProperties:false},call:()=>({content:[{type:'image',data:RED_SQUARE_PNG,mimeType:'image/png'},{type:'text',text:'the picture'}]})};

// The minimal MCP server of p1-sdk-mcp.mjs, one tool.
function serve(message,calls){
 if(!isRequest(message))return null;
 const {id,method,params}=message;
 switch(method){
  case 'initialize':return {jsonrpc:'2.0',id,result:{protocolVersion:params?.protocolVersion??'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'maws',version:'0.0.1'}}};
  case 'ping':return {jsonrpc:'2.0',id,result:{}};
  case 'tools/list':return {jsonrpc:'2.0',id,result:{tools:[{name:redSquare.name,description:redSquare.description,inputSchema:redSquare.inputSchema}]}};
  case 'tools/call':calls.push({name:params?.name,arguments:params?.arguments??null});
   return params?.name===redSquare.name?{jsonrpc:'2.0',id,result:redSquare.call()}:{jsonrpc:'2.0',id,error:{code:-32602,message:'unknown tool '+params?.name}};
  default:return {jsonrpc:'2.0',id,error:{code:-32601,message:'method not found: '+method}};
 }
}

// Every file under `dir` modified at or after `since` (ms), skipping .git; for the persisted original's whereabouts.
function filesSince(dir,since,depth=8){
 const out=[];
 const walk=(d,n)=>{let entries;try{entries=readdirSync(d,{withFileTypes:true});}catch{return;}
  for(const e of entries){if(e.name==='.git')continue;const p=join(d,e.name);
   if(e.isDirectory()){if(n>0)walk(p,n-1);}
   else{try{const s=statSync(p);if(s.mtimeMs>=since)out.push({path:p,bytes:s.size});}catch{}}}};
 walk(dir,depth);return out;
}
const imageFiles=files=>files.filter(f=>/\.(png|jpe?g|gif|webp)$/i.test(f.path));
const blockTypes=content=>Array.isArray(content)?content.map(b=>b.type):typeof content;

export default async()=>{
 const run=scratchRun('sdk-mcp-image');
 const calls=[];const started=Date.now();
 let fixture;
 try{
  const p=await launch('p1-sdk-mcp-image',run,{provenance:PROVENANCE},async(p,{sessionId})=>{
   p.serve('maws',{handle:message=>serve(message,calls)}); // answered by the harness's handshake (sdk-mcp.mjs)
   // every permission allowed once (no updatedPermissions), the probe server's tool only
   p.on('can_use_tool',r=>{
    p.note({event:'permission_asked',tool:r.tool_name,input:r.input});
    return r.tool_name.startsWith('mcp__maws')?{behavior:'allow',updatedInput:r.input}:{behavior:'deny',message:'Only the probe server is in scope.'};
   });
   success(await p.init({...initPayload(run.cwd),sdkMcpServers:['maws']}),'initialize');
   await p.wait(f=>f.type==='control_request'&&f.request?.subtype==='mcp_message'&&f.request.message?.method==='tools/list',{timeout:30000});
   await delay(500);

   const result=await p.turn(PROMPT);
   const sysInit=initFrame(p);
   check(p,'system/init.tools lists mcp__maws__red_square',!!sysInit?.tools?.includes('mcp__maws__red_square'),sysInit?.tools);
   check(p,'the server received tools/call red_square',calls.some(c=>c.name==='red_square'),calls);

   // The tool_result the engine echoed back as a user frame: what the model saw.
   const use=toolUses(p).find(t=>t.name==='mcp__maws__red_square');
   const echoed=toolResults(p).find(t=>t.tool_use_id===use?.id);
   const frameRow=echoed&&p.frames.find(r=>r.seq===echoed.seq);
   const blocks=Array.isArray(echoed?.content)?echoed.content:[];
   const image=blocks.find(b=>b.type==='image');
   const texts=blocks.filter(b=>b.type==='text').map(b=>b.text);
   const reply=answer(p);
   p.note({event:'tool_result_frame',seq:echoed?.seq??null,toolUseId:use?.id??null,is_error:echoed?.is_error??null,blockTypes:blockTypes(echoed?.content),
    image:image?{sourceType:image.source?.type??null,mediaType:image.source?.media_type??null,base64Length:image.source?.data?.length??null,sameBytesAsSent:image.source?.data===RED_SQUARE_PNG}:null,
    texts,frameBytes:frameRow?Buffer.byteLength(JSON.stringify(frameRow.frame)):null,meta:echoed?.meta??null});
   p.note({event:'model_reply',answer:reply,namesRed:/\bred\b/i.test(reply??''),result:resultSummary(result)});

   // Where the original went: the path the engine's appended text names, and every image file written since launch,
   // under the scratch root, the process temp directory and (read-only listing) the owner's ~/.claude/projects.
   const named=texts.flatMap(t=>t.match(/\/[^\s"'`)\]]+\.(?:png|jpe?g|gif|webp)/gi)??[]);
   const where=path=>{const real=existsSync(path)?realpathSync(path):path;return {path,real,underScratchHome:real.startsWith(run.home+'/'),underScratchRoot:real.startsWith(run.root+'/'),exists:existsSync(path),bytes:existsSync(path)?statSync(path).size:null};};
   p.note({event:'persisted_original',namedPaths:named.map(where),
    scratchImages:imageFiles(filesSince(run.root,started)),tmpdirImages:imageFiles(filesSince(tmpdir(),started,3)),ownerProjectsImages:imageFiles(filesSince(join(homedir(),'.claude','projects'),started,4)),
    scratchSessionFiles:filesSince(join(run.home,'projects'),started).map(f=>({...f,path:f.path.slice(run.home.length)}))});
   await endAsStop(p);

   // What the session JSONL keeps of the call and its result.
   const recs=records(transcriptPath(run,sessionId));
   const contentOf=r=>Array.isArray(r.message?.content)?r.message.content:[];
   const stored=recs.filter(r=>contentOf(r).some(b=>b.type==='tool_result'&&b.tool_use_id===use?.id));
   p.note({event:'jsonl_tool_result',path:transcriptPath(run,sessionId),count:recs.length,records:stored.map(r=>({type:r.type,uuid:r.uuid,toolUseResult:r.toolUseResult??null,mcpMeta:r.mcpMeta??null,blocks:contentOf(r).filter(b=>b.type==='tool_result').map(b=>({is_error:b.is_error??false,blockTypes:blockTypes(b.content),texts:Array.isArray(b.content)?b.content.filter(x=>x.type==='text').map(x=>x.text):b.content,imageBase64Length:Array.isArray(b.content)?b.content.find(x=>x.type==='image')?.source?.data?.length??null:null}))}))});
  });
  fixture=p.file;
 }finally{removeRun(run);}
 // The cost is known only at the end; the provenance row (written first) carries it as E1's fixtures do.
 const rows=readFileSync(fixture,'utf8').trim().split('\n').map(JSON.parse);
 const spend=rows.find(r=>r.frame.event==='spend')?.frame.result?.total_cost_usd;
 for(const row of rows)if(row.frame.event==='provenance')row.frame.costUsd=spend==null?null:spend.toFixed(4);
 writeFileSync(fixture,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
};
