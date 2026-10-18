#pragma once

#define FW_VERSION   "1.0.0"
#define DEVICE_NAME  "JJMP3"
#define HOSTNAME     "jjmp3"

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
#define SD_SPI_HZ    8000000

// Controls
#define PIN_BUTTON   4

// Storage layout on the SD card
#define MUSIC_DIR    "/music"
#define ART_DIR      "/art"
#define INDEX_PATH   "/index.tsv"   // id \t title \t artist \t duration_s
#define QUEUE_PATH   "/queue.txt"   // one track id per line

// Audio: the desktop app converts everything to 44.1 kHz stereo CBR MP3
#define SAMPLE_RATE  44100
#define RING_FRAMES  4096           // PCM buffer, ~93 ms (power of two)

// Serial file transfer
#define XFER_CHUNK   2048
