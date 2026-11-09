# JJMP3

A pocket MP3 player built on an ESP32, with a desktop app that fills it with music.

- **Player (ESP32):** plays MP3s from the SD card and streams them over **Bluetooth** to headphones or a speaker. The OLED is a two-colour panel: the yellow top band (rows 0-15) is a status bar with the play state, time, Bluetooth/Wi-Fi/volume, and a slim bar while a song is being received; the blue area shows 48x48 dithered cover art, title, artist and progress. Five buttons (< P > and volume) drive a small menu OS; see below.
- **Two modes:** the ESP32 doesn't have the RAM to run Bluetooth audio and Wi-Fi at the same time, so the board carries two firmwares. **Music mode** plays over Bluetooth. **Wi-Fi mode** syncs and takes control over the network. Switch from the app or triple-click the button; the player restarts in about 3 seconds. USB works in both modes.
- **App (Windows, Electron):** paste a **YouTube or Spotify** link (song, album or playlist). The app downloads it, converts it, makes the artwork and sends it to the player over USB, or over Wi-Fi once the player is on your network. It also does playlists, playback control, a live mirror of the OLED, and Wi-Fi/Bluetooth setup. **Add songs** asks for a link and shows a preview (cover, title, artist, or the full track list) before anything downloads. The **JJMP3 | Computer** switch in the player bar moves playback between the player and this computer's speakers, at the same song and second.


## The player's OS

The player has an iPod-style menu on the OLED: **Now playing, Music, Playlists, Games, Settings** (Bluetooth, Wi-Fi, Mode, About).

| Button | Pin | In menus | Now playing |
|---|---|---|---|
| < | D32 | up | previous (hold: rewind) |
| P | D4 | open / select (hold: back) | play / pause (hold: back) |
| > | D13 | down | next (hold: fast forward) |
| + / - | D14 / D33 | volume | volume |

All buttons go to GND (internal pull-ups); unwired ones are ignored, so they can be added one at a time. Until they are, the app's Player sidebar has the same five buttons under the screen mirror.

- **Settings, Bluetooth:** pair headphones on the device itself (Find headphones, pick from the list).
- **Settings, Wi-Fi:** in Wi-Fi mode, pick a scanned network; in either mode, *Type a name*. Text is entered with a character wheel: < > turn it, P types the middle character, and the wheel holds OK, DEL, SPC and the a / A / 1 sets. Hold P to cancel.
- **Playlists:** made in the app and synced to `/playlists.tsv` on the card.
- **Games:** Pibble Catch (catch the falling mulch with < >; three misses and it's over) and Snake are built in; CHIP-8 programs (`.ch8`) in `/games` on the card appear too (add them from the app's Player page). CHIP-8's 64x32 screen is doubled to fill the OLED; keys: < 4, > 6, P 5, + 2, - 8, hold P to quit. Music keeps playing while you play.

## Battery (optional)

A single-cell 3.7 V LiPo, measured through a 2:1 divider made of two 100 kOhm resistors:

```
LiPo +  --- 100k ---+--- 100k --- GND
                    |
                   D34   (optional: 100 nF from D34 to GND steadies the reading)
```

- Battery GND and ESP32 GND must be connected.
- The player shows a battery icon in the yellow band (it blinks below 10 %), "Battery low" at 5 %, and sleeps when the cell is empty (below 3.3 V for 20 s). Press P to wake it. The level is also in Settings, About, and in the app's sidebar.
- With nothing on D34 the indicator stays hidden.
- To run from the battery, charge and protect it with a TP4056 module (the kind with a DW01 protection chip). Feed the ESP32's 3V3 pin through a low-dropout 3.3 V regulator (MCP1700-3302, HT7333 or similar): VIN goes through the board's AMS1117, which needs about 4.3 V and so cuts out early on a LiPo.

## Wiring

Everything is on the right-hand header of the ESP32 DevKit (USB port at the bottom).

