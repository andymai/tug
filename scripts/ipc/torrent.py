"""Writes the .torrent of one small file: torrent.py PATH NAME."""

import sys

path, name = sys.argv[1], sys.argv[2].encode()
info = b"d6:lengthi5e4:name%d:%s12:piece lengthi16384e6:pieces20:%se" % (len(name), name, b"a" * 20)
with open(path, "wb") as out:
    out.write(b"d4:info" + info + b"e")
