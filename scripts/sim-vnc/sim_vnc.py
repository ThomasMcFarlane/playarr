#!/usr/bin/env python3
"""A small RFB (VNC) server for one Apple TV simulator.

Frames come only from the simulator (idb's MJPEG video stream, or `xcrun simctl io <udid> screenshot` as the
fallback), never from the runner's desktop. Keys from the viewer become tvOS remote input through `idb ui key`.
Standard library only. The server speaks RFB 3.8 with VNC authentication (the password comes from an environment
variable, never from the command line) and the Tight encoding with JPEG (so any TigerVNC viewer works).

usage: sim_vnc.py --udid <simulator udid> --bind <tailscale address> [--port 5900] [--fps 30]
       PLAYARR_VNC_PASSWORD=... (at most the first 8 characters count: that is a limit of the VNC protocol)
"""
from __future__ import annotations

import argparse
import hmac
import os
import queue
import secrets
import select
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time

# --------------------------------------------------------------------------------------------------------------
# DES, only for the RFB "VNC authentication" challenge (the protocol fixes the cipher; do not reuse elsewhere).
# --------------------------------------------------------------------------------------------------------------
_IP = (58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4, 62, 54, 46, 38, 30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8,
       57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3, 61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7)
_FP = (40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31, 38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29,
       36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27, 34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25)
_E = (32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9, 8, 9, 10, 11, 12, 13, 12, 13, 14, 15, 16, 17,
      16, 17, 18, 19, 20, 21, 20, 21, 22, 23, 24, 25, 24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1)
_P = (16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10, 2, 8, 24, 14, 32, 27, 3, 9, 19, 13, 30, 6, 22, 11, 4, 25)
_PC1 = (57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35, 27, 19, 11, 3, 60, 52, 44, 36,
        63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 28, 20, 12, 4)
_PC2 = (14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10, 23, 19, 12, 4, 26, 8, 16, 7, 27, 20, 13, 2,
        41, 52, 31, 37, 47, 55, 30, 40, 51, 45, 33, 48, 44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32)
_SHIFTS = (1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1)
_SBOX = (
    (14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7, 0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8,
     4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0, 15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13),
    (15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10, 3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5,
     0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15, 13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9),
    (10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8, 13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1,
     13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7, 1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12),
    (7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15, 13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9,
     10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4, 3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14),
    (2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9, 14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6,
     4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14, 11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3),
    (12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11, 10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8,
     9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6, 4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13),
    (4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1, 13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6,
     1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2, 6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12),
    (13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7, 1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2,
     7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8, 2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11),
)


def _bits(data: bytes) -> list[int]:
    return [(byte >> (7 - i)) & 1 for byte in data for i in range(8)]


def _permute(bits: list[int], table: tuple[int, ...]) -> list[int]:
    return [bits[i - 1] for i in table]


def _subkeys(key: bytes) -> list[list[int]]:
    cd = _permute(_bits(key), _PC1)
    c, d = cd[:28], cd[28:]
    keys = []
    for shift in _SHIFTS:
        c, d = c[shift:] + c[:shift], d[shift:] + d[:shift]
        keys.append(_permute(c + d, _PC2))
    return keys


def des_encrypt_block(key: bytes, block: bytes) -> bytes:
    """Plain single DES (ECB) on one 8-byte block."""
    state = _permute(_bits(block), _IP)
    left, right = state[:32], state[32:]
    for sub in _subkeys(key):
        mixed = [a ^ b for a, b in zip(_permute(right, _E), sub)]
        out: list[int] = []
        for box in range(8):
            chunk = mixed[box * 6:box * 6 + 6]
            row = (chunk[0] << 1) | chunk[5]
            col = (chunk[1] << 3) | (chunk[2] << 2) | (chunk[3] << 1) | chunk[4]
            value = _SBOX[box][row * 16 + col]
            out.extend((value >> (3 - i)) & 1 for i in range(4))
        left, right = right, [a ^ b for a, b in zip(left, _permute(out, _P))]
    joined = _permute(right + left, _FP)
    return bytes(int("".join(map(str, joined[i:i + 8])), 2) for i in range(0, 64, 8))


