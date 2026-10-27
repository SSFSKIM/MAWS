exec(compile(open('/private/tmp/holder-tui/scripts/probe.py').read().split("if __name__")[0], 'probe.py','exec'))
e=Env();short='f792a270';out={};running=True
s=socket.socket(socket.AF_UNIX);s.connect(e.sock);s.sendall((json.dumps({'proto':1,'op':'subscribe','short':short,'tail':0})+'\n').encode());s.settimeout(.2)
def subscribe():
 buf=b''
 with open(e.root+'/out/subscribe.jsonl','w') as f:
  while running:
   try:chunk=s.recv(65536)
   except socket.timeout:continue
   if not chunk:break
   buf+=chunk
   while b'\n' in buf:
    line,buf=buf.split(b'\n',1)
    f.write(json.dumps({'t':time.time(),'v':json.loads(line)})+'\n');f.flush()
def watch():
 last=None
 with open(e.root+'/out/state-watch.jsonl','w') as f:
  while running:
   try:
    text=open(e.cfg+'/jobs/'+short+'/state.json').read()
    if text!=last:f.write(json.dumps({'t':time.time(),'v':json.loads(text)})+'\n');f.flush();last=text
   except (OSError,ValueError):pass
   time.sleep(.02)
for fn in (subscribe,watch):threading.Thread(target=fn,daemon=True).start()
e.window('state',BIN+' attach '+short,120,35);assert e.wait(lambda:'plan mode on' in e.pane('state'))
for cmd,wait in [('/rename holder-renamed',3),('/clear',3),('Reply with only OK.',12)]:
 e.text(cmd,name='state',enter=False);t=time.time();e.keys('Enter',name='state');out[cmd]={'t':t};time.sleep(wait);out[cmd]['disk']=e.state().get(short);out[cmd]['list']=e.control('list');out[cmd]['id']=e.call('id');e.snap('state-'+str(len(out)),name='state')
# Input-history and reattach repaint. Preserve the session, not terminal history.
e.keys('Up',name='state');time.sleep(.2);e.snap('history-up',name='state');e.keys('C-u',name='state');e.keys('C-z',name='state');e.wait(lambda:'PROBE_PROCESS_EXIT' in e.pane('state'))
e.window('rejoin',BIN+' attach '+short,120,35);e.wait(lambda:'holder-renamed' in e.pane('rejoin'));time.sleep(.3);e.snap('rejoin-history',name='rejoin');e.keys('Up',name='rejoin');time.sleep(.2);e.snap('rejoin-up',name='rejoin');e.keys('C-u',name='rejoin');e.keys('C-z',name='rejoin')
running=False;s.close();time.sleep(.05);e.save('stateprobe',out);print('done')
