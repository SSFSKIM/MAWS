import os,sys,json,subprocess,time,shlex,threading,http.server,hashlib,socket,shutil
from pathlib import Path
BASE=Path('/private/tmp/wave2-trunc')
SRC=Path('/Users/new/claude-code-bundle/2.1.300/notes/trunc-spike')
BIN='/Users/new/.local/share/claude/versions/2.1.310'
class Stub:
 def __init__(self,root):
  self.root=root;self.requests=[];self.lock=threading.Lock();self.responses=[]
  owner=self
  class Handler(http.server.BaseHTTPRequestHandler):
   def log_message(self,*a):pass
   def do_POST(self):
    b=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))))
    with owner.lock:
     idx=len(owner.requests);owner.requests.append({'path':self.path,'body':b})
     (root/f'request-{idx:03}.json').write_text(json.dumps(owner.requests[-1],indent=2))
     response=owner.responses.pop(0) if owner.responses and b.get('tools') else {}
    if 'count_tokens' in self.path:
     self.send_response(200);self.end_headers();self.wfile.write(b'{"input_tokens":100}');return
    if response.get('hold'):
     while not (root/response['hold']).exists():time.sleep(.05)
    content=response.get('content',[{'type':'text','text':f'STUB_REPLY_{idx}'}]);stop='tool_use' if any(x['type']=='tool_use' for x in content) else 'end_turn'
    usage={'input_tokens':response.get('tokens',100),'output_tokens':25,'cache_creation_input_tokens':0,'cache_read_input_tokens':0}
    msg={'id':f'msg_stub_{idx}','type':'message','role':'assistant','model':b.get('model','claude-opus-5-5'),'content':content,'stop_reason':stop,'stop_sequence':None,'usage':usage}
    self.send_response(200);self.send_header('Content-Type','text/event-stream' if b.get('stream') else 'application/json');self.end_headers()
    try:
     if not b.get('stream'):self.wfile.write(json.dumps(msg).encode());return
     def send(ev):self.wfile.write(('event: '+ev['type']+'\ndata: '+json.dumps(ev)+'\n\n').encode());self.wfile.flush()
     send({'type':'message_start','message':dict(msg,content=[],stop_reason=None)})
     for i,block in enumerate(content):
      typ=block['type'];start=dict(block)
      if typ=='tool_use':start['input']={}
      elif typ=='thinking':start['thinking']='';start['signature']=''
      elif typ=='text':start['text']=''
      send({'type':'content_block_start','index':i,'content_block':start})
      delta=({'type':'input_json_delta','partial_json':json.dumps(block['input'])} if typ=='tool_use' else {'type':'thinking_delta','thinking':block['thinking']} if typ=='thinking' else {'type':'text_delta','text':block['text']})
      send({'type':'content_block_delta','index':i,'delta':delta})
      if typ=='thinking':send({'type':'content_block_delta','index':i,'delta':{'type':'signature_delta','signature':block['signature']}})
      send({'type':'content_block_stop','index':i})
     send({'type':'message_delta','delta':{'stop_reason':stop,'stop_sequence':None},'usage':usage});send({'type':'message_stop'})
    except BrokenPipeError:pass
   def do_GET(self):self.send_response(200);self.end_headers();self.wfile.write(b'{}')
  self.server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);self.server.daemon_threads=True
  self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
 def stop(self):self.server.shutdown();self.server.server_close();self.thread.join()
