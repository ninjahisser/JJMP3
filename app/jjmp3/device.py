"""Connection to the JJMP3 player over USB serial or Wi-Fi (HTTP).

Both transports speak the same JSON command protocol; see firmware/jjmp3/protocol.h.
"""
import json
import threading
import time

import requests
import serial
from serial.tools import list_ports

BAUD = 921600
USB_IDS = {(0x10C4, 0xEA60), (0x1A86, 0x7523), (0x1A86, 0x55D4), (0x303A, 0x1001)}


class LinkError(Exception):
    pass


class SerialLink:
    kind = "usb"

    def __init__(self, port):
        self.port = port
        s = serial.Serial()
        s.port, s.baudrate, s.timeout = port, BAUD, 0.05
        s.dtr = s.rts = False  # don't reset the board when opening
        s.open()
        self.ser = s
        self.buf = b""
        self.next_id = 1

    @property
    def where(self):
        return self.port

    def close(self):
        try:
            self.ser.close()
        except Exception:
            pass

    def _readline(self, timeout):
        end = time.time() + timeout
        while True:
            nl = self.buf.find(b"\n")
            if nl >= 0:
                line, self.buf = self.buf[:nl], self.buf[nl + 1:]
                return line
            if time.time() > end:
                raise LinkError("device did not answer")
            try:
                self.buf += self.ser.read(max(1, self.ser.in_waiting))
            except serial.SerialException as e:
                raise LinkError(str(e))

    def _read_json(self, timeout):
        while True:
            line = self._readline(timeout).strip()
            if line.startswith(b"{"):
                try:
                    return json.loads(line)
                except ValueError:
                    pass

    def _send(self, msg):
        msg["id"] = self.next_id
        self.next_id += 1
        try:
            self.ser.write((json.dumps(msg) + "\n").encode())
        except serial.SerialException as e:
            raise LinkError(str(e))
        return msg["id"]

    def _reply(self, mid, timeout):
        while True:
            r = self._read_json(timeout)
            if r.get("id") == mid:
                return r

    def request(self, cmd, timeout=6, **params):
        return self._reply(self._send({"cmd": cmd, **params}), timeout)

    def put(self, path, data: bytes, progress=None):
        mid = self._send({"cmd": "put", "path": path, "size": len(data)})
        r = self._reply(mid, 8)
        if not r.get("ok"):
            raise LinkError(r.get("error", "upload refused"))
        chunk, off = r.get("chunk", 4096), 0
        while off < len(data):
            self.ser.write(data[off:off + chunk])
            off = min(off + chunk, len(data))
            ack = self._read_json(8)
            if not ack.get("ok", True):
                raise LinkError(ack.get("error", "upload failed"))
            if progress:
                progress(off, len(data))
        done = self._reply(mid, 10)
        if not done.get("ok"):
            raise LinkError(done.get("error", "upload failed"))

    def get(self, path) -> bytes:
        r = self._reply(self._send({"cmd": "get", "path": path}), 8)
        if not r.get("ok"):
            raise LinkError(r.get("error", "not found"))
        n = r["size"]
        data, self.buf = self.buf, b""
        end = time.time() + 10 + n / 50_000
        while len(data) < n:
            if time.time() > end:
                raise LinkError("download timed out")
            data += self.ser.read(n - len(data))
        self.buf = data[n:]
        return data[:n]


class _ProgressBody:
    """File-like request body that reports how much has been sent."""

    def __init__(self, data, progress):
        self.data, self.pos, self.progress = data, 0, progress

    def __len__(self):
        return len(self.data)

    def read(self, n=-1):
        n = len(self.data) - self.pos if n < 0 else n
        chunk = self.data[self.pos:self.pos + n]
        self.pos += len(chunk)
        if self.progress:
            self.progress(self.pos, len(self.data))
        return chunk


