"""Turns YouTube / Spotify links into device-ready tracks.

YouTube: audio is downloaded with yt-dlp.
Spotify: metadata and artwork come from Spotify's public embed pages; the
audio is matched on YouTube (search + duration match), like spotDL does.
Every track is converted to 44.1 kHz stereo 128 kbps CBR MP3 for the player.
"""
import hashlib
import io
import json
import re
import shutil
import subprocess
import threading
import time
import uuid
from collections import deque

import requests
import yt_dlp
from mutagen.mp3 import MP3
from PIL import Image, ImageEnhance, ImageOps

from .paths import ART_DIR, COVER_DIR, MEDIA_DIR, TMP_DIR

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36"}
SPOTIFY_RE = re.compile(r"open\.spotify\.com/(?:intl-[\w-]+/)?(?:embed/)?(track|album|playlist)/([A-Za-z0-9]+)")
NOISE_RE = re.compile(
    r"\s*[\(\[][^\)\]]*(official|video|audio|lyrics?|visuali[sz]er|hd|4k|remaster(ed)?|mv|m/v)[^\)\]]*[\)\]]",
    re.I)


def track_id(key: str) -> str:
    return hashlib.sha1(key.encode()).hexdigest()[:10]


def ydl_opts(**extra):
    opts = {"quiet": True, "no_warnings": True, "noprogress": True,
            "js_runtimes": {"node": {}}, "socket_timeout": 20}
    opts.update(extra)
    return opts


# ---------- artwork ----------