class Probe:
 def __init__(self,name,guard=True):
  self.root=BASE/name;self.home=self.root/'home';self.cfg=self.home/'.claude';self.work=self.root/'work';self.bus=self.root/'bus';self.n=0
  for d in (self.cfg,self.work,self.bus/'events',self.root/'http'):d.mkdir(parents=True)
  self.stub=Stub(self.root/'http');self.tmux=['/opt/homebrew/bin/tmux','-L','wave2-trunc-'+name,'-f','/dev/null']
  for p,src in [('caller','register.ts'),('guard','guard.ts')]:
   plugin=self.root/p;(plugin/'.claude-plugin').mkdir(parents=True);(plugin/'hooks').mkdir()
   (plugin/'.claude-plugin/plugin.json').write_text(json.dumps({'name':'trunc-'+p,'version':'0.1.0'}))
   (plugin/'hooks/hooks.json').write_text('{"modules":["./register.ts"]}')
   shutil.copy(SRC/src,plugin/'hooks/register.ts');shutil.copy(SRC/'child.py',plugin/'child.py')
  (self.cfg/'.claude.json').write_text(json.dumps({'hasCompletedOnboarding':True,'theme':'dark','projects':{str(self.work):{'hasTrustDialogAccepted':True}},'customApiKeyResponses':{'approved':['trunc-dummy-key']}}))
  (self.cfg/'settings.json').write_text(json.dumps({'daemonColdStart':'transient','permissions':{'allow':['Read','Edit','Write','Bash']},'autoUpdatesChannel':'stable'}))
  subprocess.run(['git','init','-q',str(self.work)],check=True)
  env=dict(PATH='/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',HOME=str(self.home),CLAUDE_CONFIG_DIR=str(self.cfg),TERM='xterm-256color',SHELL='/bin/bash',LANG='en_US.UTF-8',USER='new',LOGNAME='new',TMPDIR=str(self.root),DISABLE_AUTOUPDATER='1',CLAUDE_CODE_ENABLE_FUNCTION_HOOKS='1',TRUNC_BUS=str(self.bus),ANTHROPIC_BASE_URL=f'http://127.0.0.1:{self.stub.server.server_port}',ANTHROPIC_API_KEY='trunc-dummy-key',ANTHROPIC_MAX_RETRIES='0',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1',DISABLE_TELEMETRY='1',DISABLE_ERROR_REPORTING='1',CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY='0')
  self.envfile=self.root/'env';self.envfile.write_text('\n'.join('export '+k+'='+shlex.quote(v) for k,v in env.items()));self.envfile.chmod(0o600)
  self.plugins=f'--plugin-dir {self.root}/caller'+(f' --plugin-dir {self.root}/guard' if guard else '')
  self.launch()
 def launch(self,resume=None):
  cmd=f'. {self.envfile}; cd {self.work}; exec {BIN} {self.plugins} --model claude-opus-5-5 --permission-mode default --debug-file {self.root}/debug'+ ('-resume' if resume else '')+'.log'+(f' --resume {resume}' if resume else '')
  subprocess.run(self.tmux+['new-session','-d','-s','p','-x','180','-y','55','env -i /bin/bash --noprofile --norc -c '+shlex.quote(cmd)],check=True)
 def wait(self,fn,timeout=30):
  end=time.monotonic()+timeout
  while time.monotonic()<end:
   v=fn()
   if v:return v
   time.sleep(.1)
  (self.root/'timeout-pane.txt').write_text(self.pane());raise TimeoutError(str(self.root))
 def pane(self):return subprocess.run(self.tmux+['capture-pane','-p','-t','p','-S','-2000'],capture_output=True,text=True).stdout
 def keys(self,*keys):subprocess.run(self.tmux+['send-keys','-t','p',*keys],check=True)
 def type(self,text,enter=True):
  self.keys('-l',text)
  if enter:time.sleep(.15);self.keys('Enter')
 def events(self):
  out=[]
  for p in (self.bus/'events').glob('*.json'):
   try:out.append(json.loads(p.read_text()))
   except ValueError:pass
  return sorted(out,key=lambda x:x['t'])
 def ready(self):
  self.wait(lambda:'Yes, I trust' in self.pane() or any(e['event']=='session.start' for e in self.events()))
  if 'Yes, I trust' in self.pane():self.keys('Enter')
  self.wait(lambda:any(e['event']=='session.start' for e in self.events()))
  if 'Yes /' in self.pane() or 'Do you want to use this API key' in self.pane():self.keys('Enter')
 def req(self,op,**kw):
  self.n+=1;p=self.bus/f'{self.n:03}.req.json';p.write_text(json.dumps(dict(op=op,**kw)));return Path(str(p)+'.res')
 def result(self,p,timeout=40):return self.wait(lambda:json.loads(p.read_text()) if p.exists() else None,timeout)
 def call(self,op,**kw):return self.result(self.req(op,**kw))
 def turn(self,text,response=None):
  n=sum(e['event']=='turn.complete' for e in self.events())
  if response:self.stub.responses.append(response)
  self.type(text);self.wait(lambda:sum(e['event']=='turn.complete' for e in self.events())>n,60)
 def kill(self):subprocess.run(self.tmux+['kill-server'],capture_output=True)
 def cleanup(self):
  self.kill();self.stub.stop();self.envfile.unlink(missing_ok=True)
  key=hashlib.sha256(str(self.cfg).encode()).hexdigest()[:8];daemon=Path('/private/tmp/cc-daemon-501')/key
  if (daemon/'control.sock').exists():
   try:
    s=socket.socket(socket.AF_UNIX);s.settimeout(3);s.connect(str(daemon/'control.sock'));s.sendall(b'{"proto":1,"op":"shutdown"}\n');(self.root/'daemon-shutdown.txt').write_bytes(s.recv(65536));s.close()
   except Exception as e:(self.root/'daemon-shutdown.txt').write_text(str(e))
