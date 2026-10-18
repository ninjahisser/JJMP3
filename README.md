# JJMP3

A pocket MP3 player built on an ESP32, with a desktop app that fills it with music.

- **Player (ESP32):** plays MP3s from the SD card and streams them over **Bluetooth** to headphones or a speaker. The OLED shows a now-playing screen with dithered cover art. One button: click play/pause, double-click next, hold previous.
- **Two modes:** the ESP32 doesn't have the RAM to run Bluetooth audio and Wi-Fi at the same time, so the board carries two firmwares. **Music mode** plays over Bluetooth. **Wi-Fi mode** syncs and takes control over the network. Switch from the app or triple-click the button; the player restarts in about 3 seconds. USB works in both modes.
- **App (Windows):** paste a **YouTube or Spotify** link (song, album or playlist). The app downloads it, converts it, makes the artwork and sends it to the player over USB, or over Wi-Fi once the player is on your network. It also does playlists, playback control, a live mirror of the OLED, and Wi-Fi/Bluetooth setup.

## Wiring

Everything is on the right-hand header of the ESP32 DevKit (USB port at the bottom).

| Part | Pin | ESP32 |
|---|---|---|
| OLED | SDA / SCL | D21 / D22 |
| OLED | VCC / GND | 3V3 / GND |
| SD module | CS / SCK / MOSI / MISO | D5 / D18 / D23 / D19 |
| SD module | VCC / GND | 3V3 / GND |
| Button | one leg / diagonal leg | D4 / GND |

## Run the app

Double-click **`app/JJMP3.exe`** (also in the Start menu as *JJMP3*). The first launch sets everything up: it finds or installs Python, installs the app's packages, and offers to install ffmpeg and Node.js if they're missing. That takes a few minutes once; after that it opens in seconds. Closing the window quits the app. yt-dlp is updated weekly in the background, so YouTube links keep working.

Rebuild the launcher after changing it with `app/launcher/build_exe.ps1`.

## Flash the firmware

```
powershell -ExecutionPolicy Bypass -File firmware\flash.ps1 -Port COM3
```

This builds both firmwares (`-DJJ_WIFI=0` for music mode, `-DJJ_WIFI=1` for Wi-Fi mode) and writes them to the two app slots of the `min_spiffs` partition layout. Close the app first, because it holds the USB serial port. Libraries: Adafruit SSD1306 + GFX, ArduinoJson, ESP32-A2DP, arduino-libhelix (the last two from github.com/pschatzmann).

## How it fits together

- `firmware/jjmp3/`: `player.h` (MP3 decoding into a PCM ring buffer), `bt.h` (A2DP source), `ui.h` (OLED), `net.h` (Wi-Fi + HTTP), `protocol.h` (JSON commands over USB serial and HTTP).
- SD card layout: `/music/<id>.mp3`, `/art/<id>.bin` (64x64 1-bit artwork), `/index.tsv` (id, title, artist, seconds), `/queue.txt`.
- `firmware/tests/`: the small sketches used to check the OLED, button and SD card wiring.
- `app/jjmp3/`: `device.py` (USB/Wi-Fi link), `importer.py` (yt-dlp, Spotify metadata, ffmpeg, artwork dithering), `sync.py` (keeps the card in step with the library), `server.py` (API), `static/` (UI).
- Audio is stored as 44.1 kHz stereo 128 kbps MP3, about 1 MB per minute.

Only download music you have the right to use. Downloading from YouTube is against its terms of service.
