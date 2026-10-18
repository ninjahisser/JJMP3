"""JJMP3.exe - starts the app, setting it up first when needed.

First launch: finds (or installs) Python, creates the app's environment,
installs its packages, and offers to install ffmpeg / Node.js if missing.
Every launch: makes sure packages match requirements.txt, keeps yt-dlp
fresh (YouTube changes often), then opens the app window.
Built with PyInstaller into app/JJMP3.exe; see build_exe.ps1.
"""
import hashlib
import os
import queue
import shutil
import socket
import subprocess
import sys
import threading
import time
import tkinter as tk
import winreg
from pathlib import Path
from tkinter import messagebox

APP_DIR = Path(sys.executable if getattr(sys, "frozen", False) else __file__).resolve().parent
if not (APP_DIR / "run.py").exists():
    APP_DIR = APP_DIR.parent  # running from app/launcher during development
VENV = APP_DIR / ".venv"
VENV_PY = VENV / "Scripts" / "python.exe"
VENV_PYW = VENV / "Scripts" / "pythonw.exe"
REQS = APP_DIR / "requirements.txt"
MARKER = VENV / "jjmp3-requirements.sha1"
YTDLP_STAMP = VENV / "jjmp3-ytdlp-updated"
LOG = APP_DIR / "data" / "launcher.log"
PORT = 8737
NO_WINDOW = subprocess.CREATE_NO_WINDOW

PAPER, INK, MUTED, ACCENT = "#f1ede4", "#1b1a17", "#8f8a7e", "#c4472b"


def log(msg):
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')}  {msg}\n")


