// W14 no-model probe: run after a harness build; all CLI writes go to fresh scratch homes.
const R=require('node:path').resolve(__dirname, '../../../..');
const {_electron}=require(R+'/node_modules/@playwright/test');
const fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process');
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'w14-maws-live-')));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const table=()=>cp.execFileSync('/bin/ps',['-axo','pid=,ppid=,pgid=,tpgid=,stat=,comm='],{encoding:'utf8'}).trim().split('\n').map(l=>{const [pid,ppid,pgid,fg,state,...command]=l.trim().split(/\s+/);return {pid:+pid,ppid:+ppid,pgid:+pgid,fg:+fg,state,command:command.join(' ')};});
async function until(fn,ms=12000){const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await pause(100);}throw Error('condition timed out');}
(async()=>{
 const env={...process.env,MAWS_E2E:'1',MAWS_HARNESS:'1',MAWS_SESSION_SOURCE:'stub:test/fixtures/panel/harness-sessions.json',MAWS_USER_DATA:root+'/profile',CLAUDE_CONFIG_DIR:root+'/store',MAWS_CLAUDE_USAGE_DIR:root+'/no-usage',ZDOTDIR:root,HISTFILE:root+'/history',DISABLE_AUTOUPDATER:'1'};
 delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;fs.mkdirSync(env.CLAUDE_CONFIG_DIR);
 const app=await _electron.launch({args:[R+'/out/main/index.js'],cwd:R,env});let live=[];const results=[];
 try{
 const page=await app.firstWindow();
 const invoke=async(name,input)=>{const r=await page.evaluate(([n,i])=>window.maws.invoke(n,i),[name,input]);if(!r.ok)throw Error(r.error.message);return r.value;};
 for(const mode of ['kill','cont-term','rollback-fg']){
  const home=root+'/'+mode;fs.mkdirSync(home);fs.writeFileSync(home+'/.claude.json',JSON.stringify({hasCompletedOnboarding:true,theme:'light',projects:{[home]:{hasTrustDialogAccepted:true,hasCompletedProjectOnboarding:true}}}));
  const pane=await invoke('pty.spawn',{appSessionId:'A',label:mode,cwd:home,cols:100,rows:30,shell:'/bin/bash',args:['--noprofile','--norc','-i']});
  await until(async()=>!(await invoke('pty.foreground',{ptyId:pane.ptyId})).busy);
  const cmd=['/usr/bin/env','-i','PATH=/usr/bin:/bin:/usr/sbin:/sbin','HOME='+home,'TERM=xterm-256color','CLAUDE_CONFIG_DIR='+home,'DISABLE_AUTOUPDATER=1','CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1','ANTHROPIC_BASE_URL=http://127.0.0.1:9','ANTHROPIC_AUTH_TOKEN=control-only-no-credential','/Users/new/.local/share/claude/versions/2.1.287'].map(quote).join(' ');
  await invoke('pty.write',{ptyId:pane.ptyId,data:cmd+'\n'});
  const cli=await until(()=>table().find(p=>p.ppid===pane.pid&&p.command.includes('/versions/2.1.287')));live.push(cli.pid);
  await pause(7000);
  await invoke('pty.write',{ptyId:pane.ptyId,data:'\x1a'});
  const stopped=await until(()=>table().find(p=>p.pid===cli.pid&&p.state.includes('T')));
  await until(async()=>!(await invoke('pty.foreground',{ptyId:pane.ptyId})).busy);
  const result={mode,pane,cli:cli.pid,stopped};
  if(mode==='kill')process.kill(cli.pid,'SIGKILL');
  else{process.kill(cli.pid,'SIGCONT');if(mode==='cont-term')process.kill(cli.pid,'SIGTERM');}
  await pause(1200);result.afterSignal=table().find(p=>p.pid===cli.pid)||null;
  if(mode==='rollback-fg'){
   await invoke('pty.write',{ptyId:pane.ptyId,data:'\x15fg\n'});
   result.afterFg=await until(()=>table().find(p=>p.pid===cli.pid&&!p.state.includes('T')&&p.fg===p.pgid));
   await invoke('pty.write',{ptyId:pane.ptyId,data:'\x1a'});await until(()=>table().find(p=>p.pid===cli.pid&&p.state.includes('T')));
  }
  if(table().some(p=>p.pid===cli.pid))process.kill(cli.pid,'SIGKILL');
  await until(()=>!table().some(p=>p.pid===cli.pid));live=live.filter(p=>p!==cli.pid);
  const proof=home+'/shell-proof';await invoke('pty.write',{ptyId:pane.ptyId,data:`printf 'usable\\n' > ${quote(proof)}; stty -a >> ${quote(proof)}\n`});
  await until(()=>fs.existsSync(proof)&&fs.readFileSync(proof,'utf8').includes('lflags:'));
  result.shellProof=fs.readFileSync(proof,'utf8');
  const attached=await invoke('pty.attach',{ptyId:pane.ptyId});fs.writeFileSync(home+'/pty.bin',Buffer.from(Object.values(attached.replay)));
  await invoke('pty.kill',{ptyId:pane.ptyId});results.push(result);console.log(JSON.stringify(result));
 }
 fs.writeFileSync(root+'/evidence.json',JSON.stringify({binary:'/Users/new/.local/share/claude/versions/2.1.287',scratch:root,results},null,2));console.log('EVIDENCE '+root+'/evidence.json');
 }finally{for(const pid of live){try{process.kill(pid,'SIGKILL')}catch{}}await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
