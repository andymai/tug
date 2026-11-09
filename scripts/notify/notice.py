import json
import sys

log, index, expected = sys.argv[1], int(sys.argv[2]), json.loads(sys.argv[3])
notices = [entry for entry in map(json.loads, open(log)) if "summary" in entry]
if index >= len(notices):
    sys.exit(f"only {len(notices)} notification(s): {notices}")
notice = notices[index]
for key, value in expected.items():
    actual = notice["hints"].get(key[6:]) if key.startswith("hints.") else notice.get(key)
    if actual != value:
        sys.exit(f"{key}: expected {value!r}, got {actual!r}")
print(notice["id"])