def square(img: Image.Image) -> Image.Image:
    w, h = img.size
    s = min(w, h)
    return img.crop(((w - s) // 2, (h - s) // 2, (w + s) // 2, (h + s) // 2))


def oled_art(img: Image.Image) -> bytes:
    """64x64, Floyd-Steinberg dithered, 1 bit per pixel, MSB first (512 bytes)."""
    g = ImageOps.grayscale(square(img)).resize((64, 64), Image.LANCZOS)
    g = ImageOps.autocontrast(g, cutoff=2)
    g = ImageEnhance.Contrast(g).enhance(1.2)
    return g.convert("1").tobytes()


def art_png(bits: bytes, scale=4) -> bytes:
    img = Image.frombytes("1", (64, 64), bits).convert("L")
    img = img.resize((64 * scale, 64 * scale), Image.NEAREST)
    out = io.BytesIO()
    img.save(out, "PNG")
    return out.getvalue()


def save_artwork(tid, img: Image.Image):
    img = square(img.convert("RGB"))
    img.resize((600, 600), Image.LANCZOS).save(COVER_DIR / f"{tid}.jpg", quality=88)
    (ART_DIR / f"{tid}.bin").write_bytes(oled_art(img))


def fetch_image(url):
    r = requests.get(url, headers=UA, timeout=20)
    r.raise_for_status()
    return Image.open(io.BytesIO(r.content))


# ---------- link resolution ----------

def clean_title(title, uploader=""):
    """'Artist - Title (Official Video)' -> (artist, title)."""
    t = NOISE_RE.sub("", title or "").strip()
    artist = re.sub(r"\s*-\s*Topic$|VEVO$", "", uploader or "").strip()
    m = re.match(r"^(.+?)\s+[-\u2013\u2014]\s+(.+)$", t)
    if m:
        artist, t = m.group(1).strip(), m.group(2).strip()
    return artist, t


def spotify_entity(kind, sid):
    html = requests.get(f"https://open.spotify.com/embed/{kind}/{sid}", headers=UA, timeout=20).text
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.S)
    if not m:
        raise ValueError("Could not read that Spotify link")
    return json.loads(m.group(1))["props"]["pageProps"]["state"]["data"]["entity"]


def best_image(entity):
    imgs = (entity.get("visualIdentity") or {}).get("image") or (entity.get("coverArt") or {}).get("sources") or []
    imgs = sorted(imgs, key=lambda i: i.get("maxWidth") or i.get("width") or 0, reverse=True)
    return imgs[0]["url"] if imgs else None


def resolve(url):
    """-> (collection name or None, [item]) where each item describes one song."""
    m = SPOTIFY_RE.search(url)
    if m:
        kind, sid = m.groups()
        ent = spotify_entity(kind, sid)
        if kind == "track":
            artist = ", ".join(a["name"] for a in ent.get("artists", []))
            return None, [{"key": f"sp:{sid}", "title": ent["title"], "artist": artist,
                           "duration": ent.get("duration", 0) / 1000, "cover": best_image(ent),
                           "source": "spotify", "url": f"https://open.spotify.com/track/{sid}"}]
        cover = best_image(ent) if kind == "album" else None
        items = []
        for t in ent.get("trackList", []):
            tid = t["uri"].rsplit(":", 1)[-1]
            items.append({"key": f"sp:{tid}", "title": t["title"], "artist": t.get("subtitle", ""),
                          "duration": t.get("duration", 0) / 1000, "cover": cover,
                          "spotify_track": tid if not cover else None,
                          "source": "spotify", "url": f"https://open.spotify.com/track/{tid}"})
        return ent.get("title") or ent.get("name"), items

    with yt_dlp.YoutubeDL(ydl_opts(extract_flat="in_playlist")) as ydl:
        info = ydl.extract_info(url, download=False)
    entries = info.get("entries") if info.get("_type") == "playlist" else None
    if entries is not None:
        items = []
        for e in entries:
            if not e or not e.get("id"):
                continue
            artist, title = clean_title(e.get("title"), e.get("uploader") or e.get("channel"))
            items.append({"key": f"yt:{e['id']}", "title": title, "artist": artist,
                          "duration": e.get("duration") or 0, "source": "youtube",
                          "url": e.get("url") or f"https://www.youtube.com/watch?v={e['id']}"})
        return info.get("title"), items
    artist, title = clean_title(info.get("track") or info.get("title"),
                                info.get("artist") or info.get("uploader") or info.get("channel"))
    if info.get("track") and info.get("artist"):
        artist, title = info["artist"], info["track"]
    return None, [{"key": f"yt:{info['id']}", "title": title, "artist": artist,
                   "duration": info.get("duration") or 0, "source": "youtube",
                   "url": info.get("webpage_url") or url}]


def match_on_youtube(item):
    """Best YouTube result for a Spotify song: closest duration among the top hits."""
    query = f"{item['artist']} - {item['title']} audio"
    with yt_dlp.YoutubeDL(ydl_opts(extract_flat=True)) as ydl:
        res = ydl.extract_info(f"ytsearch6:{query}", download=False)
    hits = [e for e in res.get("entries") or [] if e and e.get("id")]
    if not hits:
        raise ValueError("No match found on YouTube")
    target = item.get("duration") or 0
    if target:
        close = [e for e in hits if e.get("duration") and abs(e["duration"] - target) <= 12]
        if close:
            return f"https://www.youtube.com/watch?v={min(close, key=lambda e: abs(e['duration'] - target))['id']}"
    return f"https://www.youtube.com/watch?v={hits[0]['id']}"


# ---------- jobs ----------

class Importer:
    def __init__(self, library, on_track_added):
        self.library = library
        self.on_track_added = on_track_added
        self.jobs = []          # newest first, for the UI
        self.pending = deque()
        self.cv = threading.Condition()
        threading.Thread(target=self._worker, daemon=True).start()

    def snapshot(self):
        return [dict(j) for j in self.jobs[:40]]

    def clear_finished(self):
        self.jobs = [j for j in self.jobs if j["state"] not in ("done", "error", "skipped")]

    def submit(self, url, playlist_id=None):
        job = self._job(url=url, title=url, state="resolving")
        threading.Thread(target=self._resolve, args=(job, playlist_id), daemon=True).start()
        return job

    def _job(self, **kw):
        job = {"id": uuid.uuid4().hex[:8], "progress": 0, "error": "", "created": time.time(), **kw}
        self.jobs.insert(0, job)
        return job

    def _resolve(self, job, playlist_id):
        try:
            name, items = resolve(job["url"])
        except Exception as e:  # noqa: BLE001 - shown to the user
            job.update(state="error", error=short_error(e))
            return
        if not items:
            job.update(state="error", error="Nothing to import from that link")
            return
        self.jobs.remove(job)
        ids = []
        if name and playlist_id is None and len(items) > 1:
            playlist_id = self.library.create_playlist(name)["id"]
        for it in items:
            tid = track_id(it["key"])
            ids.append(tid)
            if self.library.has(tid):
                self._job(url=it["url"], title=it["title"], artist=it["artist"], state="skipped",
                          error="Already in your library", track_id=tid)
                continue
            j = self._job(url=it["url"], title=it["title"], artist=it["artist"], state="queued",
                          item=it, track_id=tid)
            with self.cv:
                self.pending.append(j)
                self.cv.notify()
        if playlist_id:
            p = self.library.playlist(playlist_id)
            if p:
                self.library.update_playlist(playlist_id, tracks=p["tracks"] + [i for i in ids if i not in p["tracks"]])

    def _worker(self):
        while True:
            with self.cv:
                while not self.pending:
                    self.cv.wait()
                job = self.pending.popleft()
            try:
                self._process(job)
                job.update(state="done", progress=1)
            except Exception as e:  # noqa: BLE001
                job.update(state="error", error=short_error(e))
            job.pop("item", None)

    def _process(self, job):
        it, tid = job["item"], job["track_id"]
        tmp = TMP_DIR / tid
        shutil.rmtree(tmp, ignore_errors=True)
        tmp.mkdir(parents=True)
        try:
            src = it["url"]
            if it["source"] == "spotify":
                job.update(state="matching")
                src = match_on_youtube(it)

            def hook(d):
                if d.get("status") == "downloading":
                    total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                    job["progress"] = (d.get("downloaded_bytes", 0) / total) * 0.8 if total else 0

            job.update(state="downloading", progress=0)
            with yt_dlp.YoutubeDL(ydl_opts(format="bestaudio/best", outtmpl=str(tmp / "src.%(ext)s"),
                                           noplaylist=True, progress_hooks=[hook])) as ydl:
                info = ydl.extract_info(src, download=True)
            downloaded = next(tmp.glob("src.*"))

            job.update(state="converting", progress=0.85)
            out = MEDIA_DIR / f"{tid}.mp3"
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(downloaded), "-vn",
                            "-ac", "2", "-ar", "44100", "-b:a", "128k", "-map_metadata", "-1",
                            "-id3v2_version", "0", "-write_xing", "0", str(out)],
                           check=True, capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
            duration = MP3(out).info.length

            job.update(state="artwork", progress=0.95)
            cover = it.get("cover")
            if not cover and it.get("spotify_track"):
                try:
                    cover = best_image(spotify_entity("track", it["spotify_track"]))
                except Exception:  # noqa: BLE001 - fall back to the video thumbnail
                    cover = None
            cover = cover or info.get("thumbnail")
            has_cover = False
            if cover:
                try:
                    save_artwork(tid, fetch_image(cover))
                    has_cover = True
                except Exception:  # noqa: BLE001
                    pass

            self.library.add({
                "id": tid, "title": it["title"] or info.get("title", "Untitled"),
                "artist": it.get("artist") or "", "duration": round(duration),
                "source": it["source"], "url": it["url"], "cover": has_cover,
                "size": out.stat().st_size,
            })
            self.on_track_added(tid)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


def short_error(e):
    msg = str(e).replace("ERROR: ", "").strip()
    return (msg.splitlines() or ["Something went wrong"])[0][:160]
