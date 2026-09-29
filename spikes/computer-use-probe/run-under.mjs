// Runs a child command (argv after --) and relays its stdout, so the child's parent is whichever node runs this file.
import {spawn} from 'node:child_process';
const i=process.argv.indexOf('--');const [cmd,...args]=process.argv.slice(i+1);
const c=spawn(cmd,args,{stdio:['ignore','pipe','inherit']});let out='';c.stdout.on('data',d=>out+=d);c.on('close',code=>{process.stdout.write(out);process.exit(code??0);});
