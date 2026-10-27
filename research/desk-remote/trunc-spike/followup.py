import sys,json,time
sys.path.insert(0,'/Users/new/claude-code-bundle/2.1.300/notes/trunc-spike')
from harness import Probe

def save(p,n,x):(p.root/(n+'.json')).write_text(json.dumps(x,indent=2))
def resume(route):
 p=Probe('resume-'+route)
 try:
  p.ready();p.turn('RETAIN_USER',{'content':[{'type':'thinking','thinking':'PRESERVE_THINKING','signature':'TEST_SIG_123'},{'type':'text','text':'RETAIN_ASSISTANT'}]});p.turn('DISCARD_USER')
  n=len(p.call('snapshot')['result']['messages'])-2
  r=p.call('compact',instructions=f'CUT:guard:{n}') if route=='guard' else p.call('command',command='compact',args=f'CUT:self:{n}')
  save(p,'cut',r);sid=p.call('snapshot')['result']['id'];p.turn('ACTIVE_CHECK');p.type('/exit');p.wait(lambda:not p.pane());p.kill();p.launch(sid)
  p.wait(lambda:sum(e['event']=='session.start' for e in p.events())>=2);p.turn('RESUME_CHECK');save(p,'resumed',p.call('snapshot'));print('resume',route,'done',flush=True)
 finally:p.cleanup()

def ordinary():
 p=Probe('ordinary')
 try:
  p.ready()
  for t in ['ORDINARY_A','ORDINARY_B','ORDINARY_C']:p.turn(t)
  save(p,'ordinary',p.call('command',command='compact',args='NORMAL_COMPACT'))
  save(p,'window',p.call('command',command='autocompact',args='20000'))
  p.turn('HIGH_USAGE',{'tokens':999000});p.turn('AUTO_TRIGGER')
  save(p,'after-auto',p.call('snapshot'));(p.root/'pane.txt').write_text(p.pane());print('ordinary done',flush=True)
 finally:p.cleanup()

resume('guard');resume('self');ordinary()
