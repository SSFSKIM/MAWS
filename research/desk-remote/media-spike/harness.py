"""Zero-inference-spend interactive 2.1.310 probes. Run with python3 -I.
All runtime writes, local HTTP requests and child processes stay under wave2-media.
"""
import json, os, shlex, subprocess, time, threading, http.server, shutil, hashlib, socket, signal, base64, struct, zlib
from pathlib import Path
BASE=Path('/private/tmp/wave2-media')
SOURCE=Path(__file__).parent
BIN='/Users/new/.local/share/claude/versions/2.1.310'
TMUX='/opt/homebrew/bin/tmux'

def wait(fn,timeout=25):
 end=time.monotonic()+timeout
 while time.monotonic()<end:
  v=fn()
  if v:return v
  time.sleep(.05)
 raise TimeoutError(str(fn))

def fixtures(work):
 def chunk(t,b):return struct.pack('>I',len(b))+t+b+struct.pack('>I',zlib.crc32(t+b)&0xffffffff)
 png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',16,16,8,2,0,0,0))+chunk(b'IDAT',zlib.compress((b'\0'+b'\xff\0\0'*16)*16))+chunk(b'IEND',b'')
 (work/'sample.png').write_bytes(png)
 text=b'BT /F1 18 Tf 30 100 Td (MEDIA SPIKE PDF ONE PAGE) Tj ET'
 objs=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 160] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',b'<< /Length '+str(len(text)).encode()+b' >>\nstream\n'+text+b'\nendstream']
 pdf=b'%PDF-1.4\n'; offsets=[0]
 for i,o in enumerate(objs,1):offsets.append(len(pdf));pdf+=str(i).encode()+b' 0 obj\n'+o+b'\nendobj\n'
 pos=len(pdf);pdf+=b'xref\n0 6\n0000000000 65535 f \n'+b''.join(f'{o:010d} 00000 n \n'.encode() for o in offsets[1:])+f'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{pos}\n%%EOF\n'.encode()
 (work/'sample.pdf').write_bytes(pdf)

class Stub:
 def __init__(self,root):
  self.root=root;self.requests=[];self.script=[];self.lock=threading.Lock()
  outer=self
  class Handler(http.server.BaseHTTPRequestHandler):
   def log_message(self,*a):pass
   def do_GET(self):self.send_response(200);self.end_headers();self.wfile.write(b'{}')
   def do_POST(self):
    body=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))) or b'{}')
    with outer.lock:
     n=len(outer.requests)+1
     rec={'n':n,'t':time.time(),'path':self.path,'body':body};outer.requests.append(rec)
     (root/f'request-{n:03d}.json').write_text(json.dumps(rec))
     cfg=outer.script.pop(0) if outer.script and body.get('tools') else {}
    if 'count_tokens' in self.path:
     self.send_response(200);self.end_headers();self.wfile.write(b'{"input_tokens":100}');return
    if cfg.get('hold'):
     wait(lambda:(root/cfg['hold']).exists(),90)
    blocks=cfg.get('blocks',[{'type':'text','text':'STUB_DONE'}])
    usage={'input_tokens':100,'output_tokens':10,'cache_creation_input_tokens':0,'cache_read_input_tokens':0}
    message={'id':f'msg_stub_{n}','type':'message','role':'assistant','model':body.get('model','claude-opus-5-5'),'content':[],'stop_reason':None,'stop_sequence':None,'usage':usage}
    try:
     self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
     def emit(event,obj):self.wfile.write(('event: '+event+'\ndata: '+json.dumps(obj)+'\n\n').encode());self.wfile.flush()
     emit('message_start',{'type':'message_start','message':message})
     for i,b in enumerate(blocks):
      tool=b['type']=='tool_use'
      emit('content_block_start',{'type':'content_block_start','index':i,'content_block':dict(b,input={}) if tool else {'type':'text','text':''}})
      emit('content_block_delta',{'type':'content_block_delta','index':i,'delta':{'type':'input_json_delta','partial_json':json.dumps(b['input'])} if tool else {'type':'text_delta','text':b['text']}})
      emit('content_block_stop',{'type':'content_block_stop','index':i})
     emit('message_delta',{'type':'message_delta','delta':{'stop_reason':'tool_use' if any(b['type']=='tool_use' for b in blocks) else 'end_turn','stop_sequence':None},'usage':usage})
     emit('message_stop',{'type':'message_stop'})
     (root/f'response-{n:03d}.json').write_text(json.dumps({'t':time.time(),'blocks':blocks}))
    except (BrokenPipeError,ConnectionResetError):
     (root/f'cancel-{n:03d}').write_text(str(time.time()))
  self.server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
  self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
 def close(self):
  for c in self.script:
   if c.get('hold'):(self.root/c['hold']).touch()
  self.server.shutdown();self.server.server_close();self.thread.join()

