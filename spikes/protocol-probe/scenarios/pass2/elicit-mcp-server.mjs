// Minimal stdio MCP server whose one tool asks the client for input through elicitation/create.
import {createInterface} from 'node:readline';
let clientCaps=null,pending=null;const send=m=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...m})+'\n');
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);
 if(m.method==='initialize'){clientCaps=m.params?.capabilities;return send({id:m.id,result:{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'maws-elicit',version:'0.0.1'}}});}
 if(m.method==='tools/list')return send({id:m.id,result:{tools:[{name:'ask_color',description:'Asks the human to pick a color.',inputSchema:{type:'object',properties:{}}}]}});
 if(m.method==='tools/call'){pending=m.id;return send({id:'elicit-1',method:'elicitation/create',params:{message:'MAWS probe: pick a color',requestedSchema:{type:'object',properties:{color:{type:'string',title:'Color'}},required:['color']}}});}
 if(m.id==='elicit-1'&&pending!=null){send({id:pending,result:{content:[{type:'text',text:'ELICITED '+JSON.stringify(m.result??m.error)+' clientCaps '+JSON.stringify(clientCaps)}]}});pending=null;return;}
 if(m.id!=null&&m.method)send({id:m.id,result:{}});
});
