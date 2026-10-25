#pragma once
#include <Arduino.h>
#include <mbedtls/base64.h>

// "Remote" mode: the desktop app tells the player what Spotify (or another PC player) is playing, and the
// player shows it. Its buttons are sent back to the app as {"ev":"key","k":"..."} lines.
namespace Remote {

static bool active = false;
static bool playing = false;
static bool hasArt = false;
static String title, artist;
static uint32_t dur = 0, posBase = 0, posAt = 0, lastUpdate = 0;
static uint8_t art[288];  // 48x48, 1 bit

static uint32_t position() {
  uint32_t p = posBase + (playing ? (millis() - posAt) / 1000 : 0);
  return dur ? min(p, dur) : p;
}

/** Tell the app a button was pressed. */
static void sendKey(const char *k) { Serial.printf("{\"ev\":\"key\",\"k\":\"%s\"}\n", k); }

/** art arrives as base64 text (384 characters for 288 bytes) */
static void setArt(const char *b64) {
  size_t out = 0;
  hasArt = b64 && mbedtls_base64_decode(art, sizeof(art), &out, (const unsigned char *)b64, strlen(b64)) == 0 && out == sizeof(art);
}

}  // namespace Remote
