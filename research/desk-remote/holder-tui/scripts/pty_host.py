"""Per-session master owner. Own protocol is JSON-lines with base64 PTY payloads."""
import os,sys,pty,fcntl,termios,struct,signal,socket,selectors,json,time,base64
root,envfile,work,binpath,plugin,layout=sys.argv[1:]
path=root+'/host.sock';sel=selectors.DefaultSelector();clients={};sizes={};last_size=(120,35)
pid,master=pty.fork()
if pid==0:
 import shlex
 argv=json.load(open(root+'/launch-args.json')) if os.path.exists(root+'/launch-args.json') else ['--model','haiku','--permission-mode','default','--plugin-dir',plugin]
 cmd='. '+shlex.quote(envfile)+'; cd '+shlex.quote(work)+'; export CLAUDE_CODE_NO_FLICKER='+layout+'; exec '+shlex.quote(binpath)+' '+shlex.join(argv)
 os.execv('/usr/bin/env',['env','-i','/bin/bash','--noprofile','--norc','-c',cmd])
def size(cols,rows):
 global last_size
 fcntl.ioctl(master,termios.TIOCSWINSZ,struct.pack('HHHH',rows,cols,0,0));last_size=(cols,rows)
size(*last_size)
server=socket.socket(socket.AF_UNIX);server.bind(path);server.listen();os.chmod(path,0o600);server.setblocking(False);os.set_blocking(master,False);sel.register(server,selectors.EVENT_READ,'accept');sel.register(master,selectors.EVENT_READ,'pty')
meta={'host':os.getpid(),'child':pid,'socket':path,'layout':layout};json.dump(meta,open(root+'/pids.json','w'))
log=open(root+'/out/host-events.jsonl','a',buffering=1);raw=open(root+'/out/pty.raw','ab',buffering=0)
def event(kind,**kw):log.write(json.dumps({'t':time.time(),'kind':kind,**kw})+'\n')
def send(c,o):
 try:c.sendall((json.dumps(o)+'\n').encode())
 except OSError:close(c)
def close(c):
 if c not in clients:return
 sel.unregister(c);clients.pop(c,None);sizes.pop(c,None);c.close();event('disconnect',remaining=len(clients))
 if sizes and master>=0:size(*list(sizes.values())[-1])
event('start',**meta)
try:
 while True:
  for key,_ in sel.select(.1):
   if key.data=='accept':
    c,_=server.accept();clients[c]=b'';sel.register(c,selectors.EVENT_READ,'client');event('connect')
   elif key.data=='pty':
    try:data=os.read(master,65536)
    except BlockingIOError:continue
    except OSError:data=b''
    if not data:raise EOFError()
    raw.write(data);event('output',n=len(data),b64=base64.b64encode(data).decode())
    for c in list(clients):send(c,{'data':base64.b64encode(data).decode()})
   else:
    c=key.fileobj
    try:data=c.recv(65536)
    except OSError:data=b''
    if not data:close(c);continue
    clients[c]+=data
    while c in clients and b'\n' in clients[c]:
     line,clients[c]=clients[c].split(b'\n',1);m=json.loads(line);op=m.get('op');event('request',op=op,**{k:v for k,v in m.items() if k in ('cols','rows','tag')})
     if op=='attach':sizes[c]=(m['cols'],m['rows']);size(*sizes[c]);send(c,{'ack':'attach','child':pid})
     elif op=='input':os.write(master,base64.b64decode(m['data']))
     elif op=='resize':sizes[c]=(m['cols'],m['rows']);size(*sizes[c])
     elif op=='winch':os.kill(pid,signal.SIGWINCH);send(c,{'ack':'winch'})
     elif op=='jiggle':
      cols,rows=last_size;size(cols-1,rows);time.sleep(.15);size(cols,rows);send(c,{'ack':'jiggle'})
     elif op=='meta':send(c,{'meta':meta,'size':last_size})
     elif op=='close-master':
      os.close(master);master=-1;event('master-closed');time.sleep(1);send(c,{'ack':'closed'});raise EOFError()
except EOFError:pass
finally:
 if master>=0:os.close(master)
 try:status=os.waitpid(pid,os.WNOHANG);event('end',waitpid=status)
 except ChildProcessError:pass
 for c in list(clients):close(c)
 server.close()
 try:os.unlink(path)
 except OSError:pass
