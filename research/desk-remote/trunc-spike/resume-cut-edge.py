import sys,json
sys.path.insert(0,'/Users/new/claude-code-bundle/2.1.300/notes/trunc-spike')
from harness import Probe
for name,pair in [('resume-partial',False),('resume-pair',True)]:
 p=Probe(name)
 try:
  p.ready()
  if pair:
   f=p.work/'read.txt';f.write_text('SHOULD_BE_CUT_TOOL_RESULT\n')
   p.stub.responses.extend([{'content':[{'type':'tool_use','id':'toolu_edge','name':'Read','input':{'file_path':str(f)}}]},{'content':[{'type':'text','text':'SHOULD_BE_CUT_FINAL'}]}])
   p.turn('RETAIN_FIRST')
  else:p.turn('RETAIN_FIRST',{'content':[{'type':'thinking','thinking':'RETAIN_THINK','signature':'EDGE_SIG'},{'type':'text','text':'SHOULD_BE_CUT_ASSISTANT_TEXT'}]})
  p.turn('DISCARD_TAIL');r=p.call('compact',instructions='CUT:guard:2');(p.root/'cut.json').write_text(json.dumps(r,indent=2))
  sid=p.call('snapshot')['result']['id'];p.turn('ACTIVE_EDGE_CHECK');p.type('/exit');p.wait(lambda:not p.pane());p.kill();p.launch(sid)
  p.wait(lambda:sum(e['event']=='session.start' for e in p.events())>=2);p.turn('RESUME_EDGE_CHECK');print(name,'done',flush=True)
 finally:p.cleanup()
