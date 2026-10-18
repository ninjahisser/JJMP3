#pragma once
#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "config.h"
#include "net.h"
#include "player.h"
#include "bt.h"

// 128x64 two-colour OLED: rows 0-15 glow yellow, rows 16-63 blue.
// The yellow band is the status bar (icons, time, transfer progress); the blue area holds the content.
namespace UI {

static Adafruit_SSD1306 oled(128, 64, &Wire, -1);
static bool ok = false;
static String toastText;
static uint32_t toastUntil = 0;
static uint32_t lastDraw = 0;
static bool dirty = true;
static uint32_t rxDone = 0, rxTotal = 0, rxAt = 0;  // incoming file transfer

static const int BAND = 16;  // height of the yellow band
static const uint8_t ICON_WIFI[] PROGMEM = {0x7C, 0x82, 0x38, 0x44, 0x10};

static void centerText(const String &s, int y, int size = 1) {
  oled.setTextSize(size);
  oled.setCursor(max(0, (128 - (int)s.length() * 6 * size) / 2), y);
  oled.print(s);
  oled.setTextSize(1);
}

static void begin() {
  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(400000);
  ok = oled.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR);
  if (!ok) return;
  oled.setTextColor(SSD1306_WHITE);
  oled.setTextWrap(false);
  oled.clearDisplay();
  centerText("JJMP3", 4);
  centerText("pocket player", 30);
  centerText("v" FW_VERSION, 44);
  oled.display();
}

static void toast(const String &text, uint32_t ms = 1800) {
  toastText = text;
  toastUntil = millis() + ms;
  dirty = true;
}

static void invalidate() { dirty = true; }

static String fmtTime(uint32_t s) {
  char b[8];
  snprintf(b, sizeof(b), "%lu:%02lu", (unsigned long)(s / 60), (unsigned long)(s % 60));
  return b;
}

// Text in a horizontal window, scrolling when it doesn't fit
static void marquee(const String &text, int x, int y, int w) {
  int tw = text.length() * 6;
  int off = 0;
  if (tw > w) {
    int span = tw + 24;
    int t = (millis() / 45) % (span + 40);
    off = t < 40 ? 0 : t - 40;  // pause at the start of each loop
    oled.setCursor(x - off + span, y);
    oled.print(text);
  }
  oled.setCursor(x - off, y);
  oled.print(text);
}

static void iconBT(int x, int y) {
  oled.drawLine(x + 3, y, x + 3, y + 7, SSD1306_WHITE);
  oled.drawLine(x + 3, y, x + 5, y + 2, SSD1306_WHITE);
  oled.drawLine(x + 5, y + 2, x + 1, y + 5, SSD1306_WHITE);
  oled.drawLine(x + 3, y + 7, x + 5, y + 5, SSD1306_WHITE);
  oled.drawLine(x + 5, y + 5, x + 1, y + 2, SSD1306_WHITE);
}

static void iconPlayState(int x, int y) {
  if (Player::state == PLAYING) {
    oled.fillRect(x, y, 2, 7, SSD1306_WHITE);
    oled.fillRect(x + 4, y, 2, 7, SSD1306_WHITE);
  } else {
    oled.fillTriangle(x, y, x, y + 6, x + 5, y + 3, SSD1306_WHITE);
  }
}

static void iconVolume(int x, int y) {
  int bars = (Player::volume + 19) / 20;  // 0..5
  for (int i = 0; i < 5; i++) {
    int h = 2 + i;
    if (i < bars) oled.fillRect(x + i * 3, y + 7 - h, 2, h, SSD1306_WHITE);
    else oled.drawPixel(x + i * 3, y + 6, SSD1306_WHITE);
  }
}

static bool receiving() { return rxTotal && millis() - rxAt < 2500; }
static bool hasTrack() { return Player::current.id.length() && Player::state != STOPPED; }

// ---- yellow band ----
static void drawBand() {
  iconPlayState(1, 4);
  if (BT::connected()) iconBT(12, 4);
  if (Net::connected()) oled.drawBitmap(23, 5, ICON_WIFI, 8, 5, SSD1306_WHITE);
  iconVolume(113, 4);

  const int X = 36, W = 70;  // middle of the band
  if (receiving()) {
    // a slim loading bar, nothing more
    oled.drawRoundRect(X, 5, W, 6, 2, SSD1306_WHITE);
    int fill = (uint64_t)(W - 4) * rxDone / max<uint32_t>(1, rxTotal);
    if (fill > 0) oled.fillRect(X + 2, 7, fill, 2, SSD1306_WHITE);
  } else if (JJ_WIFI) {
    oled.setCursor(X + (W - 60) / 2, 4);
    oled.print("Wi-Fi mode");
  } else if (hasTrack()) {
    String t = fmtTime(Player::position()) + "/" + fmtTime(Player::current.dur);
    oled.setCursor(X + max(0, (W - (int)t.length() * 6) / 2), 4);
    oled.print(t);
  } else {
    oled.setCursor(X + (W - 30) / 2, 4);
    oled.print("JJMP3");
  }
}

