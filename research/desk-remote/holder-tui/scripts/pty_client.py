"""Raw-mode attacher. Ctrl-] is test-client detach; Ctrl-Z is forwarded unchanged."""
import os,sys,socket,termios,tty,selectors,json,base64,signal
path=sys.argv[1];s=socket.socket(socket.AF_UNIX);s.connect(path);old=termios.tcgetattr(0)
def send(o):s.sendall((json.dumps(o)+'\n').encode())
def resize(*_):
 sz=os.get_terminal_size(0);send({'op':'resize','cols':sz.columns,'rows':sz.lines})
sz=os.get_terminal_size(0);send({'op':'attach','cols':sz.columns,'rows':sz.lines});signal.signal(signal.SIGWINCH,resize);sel=selectors.DefaultSelector();sel.register(0,selectors.EVENT_READ);sel.register(s,selectors.EVENT_READ);buf=b''
try:
 tty.setraw(0)
 if len(sys.argv)>2:os.write(1,open(sys.argv[2],'rb').read())
 while True:
  for key,_ in sel.select():
   if key.fileobj==0:
    data=os.read(0,65536)
    if not data or b'\x1d' in data:raise EOFError()
    send({'op':'input','data':base64.b64encode(data).decode()})
   else:
    data=s.recv(65536)
    if not data:raise EOFError()
    buf+=data
    while b'\n' in buf:
     line,buf=buf.split(b'\n',1);m=json.loads(line)
     if 'data' in m:os.write(1,base64.b64decode(m['data']))
except EOFError:pass
finally:
 termios.tcsetattr(0,termios.TCSADRAIN,old);s.close();os.write(1,b'\x1b[?1049l\r\nCLIENT_DETACHED\r\n')
