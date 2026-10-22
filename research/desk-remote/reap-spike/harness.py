import os,sys,json,subprocess,time,shlex,signal,select,termios,fcntl,struct,pty
from pathlib import Path
BASE=Path('/private/tmp/reap-spike')
BIN='/Users/new/.local/share/claude/versions/2.1.308'
class Probe:
 def __init__(self,name,allow=True,network=False):
  self.root=BASE/name;self.home=self.root/'home';self.cfg=self.home/'.claude';self.work=self.root/'work';self.bus=self.root/'bus'
  for d in (self.cfg,self.work,self.bus/'events'):d.mkdir(parents=True)
  owner=json.loads(Path('/Users/new/.claude.json').read_text())
  config={k:owner[k] for k in ('cachedGrowthBookFeatures','cachedGrowthBookFeaturesAt') if k in owner}
  config.update(hasCompletedOnboarding=True,theme='dark',projects={str(self.work):{'hasTrustDialogAccepted':True}})
  (self.cfg/'.claude.json').write_text(json.dumps(config))
  settings={'daemonColdStart':'transient','permissions':{'allow':['Bash','CronCreate','CronDelete','CronList'] if allow else []},'modelSettings':{'claude-haiku-5-5':{'effortLevel':'low'}},'hooks':{e:[{'hooks':[{'type':'command','command':'/usr/bin/python3 -I /private/tmp/reap-spike/hook.py'}]}] for e in ('SessionEnd','UserPromptSubmit','Stop')}}
  (self.cfg/'settings.json').write_text(json.dumps(settings))
  subprocess.run(['git','init','-q',str(self.work)],check=True)
  self.mode(drop=True,classic_drop=True)
  env={k:os.environ[k] for k in ('ANTHROPIC_BASE_URL','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_DEFAULT_HAIKU_MODEL','ANTHROPIC_DEFAULT_SONNET_MODEL','ANTHROPIC_DEFAULT_OPUS_MODEL','CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY','LANG','USER','LOGNAME','TMPDIR') if k in os.environ}
  env.update(PATH=':'.join(p for p in os.environ['PATH'].split(':') if 'cmux-cli-shims' not in p),HOME=str(self.home),CLAUDE_CONFIG_DIR=str(self.cfg),TERM='xterm-256color',SHELL='/bin/bash',DISABLE_AUTOUPDATER='1',CLAUDE_CODE_ENABLE_FUNCTION_HOOKS='1',REAP_BUS=str(self.bus),CLAUDE_CODE_SUBAGENT_MODEL='haiku')
  if not network:env.update(ANTHROPIC_BASE_URL='http://127.0.0.1:9',ANTHROPIC_AUTH_TOKEN='no-network-probe',CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY='0',ANTHROPIC_MAX_RETRIES='0')
  self.envfile=self.root/'env';fd=os.open(self.envfile,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
  with os.fdopen(fd,'w') as f:
   for k,v in env.items():f.write('export %s=%s\n'%(k,shlex.quote(v)))
  self.master,self.slave=pty.openpty();fcntl.ioctl(self.slave,termios.TIOCSWINSZ,struct.pack('HHHH',45,160,0,0));self.before=termios.tcgetattr(self.slave)
  def child():
   os.setsid();fcntl.ioctl(0,termios.TIOCSCTTY,0)
  cmd=f'. {shlex.quote(str(self.envfile))}; stty -g > {self.root}/stty-before; {BIN} --plugin-dir {BASE}/plugin --plugin-dir {BASE}/guard --model haiku --permission-mode default --debug-file {self.root}/debug.log <&0 & child=$!; echo $child > {self.root}/claude.pid; wait $child; rc=$?; stty -g > {self.root}/stty-after; echo $rc > {self.root}/exit-code; exit $rc'
  self.proc=subprocess.Popen(['env','-i','/bin/bash','--noprofile','--norc','-c',cmd],stdin=self.slave,stdout=self.slave,stderr=self.slave,cwd=self.work,preexec_fn=child)
  self.raw=open(self.root/'pty.raw','wb');self.buf=b'';self.n=0
  self.wait(lambda:any(x.get('ev')=='session.start' for x in self.events()),30)
  self.pump(1)
 def pump(self,duration=.1):
  until=time.monotonic()+duration
  while time.monotonic()<until:
   r,_,_=select.select([self.master],[],[],min(.05,max(0,until-time.monotonic())))
   if r:
    try:b=os.read(self.master,65536)
    except OSError:break
    if not b:break
    self.raw.write(b);self.raw.flush();self.buf+=b
    if b'\x1b[6n' in b:os.write(self.master,b'\x1b[1;1R')
 def wait(self,fn,timeout=20):
  end=time.monotonic()+timeout
  while time.monotonic()<end:
   v=fn()
   if v:return v
   if self.proc.poll() is not None:return None
   self.pump(.1)
  raise TimeoutError(str(self.root))
 def mode(self,**kw):(self.bus/'mode.json').write_text(json.dumps(kw))
 def events(self):
  out=[]
  for f in (self.bus/'events').glob('*.json'):
   try:out.append(json.loads(f.read_text()))
   except ValueError:pass
  return sorted(out,key=lambda x:x['t'])
 def req(self,op,**kw):
  self.n+=1;p=self.bus/f'{self.n:03d}.req.json';p.write_text(json.dumps(dict(op=op,**kw)));return Path(str(p)+'.res')
 def result(self,p,timeout=20):
  return self.wait(lambda:json.loads(p.read_text()) if p.exists() else None,timeout)
 def type(self,text):
  os.write(self.master,text.encode());self.pump(.3);os.write(self.master,b'\r')
 def stop(self,method='term'):
  (self.root/'pre-exit-termios.json').write_text(json.dumps(termios.tcgetattr(self.slave),default=str))
  t=time.time()
  if method=='term':os.kill(int((self.root/'claude.pid').read_text()),signal.SIGTERM)
  else:
   self.type('/exit')
   if method=='exit-confirm':
    self.wait(lambda:b'Exit and stop tasks' in self.buf,5)
    (self.root/'exit-confirm.raw').write_bytes(self.buf)
    os.write(self.master,b'\r')
  self.wait(lambda:self.proc.poll() is not None,15);self.pump(.3)
  out={'method':method,'pid':int((self.root/'claude.pid').read_text()),'exit':self.proc.poll(),'elapsed_s':time.time()-t,'termios_restored':(self.root/'stty-before').read_text()==(self.root/'stty-after').read_text(),'before':(self.root/'stty-before').read_text(),'after':(self.root/'stty-after').read_text()}
  (self.root/'exit.json').write_text(json.dumps(out,default=str,indent=2));print(self.root.name,out['exit'],round(out['elapsed_s'],3),out['termios_restored'],flush=True)
  self.raw.close();os.close(self.master);os.close(self.slave);self.envfile.unlink(missing_ok=True)
 def cleanup(self):
  if self.proc.poll() is None:self.stop()
  self.envfile.unlink(missing_ok=True)
