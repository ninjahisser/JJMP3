"""Local web server: JSON API for the UI plus the static front-end."""
import base64
import io
import threading

from fastapi import Body, FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image

from .device import Device, LinkError
from .importer import Importer, art_png
from .library import Library
from .paths import ART_DIR, COVER_DIR, STATIC_DIR
from .sync import Sync

library = Library()
device = Device(lambda: library.setting("wifi_host"), lambda h: library.set_setting("wifi_host", h))
sync = Sync(library, device)
importer = Importer(library, lambda tid: sync.kick())

app = FastAPI(title="JJMP3")


@app.middleware("http")
async def no_stale_ui(request, call_next):
    response = await call_next(request)
    if not request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-cache"  # always pick up a new app.js / app.css
    return response


def device_call(cmd, timeout=6, **params):
    try:
        r = device.call(cmd, timeout=timeout, **params)
    except LinkError as e:
        raise HTTPException(503, str(e))
    if not r.get("ok", True):
        raise HTTPException(400, r.get("error", "device error"))
    return r


# ---------- state ----------

@app.get("/api/state")
def state():
    tracks = []
    for t in library.tracks():
        tracks.append(dict(t, on_device=t["id"] in sync.on_device, uploading=sync.progress.get(t["id"])))
    tracks += sync.device_only()
    return {
        "device": device.describe(),
        "sync": {"loaded": sync.loaded, "error": sync.error, "busy": bool(sync.progress)},
        "tracks": tracks,
        "playlists": library.playlists(),
        "jobs": importer.snapshot(),
    }


# ---------- import ----------

@app.post("/api/import")
def import_link(url: str = Body(..., embed=True), playlist_id: str | None = Body(None, embed=True)):
    url = url.strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(400, "Paste a full YouTube or Spotify link")
    return importer.submit(url, playlist_id)


@app.post("/api/jobs/clear")
def clear_jobs():
    importer.clear_finished()
    return {"ok": True}


# ---------- tracks ----------

@app.patch("/api/tracks/{tid}")
def edit_track(tid: str, title: str | None = Body(None), artist: str | None = Body(None)):
    fields = {k: v.strip() for k, v in (("title", title), ("artist", artist)) if v is not None}
    t = library.update(tid, **fields)
    if not t:
        raise HTTPException(404, "No such track")
    sync.kick(index_changed=True)
    return t


@app.delete("/api/tracks/{tid}")
def delete_track(tid: str):
    library.remove(tid)
    sync.remove(tid)
    return {"ok": True}


@app.get("/api/cover/{tid}")
def cover(tid: str):
    f = COVER_DIR / f"{tid}.jpg"
    if not f.exists():
        raise HTTPException(404)
    return FileResponse(f, headers={"Cache-Control": "max-age=86400"})


@app.get("/api/art/{tid}")
def art(tid: str):
    f = ART_DIR / f"{tid}.bin"
    if not f.exists():
        raise HTTPException(404)
    return Response(art_png(f.read_bytes()), media_type="image/png")


# ---------- playlists ----------

@app.post("/api/playlists")
def new_playlist(name: str = Body(..., embed=True), tracks: list[str] = Body([], embed=True)):
    return library.create_playlist(name, tracks)


@app.patch("/api/playlists/{pid}")
def edit_playlist(pid: str, name: str | None = Body(None), tracks: list[str] | None = Body(None)):
    p = library.update_playlist(pid, name, tracks)
    if not p:
        raise HTTPException(404, "No such playlist")
    return p


@app.delete("/api/playlists/{pid}")
def delete_playlist(pid: str):
    library.delete_playlist(pid)
    return {"ok": True}


# ---------- playback ----------

@app.post("/api/play")
def play(track_id: str | None = Body(None), playlist_id: str | None = Body(None), shuffle: bool = Body(False)):
    if playlist_id:
        p = library.playlist(playlist_id)
        if not p:
            raise HTTPException(404, "No such playlist")
        ids = p["tracks"]
    else:
        ids = [t["id"] for t in library.tracks()] + [t["id"] for t in sync.device_only()]
    ids = [i for i in ids if i in sync.on_device]
    if not ids:
        raise HTTPException(400, "Nothing on the player yet - wait for the upload to finish")
    index = ids.index(track_id) if track_id in ids else 0
    if shuffle:
        device_call("mode", shuffle=True)
    return device_call("play", queue=ids, index=index)


@app.post("/api/control/{cmd}")
def control(cmd: str, params: dict = Body({})):
    if cmd not in {"toggle", "play", "pause", "next", "prev", "seek", "vol", "mode"}:
        raise HTTPException(400, "Unknown control")
    return device_call(cmd, **params)


@app.get("/api/screen")
def screen():
    """The OLED framebuffer as a PNG (SSD1306 page layout -> pixels)."""
    r = device_call("screen", timeout=3)
    buf = base64.b64decode(r["b64"])
    img = Image.new("1", (128, 64))
    px = img.load()
    for page in range(8):
        for x in range(128):
            byte = buf[page * 128 + x]
            for bit in range(8):
                if byte >> bit & 1:
                    px[x, page * 8 + bit] = 1
    out = io.BytesIO()
    img.save(out, "PNG")
    return Response(out.getvalue(), media_type="image/png", headers={"Cache-Control": "no-store"})


# ---------- Wi-Fi / Bluetooth ----------

@app.post("/api/wifi/scan")
def wifi_scan():
    return device_call("wifi_scan", timeout=15)


@app.post("/api/wifi")
def wifi_set(ssid: str = Body(...), password: str = Body("")):
    return device_call("wifi_set", ssid=ssid, **{"pass": password})


@app.post("/api/wifi/forget")
def wifi_forget():
    library.set_setting("wifi_host", None)
    return device_call("wifi_forget")


@app.post("/api/bt/scan")
def bt_scan():
    return device_call("bt_scan")


@app.post("/api/bt/stop")
def bt_stop():
    return device_call("bt_stop")


@app.get("/api/bt/devices")
def bt_devices():
    return device_call("bt_devices")


@app.post("/api/bt/connect")
def bt_connect(name: str = Body(..., embed=True)):
    return device_call("bt_connect", name=name)


@app.post("/api/bt/forget")
def bt_forget():
    return device_call("bt_forget")


@app.post("/api/mode")
def switch_mode():
    return device_call("mode_switch")


@app.post("/api/reboot")
def reboot():
    return device_call("reboot")


@app.get("/api/sd")
def sd():
    return device_call("sd", timeout=20)


@app.exception_handler(LinkError)
def link_error(_, exc):
    return JSONResponse({"detail": str(exc)}, status_code=503)


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