def vnc_key(password: str) -> bytes:
    """The RFB key: the first 8 password bytes (zero padded) with the bits of every byte reversed."""
    raw = password.encode("utf-8")[:8].ljust(8, b"\0")
    return bytes(int(f"{b:08b}"[::-1], 2) for b in raw)


def vnc_response(password: str, challenge: bytes) -> bytes:
    key = vnc_key(password)
    return des_encrypt_block(key, challenge[:8]) + des_encrypt_block(key, challenge[8:16])


def vnc_passwd_file(password: str) -> bytes:
    """The obfuscated `vncpasswd` file format the TigerVNC viewer reads (DES with a fixed key)."""
    fixed = bytes(int(f"{b:08b}"[::-1], 2) for b in bytes([23, 82, 107, 6, 35, 78, 88, 7]))
    return des_encrypt_block(fixed, password.encode("utf-8")[:8].ljust(8, b"\0"))


# --------------------------------------------------------------------------------------------------------------
# Keys: X11 keysyms from the viewer become USB HID keyboard usages, which `idb ui key` sends; tvOS reads a
# hardware keyboard as the remote (arrows move focus, Return selects, Escape is Menu, Space is Play/Pause).
# --------------------------------------------------------------------------------------------------------------
KEYSYM_TO_HID = {
    0xFF52: 82,  # Up
    0xFF54: 81,  # Down
    0xFF51: 80,  # Left
    0xFF53: 79,  # Right
    0xFF0D: 40,  # Return -> select
    0xFF8D: 40,  # keypad Enter -> select
    0xFF1B: 41,  # Escape -> menu
    0xFF08: 41,  # BackSpace -> menu (HID Escape: tvOS has no separate back key on a keyboard)
    0x0020: 44,  # space -> play/pause
}
KEYSYM_NAMES = {82: "up", 81: "down", 80: "left", 79: "right", 40: "select", 41: "menu", 44: "play-pause"}


class KeySender:
    """Runs `idb ui key` one press at a time, in order, off the network threads."""

    def __init__(self, udid: str, idb: str, log):
        self.udid, self.idb, self.log = udid, idb, log
        self.queue: queue.Queue[int] = queue.Queue(maxsize=64)
        self.sent = 0
        self.failed = 0
        threading.Thread(target=self._run, daemon=True).start()

    def press(self, usage: int) -> None:
        try:
            self.queue.put_nowait(usage)
        except queue.Full:
            pass  # a held key outruns the simulator: drop repeats rather than lag behind

    def _run(self) -> None:
        while True:
            usage = self.queue.get()
            try:
                subprocess.run([self.idb, "ui", "key", "--udid", self.udid, str(usage)], check=True, timeout=20,
                               stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                self.sent += 1
            except (subprocess.SubprocessError, OSError) as error:
                self.failed += 1
                detail = getattr(error, "stderr", b"") or b""
                if self.failed <= 5 or self.failed % 50 == 0:
                    self.log(f"key press failed ({KEYSYM_NAMES.get(usage, usage)}): {type(error).__name__} {detail[-200:].decode('utf-8', 'replace')}")


# --------------------------------------------------------------------------------------------------------------
# Frames
# --------------------------------------------------------------------------------------------------------------
def jpeg_size(data: bytes) -> tuple[int, int]:
    """(width, height) from the first SOFn marker of a baseline or progressive JPEG."""
    i = 2
    while i + 9 < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xC0, 0xC1, 0xC2):
            height, width = struct.unpack(">HH", data[i + 5:i + 9])
            return width, height
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7 or marker == 0xFF:
            i += 1 if marker == 0xFF else 2
            continue
        i += 2 + struct.unpack(">H", data[i + 2:i + 4])[0]
    raise ValueError("no JPEG frame header found")