class HttpLink:
    kind = "wifi"

    def __init__(self, host):
        self.host = host
        self.base = f"http://{host}"
        self.http = requests.Session()

    @property
    def where(self):
        return self.host

    def close(self):
        self.http.close()

    def request(self, cmd, timeout=6, **params):
        try:
            r = self.http.post(f"{self.base}/cmd", data=json.dumps({"cmd": cmd, **params}), timeout=timeout)
            return r.json()
        except (requests.RequestException, ValueError) as e:
            raise LinkError(str(e))

    def put(self, path, data: bytes, progress=None):
        boundary = "----jjmp3boundary"
        name = path.rsplit("/", 1)[-1]
        head = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\n"
                f"Content-Type: application/octet-stream\r\n\r\n").encode()
        body = head + data + f"\r\n--{boundary}--\r\n".encode()
        try:
            r = self.http.post(f"{self.base}/upload", params={"path": path, "size": len(data)},
                               data=_ProgressBody(body, progress),
                               headers={"Content-Type": f"multipart/form-data; boundary={boundary}",
                                        "Content-Length": str(len(body))},
                               timeout=30 + len(data) / 20_000)
            if r.status_code != 200:
                raise LinkError(f"upload failed ({r.status_code})")
        except requests.RequestException as e:
            raise LinkError(str(e))

    def get(self, path) -> bytes:
        try:
            r = self.http.get(f"{self.base}/file", params={"path": path}, timeout=20)
        except requests.RequestException as e:
            raise LinkError(str(e))
        if r.status_code != 200:
            raise LinkError("not found")
        return r.content


class Device:
    """Finds the player (USB first, then Wi-Fi), keeps a cached status and
    serialises all traffic so the UI poll and file uploads never interleave."""

    def __init__(self, get_wifi_host, set_wifi_host):
        self.lock = threading.RLock()
        self.link = None
        self.status = {}
        self.info = {}
        self.error = ""
        self.on_connect = []  # callbacks(device)
        self._get_host = get_wifi_host
        self._set_host = set_wifi_host
        self._stop = False
        threading.Thread(target=self._run, daemon=True).start()

    # ---- public ----
    @property
    def connected(self):
        return self.link is not None

    def describe(self):
        link = self.link
        return {
            "connected": link is not None,
            "via": link.kind if link else None,
            "where": link.where if link else None,
            "info": self.info,
            "status": self.status,
            "error": self.error,
        }

    def call(self, cmd, timeout=6, **params):
        with self.lock:
            link = self._need_link()
            try:
                r = link.request(cmd, timeout=timeout, **params)
            except LinkError as e:
                self._drop(str(e))
                raise
        if cmd in ("status",):
            self.status = r
        return r

    def put(self, path, data, progress=None):
        with self.lock:
            link = self._need_link()
            try:
                link.put(path, data, progress)
            except LinkError as e:
                self._drop(str(e))
                raise

    def get(self, path):
        with self.lock:
            link = self._need_link()
            try:
                return link.get(path)
            except LinkError as e:
                if "not found" not in str(e):
                    self._drop(str(e))
                raise

    # ---- internals ----
    def _need_link(self):
        if self.link is None:
            raise LinkError("player not connected")
        return self.link

    def _drop(self, why):
        if self.link:
            self.link.close()
        self.link = None
        self.status = {}
        self.error = why

    def _try_usb(self):
        for p in list_ports.comports():
            if (p.vid, p.pid) not in USB_IDS:
                continue
            try:
                link = SerialLink(p.device)
            except (serial.SerialException, OSError):
                continue
            try:
                hello = link.request("hello", timeout=1.5)
                if hello.get("name") == "JJMP3":
                    return link, hello
            except LinkError:
                pass
            link.close()
        return None, None

    def _try_wifi(self):
        for host in [h for h in (self._get_host(), "jjmp3.local") if h]:
            link = HttpLink(host)
            try:
                hello = link.request("hello", timeout=1.5)
                if hello.get("name") == "JJMP3":
                    return link, hello
            except LinkError:
                pass
            link.close()
        return None, None

    def _attach(self, link, hello):
        with self.lock:
            self.link, self.info, self.error = link, hello, ""
        for cb in self.on_connect:
            threading.Thread(target=cb, args=(self,), daemon=True).start()

    def _run(self):
        last_wifi_try = 0
        while not self._stop:
            if self.link is None:
                link, hello = self._try_usb()
                if not link and time.time() - last_wifi_try > 8:
                    last_wifi_try = time.time()
                    link, hello = self._try_wifi()
                if link:
                    self._attach(link, hello)
                time.sleep(1.5)
                continue
            # Prefer USB when it appears while on Wi-Fi
            if self.link.kind == "wifi" and self.lock.acquire(blocking=False):
                try:
                    link, hello = self._try_usb()
                    if link:
                        self.link.close()
                        self.link, self.info = link, hello
                finally:
                    self.lock.release()
            if self.lock.acquire(blocking=False):
                try:
                    st = self.link.request("status", timeout=3) if self.link else None
                    if st:
                        self.status = st
                        ip = (st.get("wifi") or {}).get("ip")
                        if ip and ip != self._get_host():
                            self._set_host(ip)
                except LinkError as e:
                    self._drop(str(e))
                finally:
                    self.lock.release()
            time.sleep(1.0)
