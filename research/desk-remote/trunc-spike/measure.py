import sys,json,time,base64,shutil
sys.path.insert(0,'/Users/new/claude-code-bundle/2.1.300/notes/trunc-spike')
from harness import Probe

def save(p,name,x):(p.root/(name+'.json')).write_text(json.dumps(x,indent=2))
def cut(p,n,route='guard'):
 start=len(p.stub.requests)
 r=p.call('compact',instructions=f'CUT:{route}:{n}') if route=='guard' else p.call('command',command='compact',args=f'CUT:self:{n}')
 save(p,'cut-'+str(p.n),r);print(p.root.name,'cut',n,r['ok'],r.get('error'),'requests',len(p.stub.requests)-start,flush=True);return r

def basic():
 p=Probe('basic')
 try:
  p.ready()
  for t in ['KEEP_ALPHA','DROP_BETA','DROP_GAMMA']:p.turn(t)
  p.type('UNSENT_DRAFT',enter=False);(p.root/'pane-before.txt').write_text(p.pane())
  save(p,'initial',p.call('snapshot'));cut(p,2)
  (p.root/'pane-after.txt').write_text(p.pane());p.keys('C-u')
  p.turn('NEXT_AFTER_CUT');save(p,'after-next',p.call('snapshot'))
  sid=p.call('snapshot')['result']['id'];p.keys('C-u');p.type('/exit')
  p.wait(lambda:not p.pane());p.kill();p.launch(sid)
  p.wait(lambda:sum(e['event']=='session.start' for e in p.events())>=2)
  p.turn('FIRST_AFTER_RESUME');(p.root/'pane-resume.txt').write_text(p.pane())
  save(p,'resumed',p.call('snapshot'))
 finally:p.cleanup()

def bound(n):
 p=Probe('bound-'+str(n))
 try:
  p.ready();p.turn('KEEP_FIRST');p.turn('DROP_SECOND');cut(p,n,route='self')
  p.turn('NEXT_BOUND_'+str(n));(p.root/'pane-after.txt').write_text(p.pane())
 finally:p.cleanup()

def media():
 p=Probe('media')
 try:
  p.ready()
  png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
  (p.work/'tiny.png').write_bytes(base64.b64decode(png))
  p.stub.responses.extend([{'content':[{'type':'thinking','thinking':'THINK_KEEP_EXACT_α','signature':'FAKE_SIGNATURE_EXACT_001'},{'type':'tool_use','id':'toolu_read_image','name':'Read','input':{'file_path':str(p.work/'tiny.png')}}]},{'content':[{'type':'text','text':'IMAGE_READ_DONE'}]}])
  p.turn('KEEP_IMAGE');snap=p.call('snapshot');save(p,'before',snap);n=len(snap['result']['messages'])
  p.turn('DROP_IMAGE_TAIL');cut(p,n)
  p.turn('NEXT_MEDIA');save(p,'after',p.call('snapshot'))
 finally:p.cleanup()

def pair():
 p=Probe('pair')
 try:
  p.ready();(p.work/'file.txt').write_text('READ_KEEP_TEXT\n')
  p.stub.responses.extend([{'content':[{'type':'tool_use','id':'toolu_pair','name':'Read','input':{'file_path':str(p.work/'file.txt')}}]},{'content':[{'type':'text','text':'PAIR_FINISHED'}]}])
  p.turn('KEEP_TOOL_CALL');p.turn('DROP_PAIR_TAIL');save(p,'before',p.call('snapshot'));cut(p,2)
  p.turn('NEXT_MID_PAIR');save(p,'after',p.call('snapshot'))
 finally:p.cleanup()

for f in [basic,lambda:bound(0),lambda:bound(1),media,pair]:
 try:f()
 except Exception as e:print('ERROR',f,e,flush=True);raise