class FrameHub:
    """Holds the newest JPEG frame; viewers wait on it."""

    def __init__(self):
        self.cond = threading.Condition()
        self.seq = 0
        self.jpeg = b""
        self.size = (0, 0)
        self.count = 0
        self.started = time.monotonic()
        self.source = "none"

    def publish(self, jpeg: bytes) -> None:
        try:
            size = jpeg_size(jpeg)
        except ValueError:
            return
        with self.cond:
            self.jpeg, self.size = jpeg, size
            self.seq += 1
            self.count += 1
            self.cond.notify_all()

    def fps(self) -> float:
        return self.count / max(time.monotonic() - self.started, 1e-6)


def run_idb_stream(hub: FrameHub, udid: str, idb: str, fps: int, log, stop: threading.Event) -> None:
    """Reads concatenated JPEG frames from `idb video-stream --format mjpeg`."""
    proc = subprocess.Popen([idb, "video-stream", "--udid", udid, "--fps", str(fps), "--format", "mjpeg"],
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    hub.source = "idb"
    buf = b""
    try:
        while not stop.is_set():
            chunk = proc.stdout.read1(1 << 20)
            if not chunk:
                break
            buf += chunk
            while True:
                start = buf.find(b"\xff\xd8")
                if start < 0:
                    buf = b""
                    break
                end = buf.find(b"\xff\xd9\xff\xd8", start + 2)
                if end < 0:
                    buf = buf[start:]
                    break
                hub.publish(buf[start:end + 2])
                buf = buf[end + 2:]
    finally:
        proc.kill()
    log("idb video stream ended")


def run_simctl_loop(hub: FrameHub, udid: str, fps: int, log, stop: threading.Event) -> None:
    """Fallback: JPEG screenshots from `xcrun simctl io <udid> screenshot`, as fast as the simulator answers."""
    hub.source = "simctl"
    path = os.path.join(tempfile.mkdtemp(prefix="sim-vnc-"), "frame.jpg")
    delay = 1.0 / fps
    failures = 0
    while not stop.is_set():
        began = time.monotonic()
        try:
            subprocess.run(["xcrun", "simctl", "io", udid, "screenshot", "--type=jpeg", path], check=True, timeout=15,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            with open(path, "rb") as handle:
                hub.publish(handle.read())
            failures = 0
        except (subprocess.SubprocessError, OSError) as error:
            failures += 1
            if failures in (1, 10, 100):
                log(f"screenshot failed ({failures}): {type(error).__name__}")
            time.sleep(1)
        time.sleep(max(0.0, delay - (time.monotonic() - began)))


def run_file_source(hub: FrameHub, path: str, fps: int, stop: threading.Event) -> None:
    """Test source: republishes one JPEG file."""
    hub.source = "file"
    while not stop.is_set():
        with open(path, "rb") as handle:
            hub.publish(handle.read())
        time.sleep(1.0 / fps)


def start_frames(hub: FrameHub, args, log, stop: threading.Event) -> None:
    if args.frame_file:
        threading.Thread(target=run_file_source, args=(hub, args.frame_file, args.fps, stop), daemon=True).start()
        return

    def run():
        if args.source in ("auto", "idb"):
            run_idb_stream(hub, args.udid, args.idb, args.fps, log, stop)
            if args.source == "idb" or hub.count > 0 and not stop.is_set():
                return
            log("no frames from idb; falling back to simctl screenshots")
        run_simctl_loop(hub, args.udid, args.fps, log, stop)

    threading.Thread(target=run, daemon=True).start()


# --------------------------------------------------------------------------------------------------------------
# RFB
# --------------------------------------------------------------------------------------------------------------
def read_exact(sock: socket.socket, count: int) -> bytes:
    data = bytearray()
    while len(data) < count:
        chunk = sock.recv(count - len(data))
        if not chunk:
            raise ConnectionError("client closed the connection")
        data += chunk
    return bytes(data)


def compact_length(length: int) -> bytes:
    if length < 128:
        return bytes([length])
    if length < 16384:
        return bytes([(length & 0x7F) | 0x80, length >> 7])
    return bytes([(length & 0x7F) | 0x80, ((length >> 7) & 0x7F) | 0x80, length >> 14])


class Client(threading.Thread):
    def __init__(self, sock, addr, server):
        super().__init__(daemon=True)
        self.sock, self.addr, self.server = sock, addr, server
        self.wlock = threading.Lock()
        self.request = threading.Event()
        self.jpeg_ok = False
        self.alive = True

    def log(self, message):
        self.server.log(f"[{self.addr[0]}] {message}")

    def send(self, data: bytes) -> None:
        with self.wlock:
            self.sock.sendall(data)

    def handshake(self) -> None:
        sock = self.sock
        sock.sendall(b"RFB 003.008\n")
        version = read_exact(sock, 12)
        if not version.startswith(b"RFB 003.00") or version[10:11] not in (b"7", b"8"):
            raise ConnectionError("unsupported RFB version")
        sock.sendall(bytes([1, 2]))  # one security type: VNC authentication
        if read_exact(sock, 1) != b"\x02":
            raise ConnectionError("client refused VNC authentication")
        challenge = secrets.token_bytes(16)
        sock.sendall(challenge)
        answer = read_exact(sock, 16)
        if not hmac.compare_digest(answer, vnc_response(self.server.password, challenge)):
            reason = b"Authentication failed"
            sock.sendall(struct.pack(">I", 1) + struct.pack(">I", len(reason)) + reason)
            raise ConnectionError("authentication failed")
        sock.sendall(struct.pack(">I", 0))
        read_exact(sock, 1)  # ClientInit (shared flag)
        hub = self.server.hub
        with hub.cond:
            hub.cond.wait_for(lambda: hub.seq > 0, timeout=60)
            width, height = hub.size
        if not width:
            raise ConnectionError("simulator produced no frame")
        self.size = (width, height)
        name = b"Playarr tvOS simulator"
        pixel_format = struct.pack(">BBBBHHHBBBxxx", 32, 24, 0, 1, 255, 255, 255, 16, 8, 0)
        sock.sendall(struct.pack(">HH", width, height) + pixel_format + struct.pack(">I", len(name)) + name)

    def run(self) -> None:
        try:
            self.handshake()
            self.log(f"viewer connected, {self.size[0]}x{self.size[1]}")
            threading.Thread(target=self.pump, daemon=True).start()
            self.read_messages()
        except (ConnectionError, OSError) as error:
            self.log(f"viewer left: {error}")
        finally:
            self.alive = False
            self.request.set()
            try:
                self.sock.close()
            except OSError:
                pass

    def read_messages(self) -> None:
        sock = self.sock
        held: set[int] = set()
        while True:
            kind = read_exact(sock, 1)[0]
            if kind == 0:  # SetPixelFormat (ignored: Tight/JPEG carries its own colour)
                read_exact(sock, 19)
            elif kind == 2:  # SetEncodings
                count = struct.unpack(">xH", read_exact(sock, 3))[0]
                encodings = struct.unpack(f">{count}i", read_exact(sock, 4 * count)) if count else ()
                self.jpeg_ok = 7 in encodings and any(-32 <= e <= -23 for e in encodings)
                if not self.jpeg_ok:
                    self.log("the viewer does not offer Tight with JPEG; use a TigerVNC viewer")
            elif kind == 3:  # FramebufferUpdateRequest
                read_exact(sock, 9)
                self.request.set()
            elif kind == 4:  # KeyEvent
                down, keysym = struct.unpack(">B2xI", read_exact(sock, 7))
                usage = KEYSYM_TO_HID.get(keysym)
                if usage is not None and down:
                    self.server.keys.press(usage)
                    held.add(keysym)
                elif not down:
                    held.discard(keysym)
            elif kind == 5:  # PointerEvent (a TV remote has no pointer)
                read_exact(sock, 5)
            elif kind == 6:  # ClientCutText
                length = struct.unpack(">3xI", read_exact(sock, 7))[0]
                read_exact(sock, min(length, 1 << 20))
            else:
                raise ConnectionError(f"unknown client message {kind}")

    def pump(self) -> None:
        hub = self.server.hub
        last = 0
        while self.alive:
            self.request.wait()
            if not self.alive:
                return
            with hub.cond:
                hub.cond.wait_for(lambda: hub.seq != last or not self.alive, timeout=5)
                seq, jpeg, size = hub.seq, hub.jpeg, hub.size
            if not self.alive:
                return
            if seq == last:
                continue  # nothing new: keep the request pending
            if size != self.size or not self.jpeg_ok:
                time.sleep(0.2)  # cannot show this frame (size changed or no JPEG support): hold the request
                continue
            self.request.clear()
            last = seq
            rect = struct.pack(">HHHHi", 0, 0, size[0], size[1], 7) + b"\x90" + compact_length(len(jpeg)) + jpeg
            try:
                self.send(struct.pack(">BxH", 0, 1) + rect)
            except OSError:
                return


class Server:
    def __init__(self, args):
        self.args = args
        self.password = os.environ.get(args.password_env, "")
        if not self.password:
            sys.exit(f"{args.password_env} is not set: refusing to serve without a password")
        self.hub = FrameHub()
        self.stop = threading.Event()
        self.keys = KeySender(args.udid, args.idb, self.log) if not args.no_keys else _NoKeys()

    def log(self, message: str) -> None:
        print(f"{time.strftime('%H:%M:%S')} {message}", flush=True)

    def serve(self) -> None:
        start_frames(self.hub, self.args, self.log, self.stop)
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind((self.args.bind, self.args.port))
        listener.listen(4)
        self.port = listener.getsockname()[1]
        self.log(f"listening on {self.args.bind}:{self.port}")
        threading.Thread(target=self.stats, daemon=True).start()
        if self.args.ready_file:
            with open(self.args.ready_file, "w", encoding="utf-8") as handle:
                handle.write(f"{self.args.bind}:{self.port}\n")
        while True:
            sock, addr = listener.accept()
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            sock.settimeout(None)
            Client(sock, addr, self).start()

    def stats(self) -> None:
        while True:
            time.sleep(60)
            self.log(f"source={self.hub.source} frames={self.hub.count} avg_fps={self.hub.fps():.1f} "
                     f"keys_sent={getattr(self.keys, 'sent', 0)} keys_failed={getattr(self.keys, 'failed', 0)}")


class _NoKeys:
    sent = failed = 0

    def press(self, usage: int) -> None:
        pass


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--udid", default="", help="simulator UDID")
    parser.add_argument("--bind", required=True, help="address to listen on (the tailscale address)")
    parser.add_argument("--port", type=int, default=5900)
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--source", choices=("auto", "idb", "simctl"), default="auto")
    parser.add_argument("--idb", default="idb", help="path of the idb client")
    parser.add_argument("--password-env", default="PLAYARR_VNC_PASSWORD")
    parser.add_argument("--ready-file", default="", help="written with host:port once listening")
    parser.add_argument("--frame-file", default="", help="test only: serve this JPEG instead of a simulator")
    parser.add_argument("--no-keys", action="store_true", help="test only: do not call idb for keys")
    args = parser.parse_args()
    if not args.udid and not args.frame_file:
        parser.error("--udid is required")
    if args.bind in ("0.0.0.0", "::", ""):
        parser.error("--bind must be one interface address, never a wildcard")
    Server(args).serve()


if __name__ == "__main__":
    main()
