import ctypes, sys

x = ctypes.cdll.LoadLibrary("libX11.so.6")
x.XOpenDisplay.restype = ctypes.c_void_p
x.XInternAtom.restype = ctypes.c_ulong
x.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
display = x.XOpenDisplay(None)
window = int(sys.argv[1])


class ClientMessage(ctypes.Structure):
    _fields_ = [("type", ctypes.c_int), ("serial", ctypes.c_ulong), ("send_event", ctypes.c_int),
                ("display", ctypes.c_void_p), ("window", ctypes.c_ulong), ("message_type", ctypes.c_ulong),
                ("format", ctypes.c_int), ("data", ctypes.c_long * 5)]


class XEvent(ctypes.Union):
    _fields_ = [("xclient", ClientMessage), ("pad", ctypes.c_long * 24)]


event = XEvent()
event.xclient.type = 33
event.xclient.window = window
event.xclient.message_type = x.XInternAtom(display, b"WM_PROTOCOLS", 0)
event.xclient.format = 32
event.xclient.data[0] = x.XInternAtom(display, b"WM_DELETE_WINDOW", 0)
x.XSendEvent.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_long, ctypes.c_void_p]
x.XSendEvent(display, window, 0, 0, ctypes.byref(event))
x.XFlush(ctypes.c_void_p(display))
