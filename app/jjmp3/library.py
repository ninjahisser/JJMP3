"""Local music library: track metadata, playlists, settings (one JSON file)."""
import json
import threading
import time
import unicodedata
import uuid

from .paths import ART_DIR, COVER_DIR, DATA_DIR, MEDIA_DIR

LIBRARY_FILE = DATA_DIR / "library.json"


def device_text(s: str) -> str:
    """Plain ASCII for the OLED font (no tabs/newlines, accents folded)."""
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return " ".join(s.replace("\t", " ").split())


class Library:
    def __init__(self):
        self.lock = threading.RLock()
        self.data = {"tracks": {}, "order": [], "playlists": [], "settings": {}}
        if LIBRARY_FILE.exists():
            self.data.update(json.loads(LIBRARY_FILE.read_text("utf-8")))

    def save(self):
        with self.lock:
            tmp = LIBRARY_FILE.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.data, indent=1, ensure_ascii=False), "utf-8")
            tmp.replace(LIBRARY_FILE)

    # ---- tracks ----
    def tracks(self):
        with self.lock:
            return [self.data["tracks"][i] for i in self.data["order"] if i in self.data["tracks"]]

    def get(self, track_id):
        return self.data["tracks"].get(track_id)

    def has(self, track_id):
        return track_id in self.data["tracks"]

    def add(self, track: dict):
        with self.lock:
            track.setdefault("added", time.time())
            self.data["tracks"][track["id"]] = track
            if track["id"] not in self.data["order"]:
                self.data["order"].insert(0, track["id"])  # newest first
            self.save()

    def update(self, track_id, **fields):
        with self.lock:
            t = self.data["tracks"].get(track_id)
            if t:
                t.update(fields)
                self.save()
            return t

    def remove(self, track_id):
        with self.lock:
            self.data["tracks"].pop(track_id, None)
            if track_id in self.data["order"]:
                self.data["order"].remove(track_id)
            for p in self.data["playlists"]:
                p["tracks"] = [t for t in p["tracks"] if t != track_id]
            self.save()
        for f in (MEDIA_DIR / f"{track_id}.mp3", COVER_DIR / f"{track_id}.jpg", ART_DIR / f"{track_id}.bin"):
            f.unlink(missing_ok=True)

    def index_tsv(self, track_ids) -> bytes:
        """The device's index file for the given tracks (library order)."""
        lines = []
        for t in self.tracks():
            if t["id"] in track_ids:
                lines.append("\t".join([
                    t["id"], device_text(t["title"]) or "Untitled",
                    device_text(t.get("artist", "")), str(int(t.get("duration", 0))),
                ]))
        return ("\n".join(lines) + "\n").encode("ascii")

    # ---- playlists ----
    def playlists(self):
        return self.data["playlists"]

    def playlist(self, pid):
        return next((p for p in self.data["playlists"] if p["id"] == pid), None)

    def create_playlist(self, name, tracks=None):
        with self.lock:
            p = {"id": uuid.uuid4().hex[:8], "name": name.strip() or "Untitled", "tracks": list(tracks or []), "created": time.time()}
            self.data["playlists"].append(p)
            self.save()
            return p

    def update_playlist(self, pid, name=None, tracks=None):
        with self.lock:
            p = self.playlist(pid)
            if p is None:
                return None
            if name is not None:
                p["name"] = name.strip() or p["name"]
            if tracks is not None:
                p["tracks"] = [t for t in tracks if t in self.data["tracks"]]
            self.save()
            return p

    def delete_playlist(self, pid):
        with self.lock:
            self.data["playlists"] = [p for p in self.data["playlists"] if p["id"] != pid]
            self.save()

    # ---- settings ----
    def setting(self, key, default=None):
        return self.data["settings"].get(key, default)

    def set_setting(self, key, value):
        with self.lock:
            self.data["settings"][key] = value
            self.save()
