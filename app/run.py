"""Start JJMP3: local server + an app-style Edge window. Closing the window quits."""
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

import uvicorn

sys.path.insert(0, str(Path(__file__).resolve().parent))
from jjmp3.paths import DATA_DIR  # noqa: E402

HOST, PORT = "127.0.0.1", 8737
URL = f"http://{HOST}:{PORT}"


def find_ffmpeg():
    if shutil.which("ffmpeg"):
        return
    for guess in Path("G:/tools/ffmpeg").glob("*/bin/ffmpeg.exe"):
        os.environ["PATH"] = str(guess.parent) + os.pathsep + os.environ["PATH"]
        return


def port_open():
    with socket.socket() as s:
        return s.connect_ex((HOST, PORT)) == 0


def edge():
    for base in (os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles"), os.environ.get("LOCALAPPDATA")):
        if base:
            p = Path(base) / "Microsoft/Edge/Application/msedge.exe"
            if p.exists():
                return str(p)
    return None


def main():
    if sys.stdout is None:  # started without a console (JJMP3.exe / pythonw)
        sys.stdout = sys.stderr = open(DATA_DIR / "app.log", "a", encoding="utf-8", buffering=1)
    find_ffmpeg()
    if port_open():  # already running: just show another window
        webbrowser.open(URL)
        return
    from jjmp3.server import app
    server = uvicorn.Server(uvicorn.Config(app, host=HOST, port=PORT, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    while not port_open():
        time.sleep(0.1)

    exe = edge()
    if "--no-window" in sys.argv or not exe:
        if not exe:
            webbrowser.open(URL)
        print(f"JJMP3 running at {URL} (Ctrl+C to quit)")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            return
    profile = DATA_DIR / "window"
    subprocess.run([exe, f"--app={URL}", f"--user-data-dir={profile}", "--no-first-run",
                    "--no-default-browser-check", "--window-size=1240,820"])
    server.should_exit = True


if __name__ == "__main__":
    main()