def refresh_path():
    """Pick up PATH changes from installers that ran after we started."""
    parts = []
    for root, key in ((winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"),
                      (winreg.HKEY_CURRENT_USER, "Environment")):
        try:
            with winreg.OpenKey(root, key) as k:
                parts.append(os.path.expandvars(winreg.QueryValueEx(k, "Path")[0]))
        except OSError:
            pass
    extra = [str(p.parent) for p in Path("G:/tools/ffmpeg").glob("*/bin/ffmpeg.exe")] if Path("G:/tools/ffmpeg").exists() else []
    links = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Links"
    os.environ["PATH"] = os.pathsep.join(parts + extra + [str(links), os.environ.get("PATH", "")])


def run(cmd, timeout=1800):
    log("$ " + " ".join(map(str, cmd)))
    p = subprocess.run(list(map(str, cmd)), capture_output=True, text=True, timeout=timeout, creationflags=NO_WINDOW)
    if p.stdout.strip():
        log(p.stdout.strip()[-3000:])
    if p.returncode:
        log(f"exit {p.returncode}: {p.stderr.strip()[-3000:]}")
    return p


def port_open():
    with socket.socket() as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", PORT)) == 0


def python_ok(exe):
    try:
        p = subprocess.run([exe, "-c", "import sys, tkinter; print(sys.version_info >= (3, 10))"],
                           capture_output=True, text=True, timeout=20, creationflags=NO_WINDOW)
        return p.returncode == 0 and p.stdout.strip() == "True"
    except (OSError, subprocess.SubprocessError):
        return False


def find_python():
    candidates = []
    for name in ("py", "python", "python3"):
        exe = shutil.which(name)
        if exe:
            candidates.append([exe, "-3"] if name == "py" else [exe])
    local = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Python"
    candidates += [[str(p)] for p in sorted(local.glob("Python3*/python.exe"), reverse=True)]
    for c in candidates:
        try:
            p = subprocess.run(c + ["-c", "import sys; print(sys.executable) if sys.version_info >= (3, 10) else None"],
                               capture_output=True, text=True, timeout=20, creationflags=NO_WINDOW)
            if p.returncode == 0 and p.stdout.strip():
                return p.stdout.strip()
        except (OSError, subprocess.SubprocessError):
            continue
    return None


def sha1(path):
    return hashlib.sha1(path.read_bytes()).hexdigest()


class Splash:
    """Small paper-coloured window that shows what the launcher is doing."""

    def __init__(self):
        self.root = tk.Tk()
        self.root.title("JJMP3")
        self.root.configure(bg=PAPER)
        self.root.overrideredirect(True)
        w, h = 380, 190
        x = (self.root.winfo_screenwidth() - w) // 2
        y = (self.root.winfo_screenheight() - h) // 3
        self.root.geometry(f"{w}x{h}+{x}+{y}")
        ico = APP_DIR / "launcher" / "jjmp3.ico"
        if ico.exists():
            try:
                self.root.iconbitmap(str(ico))
            except tk.TclError:
                pass
        frame = tk.Frame(self.root, bg=PAPER, highlightbackground="#d9d2c3", highlightthickness=1)
        frame.pack(fill="both", expand=True)
        tk.Label(frame, text="JJMP3", font=("Georgia", 30, "italic"), fg=INK, bg=PAPER).pack(anchor="w", padx=28, pady=(26, 0))
        tk.Label(frame, text="pocket player", font=("Consolas", 9), fg=MUTED, bg=PAPER).pack(anchor="w", padx=30)
        self.status = tk.Label(frame, text="Starting…", font=("Segoe UI", 10), fg=INK, bg=PAPER, anchor="w")
        self.status.pack(fill="x", padx=28, pady=(22, 6))
        self.bar = tk.Canvas(frame, height=2, bg="#d9d2c3", highlightthickness=0)
        self.bar.pack(fill="x", padx=28)
        self.pos = 0
        self.events = queue.Queue()
        self.root.after(30, self._tick)

    def _tick(self):
        w = max(1, self.bar.winfo_width())
        self.pos = (self.pos + 6) % (w + 90)
        self.bar.delete("all")
        self.bar.create_rectangle(self.pos - 90, 0, self.pos, 2, fill=INK, width=0)
        try:
            while True:
                kind, payload = self.events.get_nowait()
                if kind == "status":
                    self.status.config(text=payload)
                elif kind == "ask":
                    question, answer = payload
                    answer.put(messagebox.askyesno("JJMP3", question, parent=self.root))
                elif kind == "error":
                    messagebox.showerror("JJMP3", payload, parent=self.root)
                    self.root.destroy()
                    return
                elif kind == "done":
                    self.root.destroy()
                    return
        except queue.Empty:
            pass
        self.root.after(30, self._tick)

    def say(self, text):
        log(text)
        self.events.put(("status", text))

    def ask(self, question):
        answer = queue.Queue()
        self.events.put(("ask", (question, answer)))
        return answer.get()


def ensure_tool(ui, exe, label, winget_id, why):
    if shutil.which(exe):
        return
    if not shutil.which("winget"):
        ui.say(f"{label} not found, some features won't work")
        return
    if ui.ask(f"JJMP3 needs {label} {why}.\n\nInstall it now with winget?"):
        ui.say(f"Installing {label}…")
        run(["winget", "install", "--id", winget_id, "-e", "--silent",
             "--accept-source-agreements", "--accept-package-agreements"])
        refresh_path()


def setup(ui):
    refresh_path()

    if port_open():  # already running: run.py just opens another window
        pass
    else:
        # 1. Python environment
        if not (VENV_PYW.exists() and python_ok(str(VENV_PY))):
            ui.say("Looking for Python…")
            base = find_python()
            if not base and shutil.which("winget"):
                if not ui.ask("JJMP3 runs on Python, which isn't installed.\n\nInstall Python now with winget?"):
                    raise RuntimeError("Python is required to run JJMP3.")
                ui.say("Installing Python (this takes a minute)…")
                run(["winget", "install", "--id", "Python.Python.3.12", "-e", "--silent",
                     "--accept-source-agreements", "--accept-package-agreements"])
                refresh_path()
                base = find_python()
            if not base:
                raise RuntimeError("Couldn't find or install Python 3.10 or newer.\nInstall it from python.org, then start JJMP3 again.")
            ui.say("Preparing JJMP3 for first use…")
            if VENV.exists():
                shutil.rmtree(VENV, ignore_errors=True)
            if run([base, "-m", "venv", VENV]).returncode:
                raise RuntimeError("Couldn't create the app environment. See data\\launcher.log.")

        # 2. Packages
        if not MARKER.exists() or MARKER.read_text().strip() != sha1(REQS):
            ui.say("Installing components (first run only)…")
            run([VENV_PY, "-m", "pip", "install", "--upgrade", "pip", "-q"])
            if run([VENV_PY, "-m", "pip", "install", "-r", REQS, "-q"]).returncode:
                raise RuntimeError("Installing components failed. Check your internet connection.\nDetails: data\\launcher.log")
            MARKER.write_text(sha1(REQS))
            YTDLP_STAMP.write_text(str(time.time()))

        # 3. Tools used for importing music
        ensure_tool(ui, "ffmpeg", "ffmpeg", "Gyan.FFmpeg", "to convert music for the player")
        ensure_tool(ui, "node", "Node.js", "OpenJS.NodeJS.LTS", "to read YouTube links")

        # 4. Keep yt-dlp current, in the background, at most once a week
        stamp = float(YTDLP_STAMP.read_text()) if YTDLP_STAMP.exists() else 0
        if time.time() - stamp > 7 * 86400:
            YTDLP_STAMP.write_text(str(time.time()))
            subprocess.Popen([str(VENV_PY), "-m", "pip", "install", "-U", "-q", "yt-dlp[default]"],
                             creationflags=NO_WINDOW | subprocess.DETACHED_PROCESS)

    # 5. Start the app
    ui.say("Opening JJMP3…")
    subprocess.Popen([str(VENV_PYW), str(APP_DIR / "run.py")], cwd=str(APP_DIR), env=os.environ.copy(),
                     creationflags=subprocess.DETACHED_PROCESS)
    end = time.time() + 40
    while time.time() < end and not port_open():
        time.sleep(0.2)
    if not port_open():
        raise RuntimeError("JJMP3 didn't start. Details: data\\launcher.log")
    time.sleep(1.2)  # let the window appear before the splash goes


def main():
    ui = Splash()

    def work():
        try:
            setup(ui)
            ui.events.put(("done", None))
        except Exception as e:  # noqa: BLE001 - shown to the user
            log(f"ERROR {e!r}")
            ui.events.put(("error", str(e)))

    threading.Thread(target=work, daemon=True).start()
    ui.root.mainloop()


if __name__ == "__main__":
    main()