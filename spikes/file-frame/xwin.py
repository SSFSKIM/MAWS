# The X display's top-level windows, and a picture of the whole screen, through libX11 (the build VM has no X tools).
# A native dialog (a JavaScript alert's message box, a print dialog) is a top-level window of its own: main lists them
# before and after each case of row e.
#   python3 xwin.py list            -> JSON [{id, name, mapped, x, y, width, height}]
#   python3 xwin.py shot <out.png>  -> the root window as a PNG
import ctypes, ctypes.util, json, struct, sys, zlib

x = ctypes.cdll.LoadLibrary(ctypes.util.find_library('X11') or 'libX11.so.6')
x.XOpenDisplay.restype = ctypes.c_void_p
x.XOpenDisplay.argtypes = [ctypes.c_char_p]
x.XDefaultRootWindow.restype = ctypes.c_ulong
x.XDefaultRootWindow.argtypes = [ctypes.c_void_p]

class XWindowAttributes(ctypes.Structure):
    _fields_ = [('x', ctypes.c_int), ('y', ctypes.c_int), ('width', ctypes.c_int), ('height', ctypes.c_int), ('border_width', ctypes.c_int),
                ('depth', ctypes.c_int), ('visual', ctypes.c_void_p), ('root', ctypes.c_ulong), ('class_', ctypes.c_int), ('bit_gravity', ctypes.c_int),
                ('win_gravity', ctypes.c_int), ('backing_store', ctypes.c_int), ('backing_planes', ctypes.c_ulong), ('backing_pixel', ctypes.c_ulong),
                ('save_under', ctypes.c_int), ('colormap', ctypes.c_ulong), ('map_installed', ctypes.c_int), ('map_state', ctypes.c_int),
                ('all_event_masks', ctypes.c_long), ('your_event_mask', ctypes.c_long), ('do_not_propagate_mask', ctypes.c_long),
                ('override_redirect', ctypes.c_int), ('screen', ctypes.c_void_p)]

class XImage(ctypes.Structure):
    _fields_ = [('width', ctypes.c_int), ('height', ctypes.c_int), ('xoffset', ctypes.c_int), ('format', ctypes.c_int), ('data', ctypes.c_void_p),
                ('byte_order', ctypes.c_int), ('bitmap_unit', ctypes.c_int), ('bitmap_bit_order', ctypes.c_int), ('bitmap_pad', ctypes.c_int),
                ('depth', ctypes.c_int), ('bytes_per_line', ctypes.c_int), ('bits_per_pixel', ctypes.c_int)]

x.XQueryTree.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.POINTER(ctypes.c_ulong)), ctypes.POINTER(ctypes.c_uint)]
x.XFetchName.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_char_p)]
x.XGetWindowAttributes.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(XWindowAttributes)]
x.XGetImage.restype = ctypes.POINTER(XImage)
x.XGetImage.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_int, ctypes.c_uint, ctypes.c_uint, ctypes.c_ulong, ctypes.c_int]

d = x.XOpenDisplay(None)
if not d:
    sys.exit('no display')
root = x.XDefaultRootWindow(d)

def windows():
    r, p, kids, n = ctypes.c_ulong(), ctypes.c_ulong(), ctypes.POINTER(ctypes.c_ulong)(), ctypes.c_uint()
    x.XQueryTree(d, root, ctypes.byref(r), ctypes.byref(p), ctypes.byref(kids), ctypes.byref(n))
    out = []
    for i in range(n.value):
        w = kids[i]
        name = ctypes.c_char_p()
        x.XFetchName(d, w, ctypes.byref(name))
        a = XWindowAttributes()
        x.XGetWindowAttributes(d, w, ctypes.byref(a))
        out.append({'id': w, 'name': name.value.decode('utf-8', 'replace') if name.value else None, 'mapped': a.map_state == 2,
                    'x': a.x, 'y': a.y, 'width': a.width, 'height': a.height})
    return out

def shot(path):
    a = XWindowAttributes()
    x.XGetWindowAttributes(d, root, ctypes.byref(a))
    img = x.XGetImage(d, root, 0, 0, a.width, a.height, 0xFFFFFFFF, 2).contents
    w, h, bpl = img.width, img.height, img.bytes_per_line
    raw = ctypes.string_at(img.data, bpl * h)
    rows = bytearray()
    for y in range(h):
        row = raw[y * bpl:y * bpl + w * 4]
        rgb = bytearray(w * 3)
        rgb[0::3], rgb[1::3], rgb[2::3] = row[2::4], row[1::4], row[0::4]
        rows += b'\x00' + rgb
    chunk = lambda t, data: struct.pack('>I', len(data)) + t + data + struct.pack('>I', zlib.crc32(t + data) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(bytes(rows), 6)) + chunk(b'IEND', b''))

if sys.argv[1] == 'list':
    print(json.dumps(windows()))
elif sys.argv[1] == 'shot':
    shot(sys.argv[2])
