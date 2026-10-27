import sys,json,time
from pathlib import Path
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).parent))
from harness import Probe,wait
name=sys.argv[1];p=Probe(name)
def q(id='upload',outside=False,ext='png',**kw):return p.call('queue',id=id,path=str((p.root/'outside' if outside else p.work)/('sample.'+ext)),**kw)
def submit(text='Inspect the requested upload.'):return p.call('submit',text=text)
def record(key,value):
 print(key,json.dumps(value),flush=True)
 (p.root/(key+'.json')).write_text(json.dumps(value,indent=2))
try:
 p.ready();record('ready',p.events('session.start'))
 if name.startswith('formats'):
  record('queue',q());record('duplicate',q());record('submit',submit());p.completed(1)
  record('pdf-queue',q('pdf',ext='pdf'));submit();p.completed(2)
  record('pdf-pages-queue',q('pdf-pages',ext='pdf',pages='1'));submit();p.completed(3)
  record('user-note-queue',q('user-note',note='user'));submit();p.completed(4)
  record('system-note-queue',q('system-note',note='system'));submit();p.completed(5)
 elif name.startswith('outside-ask'):
  q(outside=True);submit();wait(lambda:p.events('permission'))
  record('permission-screen',p.pane('permission-screen'))
  # This isolated default-mode prompt is deliberately declined via Esc.
  p.keys('Escape');p.completed()
 elif name.startswith('outside-allow'):
  p.mode(allow=str(p.root/'outside')+'/');q(outside=True);submit();p.completed()
 elif name.startswith('direct-origin'):
  p.mode(allow=str(p.root/'outside')+'/')
  rid=p.req('tool',path=str(p.root/'outside/sample.png'))
  # Wait for permission text; same-plugin permission hook should be skipped.
  wait(lambda:'Do you want' in p.pane('permission-screen') or 'Allow' in p.pane('permission-screen'),15)
  p.keys('Escape');record('direct-result',p.result(rid))
 elif name.startswith('negative'):
  q(negative=True);record('submit',submit());p.completed()
 elif name.startswith('mid-tool'):
  p.stub.script=[{'blocks':[{'type':'tool_use','id':'stub_sleep','name':'Bash','input':{'command':'sleep 3','description':'Pause for intake timing'}}]},{}]
  submit('Run the timing tool.')
  wait(lambda:any(e['input'].get('tool')=='Bash' for e in p.events('tool.call')))
  record('queue-mid-tool',q());p.completed()
 elif name.startswith('mid-model-tool'):
  p.stub.script=[{'hold':'release-1','blocks':[{'type':'tool_use','id':'stub_sleep','name':'Bash','input':{'command':'sleep 0.1','description':'Complete held model response'}}]},{}]
  submit('Begin a held model request that will call a tool.')
  wait(lambda:len(p.stub.requests)>=1)
  record('queue-mid-model',q());(p.root/'release-1').touch();p.completed()
 elif name.startswith('mid-model'):
  p.stub.script=[{'hold':'release-1'},{}]
  submit('Begin a held model request.')
  wait(lambda:len(p.stub.requests)>=1)
  record('queue-mid-model',q())
  (p.root/'release-1').touch();p.completed(1)
  record('after-first',{'steps':p.events('step.enter'),'claims':p.events('step.claim'),'requests':len(p.stub.requests)})
  record('later-submit',submit('Continue with the pending upload.'));p.completed(2)
 elif name.startswith('esc-step'):
  q(**({'delayAfter':5000} if name.startswith('esc-step-chunks') else {'delay':5000}));submit();wait(lambda:p.events('step.delay'));p.keys('Escape');p.completed()
  record('after-esc',{'pane':p.pane('after-esc'),'steps':p.events('step.enter'),'tools':p.events('tool.call'),'requests':len(p.stub.requests)})
  record('late-submit',submit('Bridge after local Escape'))
  record('late-append',p.call('append',text='Bridge note after local Escape'))
  record('late-tool',p.call('tool',path=str(p.work/'sample.png')))
  record('late-queue',q('second'))
  record('late-read',p.call('read'))
  p.type('Human resumes after Escape.');p.completed(2)
  record('after-human',{'steps':p.events('step.enter'),'tools':p.events('tool.call'),'requests':len(p.stub.requests)})
 elif name.startswith('esc-model'):
  p.stub.script=[{'hold':'release-1'},{}]
  q();submit();wait(lambda:len(p.stub.requests)>=1);p.keys('Escape');p.completed()
  record('after-esc',{'pane':p.pane('after-esc'),'steps':p.events('step.enter'),'tools':p.events('tool.call'),'requests':len(p.stub.requests)})
  record('late-submit',submit('Bridge after local Escape'))
  record('late-append',p.call('append',text='Bridge note after local Escape'))
  record('late-tool',p.call('tool',path=str(p.work/'sample.png')))
  (p.root/'release-1').touch()
  p.type('Human resumes after Escape.');p.completed(2)
 elif name.startswith('notes-only'):
  q('user-only',note='user',text=False);submit();p.completed(1);p.pane('user-note-pane')
  q('system-only',note='system',text=False);submit();p.completed(2);p.pane('system-note-pane')
 elif name.startswith('literal'):
  submit('Inspect @'+str(p.work/'sample.png')+' and @'+str(p.work/'sample.pdf'));p.completed()
 elif name.startswith('fallback'):
  p.stub.script=[{'blocks':[{'type':'tool_use','id':'stub_read_png','name':'Read','input':{'file_path':str(p.work/'sample.png')}}]}, {}, {'blocks':[{'type':'tool_use','id':'stub_read_pdf','name':'Read','input':{'file_path':str(p.work/'sample.pdf')}}]},{}]
  submit('Read this user upload with native Read: '+str(p.work/'sample.png'));p.completed(1)
  submit('Read this user upload with native Read: '+str(p.work/'sample.pdf'));p.completed(2)
 else:raise ValueError(name)
 record('summary',{'requests':len(p.stub.requests),'steps':p.events('step.enter'),'claims':p.events('step.claim'),'permissions':p.events('permission'),'tools':p.events('tool.call'),'turns':p.events('turn.complete')})
 p.pane('result-pane')
except Exception:
 print(p.pane('failure-pane'),flush=True)
 raise
finally:p.cleanup()
