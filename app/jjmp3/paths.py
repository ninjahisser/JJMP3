from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = APP_DIR / "static"
DATA_DIR = APP_DIR / "data"
MEDIA_DIR = DATA_DIR / "media"    # converted mp3s, as uploaded to the device
COVER_DIR = DATA_DIR / "covers"   # full-colour artwork for the app
ART_DIR = DATA_DIR / "art"        # 64x64 1-bit artwork for the OLED
TMP_DIR = DATA_DIR / "tmp"

for d in (DATA_DIR, MEDIA_DIR, COVER_DIR, ART_DIR, TMP_DIR):
    d.mkdir(parents=True, exist_ok=True)
