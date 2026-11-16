#!/usr/bin/python3 -I
"""Checks, from the inside, that Kevin's sandbox is what setup.sh says it is.

    selfcheck.py <socket> [uid-name] [workspace]

Connects to the sandbox socket the way the server does, runs a few commands in
it, and exits non-zero (printing what failed) unless every property holds:
the uid, no network by any route, the hidden parts of the filesystem, a
workspace that is the only writable place, and a time limit that ends a
command which ignores signals and has moved itself to another session.
"""
import json
import socket
import struct
import sys
import time


def run(path, script, seconds=20, stdin=b""):
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(seconds + 30)
    s.connect(path)
    body = script.encode()
    s.sendall(b"KSB1" + struct.pack(">II", seconds, len(body)) + body + struct.pack(">Q", len(stdin)) + stdin)
    out, err, end, buf = b"", b"", None, b""
    while end is None:
        chunk = s.recv(1 << 16)
        if not chunk:
            break
        buf += chunk
        while len(buf) >= 5:
            kind, n = struct.unpack(">BI", buf[:5])
            if len(buf) < 5 + n:
                break
            payload, buf = buf[5:5 + n], buf[5 + n:]
            if kind == 1:
                out += payload
            elif kind == 2:
                err += payload
            elif kind == 3:
                end = json.loads(payload)
    s.close()
    return out.decode(errors="replace"), err.decode(errors="replace"), end


CHECKS = r'''
ok() { echo "PASS $1"; }
bad() { echo "FAIL $1"; }
expect_fail() { name=$1; shift; if "$@" >/dev/null 2>&1; then bad "$name"; else ok "$name"; fi; }
expect_ok() { name=$1; shift; if "$@" >/dev/null 2>&1; then ok "$name"; else bad "$name"; fi; }

[ "$(id -un)" = "__UID__" ] && ok "runs as __UID__" || bad "runs as __UID__ (is $(id -un))"
[ "$(pwd -P)" = "__WS__" ] && ok "starts in the workspace" || bad "starts in the workspace (is $(pwd -P))"

# No network, by any route.
expect_fail "no DNS through the C library" getent hosts example.com
expect_fail "no DNS through the resolver's own socket" resolvectl query example.com
expect_fail "no D-Bus" busctl --system list
expect_fail "no TCP to a public address" bash -c 'exec 3<>/dev/tcp/1.1.1.1/53'
expect_fail "no TCP to this machine's own services" bash -c 'exec 3<>/dev/tcp/127.0.0.1/22'
expect_fail "no UDP" bash -c 'echo x > /dev/udp/1.1.1.1/53'
expect_fail "no raw sockets (ping)" ping -c 1 -W 1 1.1.1.1
# systemd keeps a few folders of its own under /run in the unit; what must be absent is every socket.
[ -z "$(find /run -type s 2>/dev/null | head -1)" ] && ok "no service sockets under /run" || bad "no service sockets under /run (found: $(find /run -type s | head -3 | tr '\n' ' '))"
[ ! -e /run/systemd/resolve ] && [ ! -e /run/dbus ] && ok "the resolver's and D-Bus's folders are absent" || bad "the resolver's and D-Bus's folders are absent"

# Nothing of Ben's, or of the other apps, is there to read.
for d in /var/lib/kevin /srv/benloe /opt/kevin /root /home /etc/benloe /var/backups /var/log; do
  [ -z "$(ls -A "$d" 2>/dev/null)" ] && ok "$d is empty or absent" || bad "$d is empty or absent"
done
[ "$(ls -A /var/lib 2>/dev/null)" = "__WSTOP__" ] && ok "/var/lib holds only the workspace's folder" || bad "/var/lib holds only the workspace's folder (has: $(ls -A /var/lib | tr '\n' ' '))"
[ "$(ls /proc | grep -c '^[0-9]')" -le 12 ] && ok "other processes are not visible" || bad "other processes are not visible ($(ls /proc | grep -c '^[0-9]') pids)"

# The workspace is the only place it can write (besides its private /tmp).
expect_ok "can write in the workspace" bash -c 'echo x > .selfcheck && rm .selfcheck'
for d in /etc /usr/local/lib /var /var/lib /run /srv /opt; do
  expect_fail "cannot write in $d" bash -c "echo x > $d/.selfcheck"
done
expect_fail "cannot become another user" sudo -n true
expect_ok "the tools Kevin is told about are there" bash -c 'python3 -c 1 && jq -n 1 && awk "BEGIN{}" && command -v pdftotext && command -v sed'
'''

# Ignores the signals it can, and starts a helper in a session of its own that does the same.
STUBBORN = r'''
trap '' TERM INT HUP QUIT
setsid bash -c "trap '' TERM INT HUP QUIT; echo \$\$ > .selfcheck.escaped; while :; do sleep 0.2; done" &
echo $$ > .selfcheck.main
while :; do sleep 0.2; done
'''

AFTER = r'''
for f in .selfcheck.main .selfcheck.escaped; do
  pid=$(cat "$f" 2>/dev/null); rm -f "$f"
  [ -n "$pid" ] || { echo "FAIL $f was not written"; continue; }
  echo "PID $pid"
done
'''


def main():
    path = sys.argv[1]
    uid = sys.argv[2] if len(sys.argv) > 2 else "kevin-sh"
    ws = sys.argv[3] if len(sys.argv) > 3 else "/var/lib/kevin-sh/workspace"
    failures = []

    out, err, end = run(path, CHECKS.replace("__UID__", uid).replace("__WS__", ws).replace("__WSTOP__", ws.split("/")[3]))
    lines = [l for l in out.splitlines() if l.startswith(("PASS ", "FAIL "))]
    failures += [l[5:] for l in lines if l.startswith("FAIL ")]
    passed = sum(l.startswith("PASS ") for l in lines)
    if end is None or end.get("code") != 0 or passed + len(failures) < 30:
        failures.append(f"the check script did not run to its end (end: {end}, stderr: {err.strip()[:300]})")

    started = time.monotonic()
    _, _, end = run(path, STUBBORN, seconds=2)
    took = time.monotonic() - started
    if end is None or not end.get("timed_out"):
        failures.append(f"a command that ignores signals was not reported as timed out (end: {end})")
    elif took > 15:
        failures.append(f"the time limit took {took:.0f}s to act on a 2s limit")
    else:
        passed += 1
    out, _, _ = run(path, AFTER)
    pids = [l[4:] for l in out.splitlines() if l.startswith("PID ")]
    failures += [l[5:] for l in out.splitlines() if l.startswith("FAIL ")]

    # The pids are checked from here, outside the sandbox. A pid counts as the old process only if
    # its command line is still that script's (a pid can be reused).
    def lingering():
        found = []
        for pid in pids:
            try:
                cmd = open(f"/proc/{pid}/cmdline", "rb").read().replace(b"\0", b" ").decode(errors="replace")
            except OSError:
                continue
            if "selfcheck" in cmd or "trap" in cmd:
                found.append(f"process {pid} from the timed-out command is still running: {cmd[:80]}")
        return found

    waited = time.monotonic() + 5
    while lingering() and time.monotonic() < waited:
        time.sleep(0.2)
    failures += lingering()
    if len(pids) != 2:
        failures.append(f"the timed-out command did not record its two processes (got {pids})")
    elif not lingering():
        passed += 1

    if failures:
        print("\n".join(f"  - {f}" for f in failures))
        return 1
    print(f"sandbox self-check passed ({passed} checks: uid, no network or resolver, hidden files, read-only outside the workspace, time limit)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except OSError as e:
        print(f"  - could not talk to the sandbox socket: {e}")
        sys.exit(1)
