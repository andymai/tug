import json
import sys

from gi.repository import Gio, GLib

NOTIFICATIONS = """<node><interface name="org.freedesktop.Notifications">
<method name="Notify">
  <arg type="s" direction="in"/><arg type="u" direction="in"/><arg type="s" direction="in"/>
  <arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="as" direction="in"/>
  <arg type="a{sv}" direction="in"/><arg type="i" direction="in"/><arg type="u" direction="out"/>
</method>
<method name="GetCapabilities"><arg type="as" direction="out"/></method>
<method name="GetServerInformation">
  <arg type="s" direction="out"/><arg type="s" direction="out"/><arg type="s" direction="out"/><arg type="s" direction="out"/>
</method>
<method name="CloseNotification"><arg type="u" direction="in"/></method>
<signal name="ActionInvoked"><arg type="u"/><arg type="s"/></signal>
</interface>
<interface name="io.github.andymai.Tug.Test">
<method name="Invoke"><arg type="u" direction="in"/><arg type="s" direction="in"/></method>
</interface></node>"""

FILE_MANAGER = """<node><interface name="org.freedesktop.FileManager1">
<method name="ShowItems"><arg type="as" direction="in"/><arg type="s" direction="in"/></method>
</interface></node>"""

log = open(sys.argv[1], "w", buffering=1)
count = [0]


def notifications(conn, sender, path, iface, method, params, inv):
    if method == "Notify":
        app, _, icon, summary, body, actions, hints, _ = params.unpack()
        count[0] += 1
        log.write(json.dumps({"id": count[0], "app": app, "icon": icon, "summary": summary, "body": body,
                              "actions": actions, "hints": hints}) + "\n")
        inv.return_value(GLib.Variant("(u)", (count[0],)))
    elif method == "GetCapabilities":
        inv.return_value(GLib.Variant("(as)", (["actions", "body", "body-markup"],)))
    elif method == "GetServerInformation":
        inv.return_value(GLib.Variant("(ssss)", ("stand-in", "tug", "1", "1.2")))
    elif method == "Invoke":
        conn.emit_signal(None, "/org/freedesktop/Notifications", "org.freedesktop.Notifications",
                         "ActionInvoked", params)
        inv.return_value(None)
    else:
        inv.return_value(None)


def file_manager(conn, sender, path, iface, method, params, inv):
    uris, _ = params.unpack()
    log.write(json.dumps({"show_items": uris}) + "\n")
    inv.return_value(None)


def own(name, path, xml, call):
    def acquired(conn, _):
        for info in Gio.DBusNodeInfo.new_for_xml(xml).interfaces:
            conn.register_object(path, info, call, None, None)
    Gio.bus_own_name(Gio.BusType.SESSION, name, Gio.BusNameOwnerFlags.NONE, None, acquired, None)


own("org.freedesktop.Notifications", "/org/freedesktop/Notifications", NOTIFICATIONS, notifications)
own("org.freedesktop.FileManager1", "/org/freedesktop/FileManager1", FILE_MANAGER, file_manager)
GLib.MainLoop().run()
