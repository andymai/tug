import json
import struct
import subprocess
import sys

host, messages = sys.argv[1], sys.argv[2:]
framed = b"".join(struct.pack("=I", len(m.encode())) + m.encode() for m in messages)
out = subprocess.run([host], input=framed, capture_output=True, check=True).stdout
while out:
    (length,) = struct.unpack("=I", out[:4])
    print(json.dumps(json.loads(out[4 : 4 + length]), sort_keys=True))
    out = out[4 + length :]
