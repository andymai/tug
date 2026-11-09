import json
import sys

from gi.repository import Gio, GLib

log = open(sys.argv[1], "w", buffering=1)


def update(conn, sender, path, iface, signal, params):
    uri, properties = params.unpack()
    log.write(json.dumps({"uri": uri, **properties}) + "\n")


bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
bus.signal_subscribe(None, "com.canonical.Unity.LauncherEntry", "Update", None, None,
                     Gio.DBusSignalFlags.NONE, update)
GLib.MainLoop().run()
