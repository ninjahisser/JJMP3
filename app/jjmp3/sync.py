"""Keeps the player's SD card in step with the local library."""
import threading
import time

from .device import LinkError
from .library import device_text
from .paths import ART_DIR, MEDIA_DIR


def parse_index(text):
    tracks = {}
    for line in text.splitlines():
        parts = line.split("\t")
        if len(parts) >= 2 and parts[0]:
            tracks[parts[0]] = {
                "id": parts[0], "title": parts[1], "artist": parts[2] if len(parts) > 2 else "",
                "duration": int(parts[3]) if len(parts) > 3 and parts[3].isdigit() else 0,
            }
    return tracks


class Sync:
    def __init__(self, library, device):
        self.library = library
        self.device = device
        self.on_device = {}       # id -> index entry, as last read from / written to the card
        self.loaded = False
        self.progress = {}        # id -> 0..1 while uploading
        self.removals = set()
        self.index_dirty = False
        self.error = ""
        self.wake = threading.Event()
        device.on_connect.append(self._on_connect)
        threading.Thread(target=self._run, daemon=True).start()

    def kick(self, index_changed=False):
        self.index_dirty |= index_changed
        self.wake.set()

    def remove(self, track_id):
        self.removals.add(track_id)
        self.kick()

    def device_only(self):
        """Tracks on the card that this computer has no copy of."""
        return [dict(t, device_only=True) for tid, t in self.on_device.items() if not self.library.has(tid)]

    def _on_connect(self, device):
        try:
            text = device.get("/index.tsv").decode("ascii", "replace")
        except LinkError:
            text = ""
        self.on_device = parse_index(text)
        self.loaded = True
        self.kick()

    def _run(self):
        while True:
            self.wake.wait(timeout=5)
            self.wake.clear()
            if not (self.device.connected and self.loaded):
                continue
            try:
                self._sync()
                self.error = ""
            except LinkError as e:
                self.error = str(e)
                self.loaded = False
            self.progress.clear()

    def _sync(self):
        changed = self.index_dirty
        self.index_dirty = False

        for tid in list(self.removals):
            for path in (f"/music/{tid}.mp3", f"/art/{tid}.bin"):
                try:
                    self.device.call("rm", path=path)
                except LinkError:
                    raise
            self.on_device.pop(tid, None)
            self.removals.discard(tid)
            changed = True
        if changed:
            self._write_index()

        for t in self.library.tracks():
            tid = t["id"]
            mp3 = MEDIA_DIR / f"{tid}.mp3"
            if tid in self.on_device or not mp3.exists():
                continue
            self.progress[tid] = 0.0
            data = mp3.read_bytes()
            self.device.put(f"/music/{tid}.mp3", data,
                            lambda done, total, tid=tid: self.progress.__setitem__(tid, done / total * 0.98))
            art = ART_DIR / f"{tid}.bin"
            if art.exists():
                self.device.put(f"/art/{tid}.bin", art.read_bytes())
            self.on_device[tid] = {"id": tid, "title": device_text(t["title"]),
                                   "artist": device_text(t.get("artist", "")), "duration": t.get("duration", 0)}
            self._write_index()
            self.progress.pop(tid, None)

    def _write_index(self):
        known = self.library.index_tsv(set(self.on_device))
        extra = "".join(f"{t['id']}\t{t['title']}\t{t['artist']}\t{t['duration']}\n"
                        for t in self.device_only())
        self.device.put("/index.tsv", known + extra.encode("ascii", "ignore"))
        self.device.call("reload")
