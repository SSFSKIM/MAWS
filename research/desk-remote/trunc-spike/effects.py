import sys,json,time,os
sys.path.insert(0,'/Users/new/claude-code-bundle/2.1.300/notes/trunc-spike')
from harness import Probe

def save(p,name,x):(p.root/(name+'.json')).write_text(json.dumps(x,indent=2))
def background():
 p=Probe('effects')
 try:
  p.ready();f=p.work/'read.txt';f.write_text('ORIGINAL_A\n')
  script=p.work/'bg.py';script.write_text('import os,time\nfrom pathlib import Path\np=Path('+repr(str(p.work))+')\n(p/"bg.pid").write_text(str(os.getpid()))\nend=time.monotonic()+90\nwhile not (p/"release-bg").exists() and time.monotonic()<end:time.sleep(.1)\n(p/"bg.done").write_text("BG_DONE")\nprint("BG_DONE",flush=True)\n')
  p.stub.responses.extend([{'content':[{'type':'tool_use','id':'toolu_read_state','name':'Read','input':{'file_path':str(f)}}]}, {'content':[{'type':'tool_use','id':'toolu_background','name':'Bash','input':{'command':'/usr/bin/python3 -I '+str(script),'description':'Run isolated background probe','run_in_background':True}}]}, {'content':[{'type':'text','text':'BG_STARTED_READ_DONE'}]}])
  p.turn('SETUP_BACKGROUND_AND_READ')
  save(p,'edit-before',p.call('tool',input={'tool':'Edit','file_path':str(f),'old_string':'ORIGINAL_A','new_string':'EDITED_B'}))
  pid=int((p.work/'bg.pid').read_text());os.kill(pid,0);save(p,'bg-before',{'pid':pid,'alive':True})
  save(p,'cut',p.call('compact',instructions='CUT:guard:1'))
  os.kill(pid,0);save(p,'bg-after',{'pid':pid,'alive':True,'file':f.read_text()})
  save(p,'edit-after',p.call('tool',input={'tool':'Edit','file_path':str(f),'old_string':'EDITED_B','new_string':'EDITED_C'}))
  (p.work/'release-bg').touch();p.wait(lambda:(p.work/'bg.done').exists())
  p.turn('NEXT_AFTER_EFFECTS');(p.root/'pane-after.txt').write_text(p.pane());print('effects complete',flush=True)
 finally:
  (p.work/'release-bg').touch();p.cleanup()

def queued():
 p=Probe('queued')
 try:
  p.ready();p.turn('KEEP_QUEUE_BASE')
  n=len(p.stub.requests);p.stub.responses.append({'hold':'release-busy','content':[{'type':'text','text':'BUSY_REPLY'}]});p.type('BUSY_TURN')
  p.wait(lambda:len(p.stub.requests)>n)
  p.type('QUEUED_WHILE_BUSY');p.type('UNSENT_DRAFT_RACE',enter=False)
  save(p,'busy-compact',p.call('compact',instructions='CUT:guard:2'))
  req=p.req('command',command='compact',args='CUT:self:2');time.sleep(.4)
  save(p,'command-pending',{'has_result':req.exists()});(p.root/'pane-busy.txt').write_text(p.pane())
  (p.root/'http/release-busy').touch();save(p,'queued-command',p.result(req,60))
  p.wait(lambda:sum(e['event']=='turn.complete' for e in p.events())>=3,60)
  (p.root/'pane-after.txt').write_text(p.pane());save(p,'after',p.call('snapshot'));p.keys('C-u');p.turn('NEXT_AFTER_QUEUE');print('queued complete',flush=True)
 finally:
  (p.root/'http/release-busy').touch();p.cleanup()
background();queued()
