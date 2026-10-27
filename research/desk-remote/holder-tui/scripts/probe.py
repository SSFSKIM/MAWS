import os,json,subprocess,shlex,time,hashlib,socket,glob,threading,pathlib
BASE='/private/tmp/holder-tui'
BIN='/Users/new/.local/share/claude/versions/2.1.308'
PLUGIN=BASE+'/plugin/cmdprobe'
class Env:
 def __init__(self,name='main'):
  self.root=BASE+'/'+name; self.home=self.root+'/home'; self.cfg=self.home+'/.claude'; self.work=self.root+'/work'; self.bus=self.root+'/bus'; self.envfile=self.root+'/env'; self.tmux=['tmux','-L','holder-'+name,'-f','/dev/null']; self.sock='/tmp/cc-daemon-%d/%s/control.sock'%(os.getuid(),hashlib.sha256(self.cfg.encode()).hexdigest()[:8])
 def setup(self):
  for d in (self.cfg,self.work,self.bus+'/events',self.root+'/out',self.root+'/extra'): os.makedirs(d,exist_ok=True)
  owner=json.load(open('/Users/new/.claude.json'))
  cfg={'hasCompletedOnboarding':True,'theme':'dark','projects':{self.work:{'hasTrustDialogAccepted':True}}}
  for k in ('cachedGrowthBookFeatures','cachedGrowthBookFeaturesAt'):
   if k in owner: cfg[k]=owner[k]
  json.dump(cfg,open(self.cfg+'/.claude.json','w'))
  json.dump({'daemonColdStart':'transient','modelSettings':{'claude-haiku-5-5':{'effortLevel':'low'}}},open(self.cfg+'/settings.json','w'))
  subprocess.run(['git','init','-q',self.work],check=True)
  keys=('TERM','LANG','USER','LOGNAME','SHELL','TMPDIR','ANTHROPIC_BASE_URL','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_DEFAULT_HAIKU_MODEL','ANTHROPIC_DEFAULT_SONNET_MODEL','ANTHROPIC_DEFAULT_OPUS_MODEL','CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY')
  env={k:os.environ[k] for k in keys if k in os.environ}
  env.update(HOME=self.home,CLAUDE_CONFIG_DIR=self.cfg,PATH=':'.join(p for p in os.environ['PATH'].split(':') if 'cmux-cli-shims' not in p),DISABLE_AUTOUPDATER='1',CLAUDE_CODE_ENABLE_FUNCTION_HOOKS='1',CMDPROBE_BUS=self.bus,HOLDER_SENTINEL='shell-env-survived',EDITOR='/usr/bin/vi')
  fd=os.open(self.envfile,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
  with os.fdopen(fd,'w') as f:
   for k,v in env.items(): f.write('export %s=%s\n'%(k,shlex.quote(v)))
 def shell(self,cmd): return 'env -i /bin/bash --noprofile --norc -c '+shlex.quote('. '+shlex.quote(self.envfile)+'; cd '+shlex.quote(self.work)+'; '+cmd)
 def cli(self,args):
  t=time.time(); r=subprocess.run(['/bin/bash','-c',self.shell(BIN+' '+args)],capture_output=True,text=True,timeout=60); return {'sec':time.time()-t,'rc':r.returncode,'stdout':r.stdout,'stderr':r.stderr}
 def window(self,name,cmd,cols=120,rows=35):
  subprocess.run(self.tmux+['new-session','-d','-s',name,'-x',str(cols),'-y',str(rows),self.shell(cmd+'; printf "\\nPROBE_PROCESS_EXIT=%s\\n" "$?"; exec /bin/bash --noprofile --norc')],check=True)
  subprocess.run(self.tmux+['pipe-pane','-t',name,'cat >> '+self.root+'/out/'+name+'.raw'],check=True)
 def pane(self,name='person',history=False):return subprocess.run(self.tmux+['capture-pane','-p','-t',name]+(['-S','-1000'] if history else []),capture_output=True,text=True).stdout
 def keys(self,*keys,name='person'):subprocess.run(self.tmux+['send-keys','-t',name]+list(keys),check=True)
 def text(self,text,name='person',enter=True):
  self.keys('-l',text,name=name)
  if enter:time.sleep(.15);self.keys('Enter',name=name)
 def wait(self,pred,timeout=30):
  end=time.time()+timeout
  while time.time()<end:
   v=pred()
   if v:return v
   time.sleep(.05)
  return None
 def state(self):return {p.split('/')[-2]:json.load(open(p)) for p in glob.glob(self.cfg+'/jobs/*/state.json')}
 def control(self,op,**kw):
  req={'proto':1,'op':op,**kw}
  key=self.cfg+'/daemon/control.key'
  if os.path.exists(key):req['auth']=open(key).read().strip()
  s=socket.socket(socket.AF_UNIX);s.settimeout(5);s.connect(self.sock);s.sendall((json.dumps(req)+'\n').encode());buf=b''
  while b'\n' not in buf:buf+=s.recv(65536)
  s.close();return json.loads(buf.split(b'\n')[0])
 def call(self,op,**kw):
  rid=str(time.time_ns());p=self.bus+'/'+rid
  json.dump(dict(op=op,**kw),open(p+'.tmp','w'));os.rename(p+'.tmp',p+'.req.json')
  return self.wait(lambda:json.load(open(p+'.res.json')) if os.path.exists(p+'.res.json') else None)
 def save(self,tag,obj):json.dump(obj,open(self.root+'/out/'+tag+'.json','w'),indent=2)
 def snap(self,tag,name='person'):open(self.root+'/out/'+tag+'.txt','w').write(self.pane(name,True))
if __name__=='__main__':
 e=Env();e.setup();print('setup',e.root)
 print(e.cli('--version'))
 t=time.time();r=e.cli('--bg --model haiku -n holder-idle');e.save('idle-launch',r);print(r)
 e.save('idle-state',e.state());print('jobs',list(e.state()))
 e.window('person',BIN+' attach',120,35)
 ready=e.wait(lambda:'❯' in e.pane());print('idle launch to prompt',time.time()-t, bool(ready));e.snap('idle-attach-no-id')
