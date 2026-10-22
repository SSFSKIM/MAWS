exec(compile(open('/private/tmp/holder-tui/scripts/probe.py').read().split("if __name__")[0], 'probe.py','exec'))
import signal
SCRIPTS=BASE+'/scripts'
def host(e,layout):
 p=subprocess.Popen(['/usr/bin/python3','-I',SCRIPTS+'/pty_host.py',e.root,e.envfile,e.work,BIN,PLUGIN,layout],stdin=subprocess.DEVNULL,stdout=open(e.root+'/out/host-stdout.txt','ab'),stderr=subprocess.STDOUT,start_new_session=True);assert e.wait(lambda:os.path.exists(e.root+'/host.sock'));return p

def manager(e):
 p=subprocess.Popen(['/usr/bin/python3','-I',SCRIPTS+'/pty_manager.py',e.root],stdin=subprocess.DEVNULL,stdout=open(e.root+'/out/manager-stdout.txt','ab'),stderr=subprocess.STDOUT,start_new_session=True);assert e.wait(lambda:os.path.exists(e.root+'/manager-pid.json') and json.load(open(e.root+'/manager-pid.json')).get('manager')==p.pid);return p

def client(e,name,cols=120,rows=35):
 def count():return open(e.root+'/out/host-events.jsonl').read().count('"op": "attach"')
 n=count();e.window(name,'/usr/bin/python3 -I '+SCRIPTS+'/pty_client.py '+e.root+'/manager.sock',cols,rows);assert e.wait(lambda:count()>n)
def ctrl(e,op):
 s=socket.socket(socket.AF_UNIX);s.connect(e.root+'/host.sock');s.sendall((json.dumps({'op':op})+'\n').encode());s.settimeout(3);data=s.recv(65536);s.close();return data.decode()
def detach(e,n):e.keys('C-]',name=n);assert e.wait(lambda:'CLIENT_DETACHED' in e.pane(n))
if __name__=='__main__':
 results={}
 for label,layout in [('full','1'),('main','0')]:
  e=Env('plain-'+label)
  if os.path.exists(e.root+'/out/plain-results.json'):
   results[label]=json.load(open(e.root+'/out/plain-results.json'));continue
  if os.path.exists(e.envfile):
   subprocess.run(e.tmux+['kill-server'],capture_output=True)
   try:os.kill(json.load(open(e.root+'/manager-pid.json'))['manager'],signal.SIGTERM)
   except ProcessLookupError:pass
  else:e.setup();host(e,layout)
  m=manager(e);client(e,'first');time.sleep(.15);ctrl(e,'jiggle');assert e.wait(lambda:'❯' in e.pane('first'));e.snap('initial',name='first');r={'pids':json.load(open(e.root+'/pids.json')),'manager':m.pid,'env':e.call('env'),'model':e.call('model')}
  # Local commands put stable visible history on screen without a model call.
  e.text('/rename plain-'+label,name='first');e.wait(lambda:'plain-'+label in e.pane('first'));e.text('/effort low',name='first');e.wait(lambda:'Set effort' in e.pane('first'));e.snap('before-detach',name='first');r['session']=e.call('id');detach(e,'first')
  client(e,'fresh');time.sleep(.3);e.snap('reattach-no-signal',name='fresh');r['winch_t']=time.time();ctrl(e,'winch');time.sleep(.35);e.snap('reattach-winch',name='fresh');r['jiggle_t']=time.time();ctrl(e,'jiggle');time.sleep(.35);e.snap('reattach-jiggle',name='fresh')
  # Two independent clients, one PTY input buffer and one PTY size.
  client(e,'small',70,20);time.sleep(.4);e.snap('two-large',name='fresh');e.snap('two-small',name='small')
  e.keys('C-u',name='fresh')
  for n,c in [('fresh','A'),('small','1'),('fresh','B'),('small','2')]:e.text(c,name=n,enter=False)
  e.wait(lambda:'A1B2' in e.pane('fresh'));e.snap('mixed',name='fresh');e.snap('mixed-small',name='small');e.keys('C-u',name='fresh');detach(e,'small');time.sleep(.35);e.snap('small-closed',name='fresh')
  # Killing only the manager drops clients; host and TUI must remain identical.
  r['pre_restart']=e.call('id');os.kill(m.pid,signal.SIGKILL);m.wait();e.wait(lambda:'CLIENT_DETACHED' in e.pane('fresh'));r['after_manager_kill']=e.call('id');m=manager(e);client(e,'after');ctrl(e,'jiggle');time.sleep(.4);e.snap('manager-restarted',name='after');r['post_restart']=e.call('id');r['pids_after']=json.load(open(e.root+'/pids.json'));r['manager_after']=m.pid
  # Leave the session available for specific final checks.
  e.save('plain-results',r);results[label]=r
 print(json.dumps(results,indent=2))