// ---- blue area ----
static void drawArt(int x, int y) {
  if (!Player::hasArt) {
    // vinyl placeholder
    oled.drawCircle(x + 23, y + 23, 22, SSD1306_WHITE);
    oled.drawCircle(x + 23, y + 23, 15, SSD1306_WHITE);
    oled.fillCircle(x + 23, y + 23, 4, SSD1306_WHITE);
    return;
  }
  if (Player::artSize == 48) {
    oled.drawBitmap(x, y, Player::art, 48, 48, SSD1306_WHITE);
    return;
  }
  // older 64x64 artwork: sample it down to 48x48
  for (int j = 0; j < 48; j++)
    for (int i = 0; i < 48; i++) {
      int sx = i * 4 / 3, sy = j * 4 / 3;
      if (Player::art[sy * 8 + (sx >> 3)] & (0x80 >> (sx & 7))) oled.drawPixel(x + i, y + j, SSD1306_WHITE);
    }
}

static void drawNowPlaying() {
  const int X = 52, W = 76;
  marquee(Player::current.title, X, 19, W);
  marquee(Player::current.artist.length() ? Player::current.artist : String("Unknown"), X, 31, W);

  // art goes on after the text, so scrolling text never runs over it
  oled.fillRect(0, BAND, X - 1, 64 - BAND, SSD1306_BLACK);
  drawArt(0, BAND);

  uint32_t pos = Player::position(), dur = Player::current.dur;
  oled.drawRect(X, 45, W, 4, SSD1306_WHITE);
  if (dur) oled.fillRect(X, 45, min<uint32_t>(W, W * pos / dur), 4, SSD1306_WHITE);
  if (Player::queue.size() > 1) {
    oled.setCursor(X, 54);
    oled.print(String(Player::qpos + 1) + " of " + String(Player::queue.size()));
  }
}

static void drawIdle() {
  uint32_t n = Library::count();
  centerText(n ? "Ready" : "Empty", 22, 2);
  centerText(n ? String(n) + (n == 1 ? " song" : " songs") : String("Add songs in the app"), 43);
  if (n) centerText("Click to play", 54);
}

static void drawWifiMode() {
  String state = Net::stateName();
  String a = Net::connected() ? Net::ip()
           : !Net::ssid.length() ? String("No network set")
           : state == "failed" ? "Can't join " + Net::ssid
           : "Joining " + Net::ssid;
  centerText(a, 22);
  centerText(String(Library::count()) + " songs", 35);
  centerText("Triple-click: music", 54);
}

static void drawToast() {
  int w = min(124, (int)toastText.length() * 6 + 10);
  int x = (128 - w) / 2;
  oled.fillRect(x, 26, w, 20, SSD1306_BLACK);
  oled.drawRect(x, 26, w, 20, SSD1306_WHITE);
  oled.setCursor(x + 5, 32);
  oled.print(toastText);
}

static void draw() {
  oled.clearDisplay();
  oled.setTextSize(1);
  drawBand();
  if (JJ_WIFI) drawWifiMode();
  else if (hasTrack()) drawNowPlaying();
  else drawIdle();
  if (millis() < toastUntil) drawToast();
  oled.display();
}

// Called during file transfers: keeps the normal screen, with a loading bar in the yellow band
static void progress(const String &, uint32_t done, uint32_t total) {
  if (!ok) return;
  rxDone = done;
  rxTotal = total;
  rxAt = millis();
  draw();
  lastDraw = millis();
}

static void doneReceiving() {
  rxTotal = 0;
  dirty = true;
}

static void loop() {
  if (!ok) return;
  uint32_t now = millis();
  bool animating = Player::state == PLAYING || now < toastUntil || receiving() ||
                   Player::current.title.length() * 6 > 76;
  if (!dirty && now - lastDraw < (animating ? 120u : 1000u)) return;
  lastDraw = now;
  dirty = false;
  draw();
}

static uint8_t *buffer() { return oled.getBuffer(); }

}  // namespace UI