#pragma once

#define FW_VERSION   "1.1.0"
#define DEVICE_NAME  "Z0Ɛ"
#define HOSTNAME     "z0e"

#define SERIAL_BAUD  921600

// Two firmware images share this code (the ESP32 lacks the RAM for both radios):
//   music mode: JJ_BT=1 JJ_WIFI=0  - Bluetooth audio
//   Wi-Fi mode: JJ_BT=0 JJ_WIFI=1  - wireless sync and control, no audio
#ifndef JJ_WIFI
#define JJ_WIFI 0
#endif
#ifndef JJ_BT
#define JJ_BT (!JJ_WIFI)
#endif

// OLED (I2C)
#define PIN_SDA      21
#define PIN_SCL      22
#define OLED_ADDR    0x3C

// SD card module (SPI)
#define PIN_SD_SCK   18
#define PIN_SD_MISO  19
#define PIN_SD_MOSI  23
#define PIN_SD_CS    5
// Alternative SD pins, tried second: D16 D17 D15 are on the right header next to D5, D35 (input only) on the left
#define PIN_SD2_SCK  16
#define PIN_SD2_MISO 35
#define PIN_SD2_MOSI 17
#define PIN_SD2_CS   15
#define SD_SPI_HZ    8000000

// Buttons (to GND, internal pull-ups). Unwired pins just read as 'not pressed'.
#define PIN_BTN_LEFT   32   // <
#define PIN_BTN_PLAY   4    // P: select / play-pause, hold = back
#define PIN_BTN_RIGHT  33   // >
#define PIN_BTN_VOLUP  13   // +
#define PIN_BTN_VOLDN  14   // -

// Speaker (MAX98357 I2S amplifier): BCLK, LRC (word select), DIN. Firmware output is not written yet.
#define PIN_I2S_BCLK   26
#define PIN_I2S_LRC    25
#define PIN_I2S_DIN    27

// Battery: LiPo + -> 100k -> D34 -> 100k -> GND (ADC1 pin, works with Wi-Fi on)
#define PIN_BATTERY      34
#define BATTERY_DIVIDER  2.0f

// External speaker via I2S / pins (for extended dock with jumper speaker)
#define PIN_I2S_BCLK 26
#define PIN_I2S_LRC  25
#define PIN_I2S_DOUT 27

// Storage layout on the SD card
#define MUSIC_DIR    "/music"
#define ART_DIR      "/art"
#define INDEX_PATH   "/index.tsv"   // id \t title \t artist \t duration_s
#define QUEUE_PATH   "/queue.txt"   // one track id per line
#define PLAYLISTS_PATH "/playlists.tsv" // id \t name \t id,id,...
#define GAMES_DIR    "/games"        // CHIP-8 programs (.ch8)

// Audio: the desktop app converts everything to 44.1 kHz stereo CBR MP3
#define SAMPLE_RATE  44100
#define RING_FRAMES  2048           // PCM buffer, ~46 ms (power of two). Memory is tight with Bluetooth on; the decoder task refills it every ms.
                                    // so a full mp3.write() burst always fits (see
                                    // RING_HIGH_WATER), so the ring only has to cover jitter
                                    // between the A2DP pulls and one decode burst, not a whole
                                    // burst on top of a slack buffer. Bluetooth mode leaves only
                                    // ~30 KB of heap after the radio reserves its own, and
                                    // libhelix needs ~25 KB for the decoder, so every KB the
                                    // ring gives up buys headroom the decoder actually needs
                                    // (an 8192 ring made mp3.begin() fail with "allocation
                                    // failed" / "Out of memory").
// Feed the decoder only when at least this much room is free, so the PCM mp3.write()
// produces still fits and onPcm never has to drop. Measured: one write() emits exactly
// one MP3 frame = 1152 stereo frames, and the A2DP task drains the ring concurrently,
// so this only needs to cover that frame plus a little slack.
#define RING_HIGH_WATER  1260   // one decoded MP3 frame is 1152 stereo frames; on the 2048 ring this keeps ~18 ms or more buffered

// Serial file transfer
#define XFER_CHUNK   1024