class Probe:
 def __init__(self,name):
  self.root=BASE/name;self.work=self.root/'work';self.cfg=self.root/'home/.claude';self.bus=self.root/'bus';self.home=self.cfg.parent
  for d in (self.work,self.cfg,self.bus/'events',self.root/'outside'):d.mkdir(parents=True,exist_ok=False)
  self.stub=Stub(self.root);self.n=0
  self.tmux=[TMUX,'-L','wave2-media-'+name,'-f','/dev/null']
  self.mode()
  fixtures(self.work);fixtures(self.root/'outside')
  (self.cfg/'.claude.json').write_text(json.dumps({'hasCompletedOnboarding':True,'hasResetAutoModeOptInForDefaultOffer':True,'hasSeenAutoDefaultNudge':True,'hasSeenAutoModeEntryWarning':True,'theme':'dark','projects':{str(self.work):{'hasTrustDialogAccepted':True}},'customApiKeyResponses':{'approved':['media-dummy-key'],'rejected':[]}}))
  (self.cfg/'settings.json').write_text(json.dumps({'daemonColdStart':'transient','permissions':{'defaultMode':'default','allow':['Bash(sleep *)']},'effortLevel':'low'}))
  subprocess.run(['/usr/bin/git','init','-q',str(self.work)],check=True)
  self.plugin=self.root/'plugin';shutil.copytree(SOURCE/'plugin',self.plugin)
  (self.plugin/'.claude-plugin').mkdir();(self.plugin/'.claude-plugin/plugin.json').write_text(json.dumps({'name':'media-probe','version':'0.1.0'}))
  (self.plugin/'hooks/hooks.json').write_text('{"modules":["./register.ts"]}')
  env=dict(PATH='/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',HOME=str(self.home),CLAUDE_CONFIG_DIR=str(self.cfg),TERM='xterm-256color',SHELL='/bin/bash',LANG='en_US.UTF-8',USER='media-probe',LOGNAME='media-probe',TMPDIR=str(self.root),DISABLE_AUTOUPDATER='1',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1',DISABLE_TELEMETRY='1',DISABLE_ERROR_REPORTING='1',CLAUDE_CODE_ENABLE_FUNCTION_HOOKS='1',MEDIA_BUS=str(self.bus),ANTHROPIC_BASE_URL=f'http://127.0.0.1:{self.stub.server.server_port}',ANTHROPIC_API_KEY='media-dummy-key',ANTHROPIC_MAX_RETRIES='0',CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY='0',HTTP_PROXY='http://127.0.0.1:9',HTTPS_PROXY='http://127.0.0.1:9',NO_PROXY='127.0.0.1,localhost')
  self.envfile=self.root/'env';self.envfile.write_text(''.join(f'export {k}={shlex.quote(v)}\n' for k,v in env.items()));self.envfile.chmod(0o600)
  cmd=f'. {shlex.quote(str(self.envfile))}; cd {self.work}; echo $$ > {self.root}/claude.pid; exec {BIN} --plugin-dir {self.plugin} --model claude-opus-5-5 --permission-mode default --debug-file {self.root}/debug.log'
  shell='env -i /bin/bash --noprofile --norc -c '+shlex.quote(cmd)
  subprocess.run(self.tmux+['new-session','-d','-s','p','-x','160','-y','45',shell],check=True)
 def ready(self):return wait(lambda:self.events('session.start'),40)
 def pane(self,name='pane'):
  s=subprocess.run(self.tmux+['capture-pane','-p','-t','p','-S','-200'],capture_output=True,text=True).stdout
  (self.root/f'{name}.txt').write_text(s);return s
 def keys(self,*keys):subprocess.run(self.tmux+['send-keys','-t','p']+list(keys),check=True)
 def type(self,text):self.keys('-l',text);time.sleep(.15);self.keys('Enter')
 def mode(self,**kw):(self.bus/'mode.json').write_text(json.dumps(kw))
 def req(self,op,**kw):
  self.n+=1;rid=f'{self.n:04d}';p=self.bus/f'{rid}.req.json';tmp=self.bus/f'{rid}.tmp';tmp.write_text(json.dumps({'rid':rid,'op':op,**kw}));tmp.rename(p);return rid
 def result(self,rid,timeout=25):
  p=self.bus/f'{rid}.res.json'
  return wait(lambda:json.loads(p.read_text()) if p.exists() else None,timeout)
 def call(self,op,**kw):return self.result(self.req(op,**kw))
 def events(self,ev=None):
  out=[]
  for f in (self.bus/'events').glob('*.json'):
   try:r=json.loads(f.read_text())
   except ValueError:continue
   if ev is None or r['ev']==ev:out.append(r)
  return sorted(out,key=lambda r:r['t'])
 def completed(self,n=1):return wait(lambda:len(self.events('turn.complete'))>=n,40)
 def cleanup(self):
  self.pane('final-pane')
  for f in self.root.glob('release*'):f.touch()
  # Release active scripted responses before shutting down local HTTP.
  for i in range(20):(self.root/f'release-{i}').touch()
  pidfile=self.root/'claude.pid'
  if pidfile.exists():
   try:os.kill(int(pidfile.read_text()),signal.SIGTERM)
   except ProcessLookupError:pass
  time.sleep(.5)
  subprocess.run(self.tmux+['kill-server'],capture_output=True)
  self.stub.close()
  self.envfile.unlink(missing_ok=True)
  # The daemon's path is config-scoped; never address the owner's socket.
  sockroot=Path('/tmp/cc-daemon-501')/hashlib.sha256(str(self.cfg).encode()).hexdigest()[:8]
  sock=sockroot/'control.sock'
  if sock.exists():
   try:
    c=socket.socket(socket.AF_UNIX);c.settimeout(2);c.connect(str(sock));c.sendall(b'{"proto":1,"op":"shutdown"}\n');c.close()
   except OSError:pass
  (self.root/'cleanup.json').write_text(json.dumps({'t':time.time(),'daemonRoot':str(sockroot),'tmux':self.tmux[2]}))
