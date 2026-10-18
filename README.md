# JJMP3

A pocket MP3 player built on an ESP32, with a desktop app that fills it with music.

- **Player (ESP32):** plays MP3s from the SD card and streams them over **Bluetooth** to headphones or a speaker. The OLED shows a now-playing screen with dithered cover art. One button: click play/pause, double-click next, hold previous.
- **Two modes:** the ESP32 doesn't have the RAM to run Bluetooth audio and Wi-Fi at the same time, so the board carries two firmwares. **Music mode** plays over Bluetooth. **Wi-Fi mode** syncs and takes control over the network. Switch from the app or triple-click the button; the player restarts in about 3 seconds. USB works in both modes.
- **App (Windows, Electron):** paste a **YouTube or Spotify** link (song, album or playlist). The app downloads it, converts it, makes the artwork and sends it to the player over USB, or over Wi-Fi once the player is on your network. It also does playlists, playback control, a live mirror of the OLED, and Wi-Fi/Bluetooth setup.

## Wiring

Everything is on the right-hand header of the ESP32 DevKit (USB port at the bottom).

| Part | Pin | ESP32 |
|---|---|---|
| OLED | SDA / SCL | D21 / D22 |
| OLED | VCC / GND | 3V3 / GND |
| SD module | CS / SCK / MOSI / MISO | D5 / D18 / D23 / D19 |
| SD module | VCC / GND | 3V3 / GND |
| Button | one leg / diagonal leg | D4 / GND |

## Install and run the app

Run **`JJMP3-Setup-1.0.0.exe`** (attached to the GitHub release). It installs per user, with Start menu and desktop shortcuts, like any other program. The app keeps its library in `%APPDATA%\JJMP3` (music, covers, settings, log).

On first use it fetches what it needs into `%APPDATA%\JJMP3\tools`: `yt-dlp.exe` always, and `ffmpeg.exe` only when ffmpeg isn't already on the PC. yt-dlp updates itself weekly, so YouTube links keep working. Nothing else is required (no Python, no Node).

### Build it

The app is Electron 44 + electron-vite + React 19 + zustand, in TypeScript (the same setup as Kobo).

```
cd app
npm install
npm run dev        # run with hot reload
npm run typecheck
npm run dist       # installer in app/release
```

On G: electron-builder can be slow; `npx electron-builder --win --config.directories.output=%TEMP%\jjmp3-release` builds on C: instead. For testing, `JJMP3_DEV=1` opens the window off-screen and serves `GET http://127.0.0.1:47920/shot?page=library` (a PNG of the window) and `POST /eval` (JavaScript in the window); `JJMP3_PROFILE=<dir>` uses a separate data folder.

## Flash the firmware

```
powershell -ExecutionPolicy Bypass -File firmware\flash.ps1 -Port COM3
```

This builds both firmwares (`-DJJ_WIFI=0` for music mode, `-DJJ_WIFI=1` for Wi-Fi mode) and writes them to the two app slots of the `min_spiffs` partition layout. Close the app first, because it holds the USB serial port. Libraries: Adafruit SSD1306 + GFX, ArduinoJson, ESP32-A2DP, arduino-libhelix (the last two from github.com/pschatzmann).

## How it fits together

- `firmware/jjmp3/`: `player.h` (MP3 decoding into a PCM ring buffer), `bt.h` (A2DP source), `ui.h` (OLED), `net.h` (Wi-Fi + HTTP), `protocol.h` (JSON commands over USB serial and HTTP).
- SD card layout: `/music/<id>.mp3`, `/art/<id>.bin` (64x64 1-bit artwork), `/index.tsv` (id, title, artist, seconds), `/queue.txt`.
- `firmware/tests/`: the small sketches used to check the OLED, button and SD card wiring.
- `app/src/main/`: `device.ts` (USB serial via serialport, or Wi-Fi HTTP), `library.ts`, `sync.ts` (keeps the card in step with the library), `importer.ts` (Spotify metadata, yt-dlp, ffmpeg), `artwork.ts` (600px covers and 64x64 dithered OLED art), `tools.ts` (finds or downloads yt-dlp and ffmpeg), `index.ts` (window, IPC, `jjmp3://cover/<id>` images).
- `app/src/renderer/`: the React UI (pages Library, Playlists, Player; the live OLED mirror is `components/Oled.tsx`). There's no local web server: the UI talks to the main process over IPC.
- Audio is stored as 44.1 kHz stereo 128 kbps MP3, about 1 MB per minute.

Only download music you have the right to use. Downloading from YouTube is against its terms of service.
