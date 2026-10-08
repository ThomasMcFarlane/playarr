#!/usr/bin/env python3
"""Tests for sim_vnc.py: the DES vectors, then a real RFB session over a socket with a fixed frame."""
import base64
import os
import struct
import subprocess
import sys
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sim_vnc  # noqa: E402

# A 64x36 JPEG, so the test needs no image library.
TINY_JPEG = base64.b64decode("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAkAEADASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAAAAQG/8QAGBABAQEBAQAAAAAAAAAAAAAAABNhARL/xAAVAQEBAAAAAAAAAAAAAAAAAAAABP/EABURAQEAAAAAAAAAAAAAAAAAAAAT/9oADAMBAAIRAxEAPwDKSwli6WEsKE0MsJYulhLChNDLCWLpYSwoTQywli6WEsKE10iS6WEsQUWzQyJLpYSwoTQyJLpYSwoTQyJLpYSwoTW+eHngJVJ54eeAB54eeAB54eeAD//Z")


def read_exact(sock, count):
    return sim_vnc.read_exact(sock, count)


class DesTest(unittest.TestCase):
    def test_fips_vector(self):
        key = bytes.fromhex("133457799BBCDFF1")
        self.assertEqual(sim_vnc.des_encrypt_block(key, bytes.fromhex("0123456789ABCDEF")).hex().upper(), "85E813540F0AB405")

    def test_vncpasswd_file_matches_the_tigervnc_format(self):
        # "password" obfuscated with the fixed key is the well-known 'd6 7b 4e 0c ...' vncpasswd content.
        self.assertEqual(sim_vnc.vnc_passwd_file("password").hex(), "dbd83cfd727a1458")

    def test_jpeg_size(self):
        self.assertEqual(sim_vnc.jpeg_size(TINY_JPEG), (64, 36))


class SessionTest(unittest.TestCase):
    def setUp(self):
        self.frame = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
        self.frame.write(TINY_JPEG)
        self.frame.close()
        self.ready = self.frame.name + ".ready"
        env = dict(os.environ, PLAYARR_VNC_PASSWORD="s3cretPW-ignored-after-8")
        self.proc = subprocess.Popen([sys.executable, os.path.join(HERE, "sim_vnc.py"), "--bind", "127.0.0.1", "--port", "0",
                                      "--frame-file", self.frame.name, "--no-keys", "--ready-file", self.ready, "--fps", "20"],
                                     env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        for _ in range(100):
            if os.path.exists(self.ready) and open(self.ready).read().strip():
                break
            time.sleep(0.05)
        self.host, port = open(self.ready).read().strip().split(":")
        self.port = int(port)

    def tearDown(self):
        self.proc.kill()
        self.proc.wait()
        os.unlink(self.frame.name)
        if os.path.exists(self.ready):
            os.unlink(self.ready)

    def connect(self, password):
        import socket
        sock = socket.create_connection((self.host, self.port), timeout=10)
        self.assertEqual(read_exact(sock, 12), b"RFB 003.008\n")
        sock.sendall(b"RFB 003.008\n")
        self.assertEqual(read_exact(sock, 2), bytes([1, 2]))
        sock.sendall(b"\x02")
        challenge = read_exact(sock, 16)
        sock.sendall(sim_vnc.vnc_response(password, challenge))
        return sock

    def test_wrong_password_is_refused(self):
        sock = self.connect("wrongpass")
        self.assertEqual(struct.unpack(">I", read_exact(sock, 4))[0], 1)

    def test_frame_and_keys(self):
        sock = self.connect("s3cretPW")  # only the first 8 characters count
        self.assertEqual(struct.unpack(">I", read_exact(sock, 4))[0], 0)
        sock.sendall(b"\x01")
        width, height = struct.unpack(">HH", read_exact(sock, 4))
        self.assertEqual((width, height), (64, 36))
        read_exact(sock, 16)
        name_length = struct.unpack(">I", read_exact(sock, 4))[0]
        self.assertEqual(read_exact(sock, name_length), b"Playarr tvOS simulator")
        sock.sendall(struct.pack(">BxHiii", 2, 3, 7, -26, 0))  # Tight, JPEG quality 6, Raw
        sock.sendall(struct.pack(">BBHHHH", 3, 0, 0, 0, 64, 36))
        header = read_exact(sock, 4)
        self.assertEqual(header[0], 0)
        self.assertEqual(struct.unpack(">H", header[2:])[0], 1)
        x, y, w, h, enc = struct.unpack(">HHHHi", read_exact(sock, 12))
        self.assertEqual((x, y, w, h, enc), (0, 0, 64, 36, 7))
        self.assertEqual(read_exact(sock, 1), b"\x90")
        first = read_exact(sock, 1)[0]
        length = first & 0x7F
        if first & 0x80:
            second = read_exact(sock, 1)[0]
            length |= (second & 0x7F) << 7
            if second & 0x80:
                length |= read_exact(sock, 1)[0] << 14
        self.assertEqual(read_exact(sock, length), TINY_JPEG)
        sock.sendall(struct.pack(">BBxxI", 4, 1, 0xFF52))  # Up arrow: accepted without closing the session
        sock.sendall(struct.pack(">BBHHHH", 3, 1, 0, 0, 64, 36))
        self.assertEqual(read_exact(sock, 1)[0], 0)

    def test_wildcard_bind_is_refused(self):
        result = subprocess.run([sys.executable, os.path.join(HERE, "sim_vnc.py"), "--bind", "0.0.0.0", "--udid", "x"],
                                env=dict(os.environ, PLAYARR_VNC_PASSWORD="x"), capture_output=True)
        self.assertNotEqual(result.returncode, 0)

    def test_no_password_means_no_server(self):
        env = {k: v for k, v in os.environ.items() if k != "PLAYARR_VNC_PASSWORD"}
        result = subprocess.run([sys.executable, os.path.join(HERE, "sim_vnc.py"), "--bind", "127.0.0.1", "--udid", "x"],
                                env=env, capture_output=True)
        self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
