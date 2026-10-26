import sys,json,time
sys.path.insert(0,'/Users/new/claude-code-bundle/2.1.300/notes/trunc-spike')
from harness import Probe
p=Probe('origin')
try:
 p.ready();print('READY',flush=True)
 for text in ['KEEP_ALPHA','KEEP_BETA','DROP_GAMMA']:p.turn(text)
 for op,kw in [('compact',{'instructions':'CUT:self:2'}),('command',{'command':'compact','args':'CUT:self:2'}),('compact',{'instructions':'CUT:guard:2'})]:
  start=len(p.stub.requests);r=p.call(op,**kw);print(op,kw,'ok',r['ok'],'http',len(p.stub.requests)-start,'counts',len(r['before']),len(r['after']),r.get('error'),flush=True)
  p.turn('AFTER_'+str(p.n))
  (p.root/f'pane-{p.n}.txt').write_text(p.pane())
 print('DONE',flush=True)
finally:p.cleanup()