| Part | Pin | ESP32 |
|---|---|---|
| OLED | SDA / SCL | D21 / D22 |
| OLED | VCC / GND | 3V3 / GND |
| SD module | CS / SCK / MOSI / MISO | D5 / D18 / D23 / D19 |
| SD module | VCC / GND | 3V3 / GND |
| Buttons | P / < / > / + / - to GND | D4 / D32 / D13 / D14 / D33 |
| Battery sense (optional) | divider midpoint | D34 |

## Download

Nothing needs compiling. Get **`Z0E-Setup-<version>.exe`** from the [latest release](https://github.com/ninjahisser/JJMP3/releases/latest) and run it. The app carries the player firmware too:

1. Wire up an ESP32 DevKit (see Wiring) and plug it into the PC by USB.
2. In the app, open **Player** and click **Install firmware**. It takes about 40 seconds. If the board doesn't answer, hold its **BOOT** button while the install starts.
3. Later updates go the same way, or over Wi-Fi (**Update over Wi-Fi**) once the player is on your network. Songs, settings, Wi-Fi and paired headphones survive an update.

No Windows PC? The release also has **`Z0E-firmware-<version>.bin`**, a single image for a browser flasher: open [espressif.github.io/esptool-js](https://espressif.github.io/esptool-js/) in Chrome or Edge, connect, and program the file at address **0x0**.

## Install and run the app

Run **`Z0E-Setup-<version>.exe`** (attached to the GitHub release). It installs per user, with Start menu and desktop shortcuts, like any other program. The app keeps its library in `%APPDATA%\JJMP3` (music, covers, settings, log).

On first use it fetches what it needs into `%APPDATA%\JJMP3\tools`: `yt-dlp.exe` always, and `ffmpeg.exe` only when ffmpeg isn't already on the PC. yt-dlp updates itself weekly, so YouTube links keep working. Nothing else is required (no Python, no Node).

Or run it straight from the project folder: **`bin\Z0E.exe`** (right-click it to pin to Start or the taskbar). `npm run local` in `app` rebuilds that copy after code changes. Both share the same library in `%APPDATA%\JJMP3`, and only one runs at a time.

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

### Make a release

```
powershell -ExecutionPolicy Bypass -File firmware\release.ps1
cd app
npx electron-builder --win --config.directories.output=%TEMP%\z0e-release
```

`release.ps1` builds both firmwares and packs them, with `esptool.exe` (GPL-2.0, license alongside), into `app\firmware`, which the installer ships in its resources. It also writes `firmware\build\release\Z0E-firmware-<version>.bin` for browser flashers. Attach the installer and that `.bin` to the GitHub release.

## How it fits together

- `firmware/jjmp3/`: `player.h` (MP3 decoding into a PCM ring buffer), `bt.h` (A2DP source), `ui.h` (OLED), `net.h` (Wi-Fi + HTTP), `protocol.h` (JSON commands over USB serial and HTTP).
- SD card layout: `/music/<id>.mp3`, `/art/<id>.bin` (64x64 1-bit artwork), `/index.tsv` (id, title, artist, seconds), `/queue.txt`.
- `firmware/tests/`: the small sketches used to check the OLED, button and SD card wiring.
- `app/src/main/`: `device.ts` (USB serial via serialport, or Wi-Fi HTTP), `library.ts`, `sync.ts` (keeps the card in step with the library), `importer.ts` (Spotify metadata, yt-dlp, ffmpeg), `artwork.ts` (600px covers and 64x64 dithered OLED art), `tools.ts` (finds or downloads yt-dlp and ffmpeg), `index.ts` (window, IPC, `jjmp3://cover/<id>` images).
- `app/src/renderer/`: the React UI (pages Library, Playlists, Player; the live OLED mirror is `components/Oled.tsx`). There's no local web server: the UI talks to the main process over IPC.
- Audio is stored as 44.1 kHz stereo 128 kbps MP3, about 1 MB per minute.
- All heavy work happens on the computer (link lookup, download, conversion, artwork dithering, ASCII titles, durations); the player only decodes and plays.
- If `library.json` ever loses songs whose files are still in `%APPDATA%\JJMP3\media`, the app restores them on start, named from the player's index; pasting the link again restores full details without downloading again.

Only download music you have the right to use. Downloading from YouTube is against its terms of service.
