#pragma once
#include <Arduino.h>
#include <Wire.h>
#include "net.h"
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "config.h"
#include "player.h"
#include "bt.h"

// 128x64 OLED: now-playing screen with dithered cover art, idle screen, toasts
namespace UI {

static Adafruit_SSD1306 oled(128, 64, &Wire, -1);
static bool ok = false;
static String toastText;
static uint32_t toastUntil = 0;
static uint32_t lastDraw = 0;
static bool dirty = true;

static const uint8_t ICON_WIFI[] PROGMEM = {0x7C, 0x82, 0x38, 0x44, 0x10};

static void begin() {
  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(400000);
  ok = oled.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR);
  if (!ok) return;
  oled.setTextColor(SSD1306_WHITE);
  oled.setTextWrap(false);
  oled.clearDisplay();
  oled.setTextSize(2);
  oled.setCursor(34, 20);
  oled.print("JJMP3");
  oled.setTextSize(1);
  oled.setCursor(46, 42);
  oled.print("v" FW_VERSION);
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

static void iconBT(int x, int y, bool on) {
  if (!on) return;
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

// Vinyl placeholder when a track has no cover art
static void placeholderArt() {
  oled.drawCircle(31, 31, 30, SSD1306_WHITE);
  oled.drawCircle(31, 31, 22, SSD1306_WHITE);
  oled.drawCircle(31, 31, 14, SSD1306_WHITE);
  oled.fillCircle(31, 31, 4, SSD1306_WHITE);
}

static void drawStatusIcons(int x, int y) {
  iconPlayState(x, y);
  iconBT(x + 12, y, BT::connected());
  if (Net::connected()) oled.drawBitmap(x + 24, y + 1, ICON_WIFI, 8, 5, SSD1306_WHITE);
  iconVolume(x + 45, y);
}

static void drawNowPlaying() {
  const int X = 68, W = 60;
  marquee(Player::current.title, X, 2, W);
  marquee(Player::current.artist.length() ? Player::current.artist : String("Unknown"), X, 13, W);

  // Cover art drawn after the text so scrolling text never overlaps it
  oled.fillRect(0, 0, X, 64, SSD1306_BLACK);
  if (Player::hasArt) oled.drawBitmap(0, 0, Player::art, 64, 64, SSD1306_WHITE);
  else placeholderArt();

  uint32_t pos = Player::position(), dur = Player::current.dur;
  oled.drawRect(X, 30, W, 4, SSD1306_WHITE);
  if (dur) oled.fillRect(X, 30, min<uint32_t>(W, W * pos / dur), 4, SSD1306_WHITE);
  oled.setCursor(X, 38);
  oled.print(fmtTime(pos));
  String d = fmtTime(dur);
  oled.setCursor(X + W - d.length() * 6, 38);
  oled.print(d);

  drawStatusIcons(X, 55);
}

static void drawWifiMode() {
  oled.setTextSize(2);
  oled.setCursor(10, 4);
  oled.print("Wi-Fi mode");
  oled.setTextSize(1);
  oled.drawFastHLine(10, 22, 108, SSD1306_WHITE);
  String a = Net::connected() ? Net::ip() : (Net::ssid.length() ? "Joining " + Net::ssid : String("No network set"));
  oled.setCursor(max(0, (int)(128 - a.length() * 6) / 2), 30);
  oled.print(a);
  String b = String(Library::count()) + " songs";
  oled.setCursor((128 - b.length() * 6) / 2, 42);
  oled.print(b);
  oled.setCursor(4, 55);
  oled.print("Triple-click: music");
}

static void drawIdle() {
  oled.setTextSize(2);
  oled.setCursor(34, 6);
  oled.print("JJMP3");
  oled.setTextSize(1);
  oled.drawFastHLine(34, 24, 60, SSD1306_WHITE);
  uint32_t n = Library::count();
  String line = n ? String(n) + (n == 1 ? " song" : " songs") : String("No music yet");
  oled.setCursor((128 - line.length() * 6) / 2, 30);
  oled.print(line);
  String hint = n ? "Click to play" : "Add songs in the app";
  oled.setCursor((128 - hint.length() * 6) / 2, 42);
  oled.print(hint);
  drawStatusIcons(36, 55);
}

static void drawToast() {
  int w = min(124, (int)toastText.length() * 6 + 10);
  int x = (128 - w) / 2;
  oled.fillRect(x, 22, w, 20, SSD1306_BLACK);
  oled.drawRect(x, 22, w, 20, SSD1306_WHITE);
  oled.setCursor(x + 5, 28);
  oled.print(toastText);
}

// Full-screen progress, drawn immediately (used during file transfers)
static void progress(const String &label, uint32_t done, uint32_t total) {
  if (!ok) return;
  oled.clearDisplay();
  oled.setCursor(0, 8);
  oled.print(label);
  oled.drawRect(0, 28, 128, 8, SSD1306_WHITE);
  if (total) oled.fillRect(2, 30, (uint64_t)124 * done / total, 4, SSD1306_WHITE);
  String pct = String(total ? (uint64_t)100 * done / total : 0) + "%";
  oled.setCursor(0, 44);
  oled.print(pct);
  String kb = String(done / 1024) + " KB";
  oled.setCursor(128 - kb.length() * 6, 44);
  oled.print(kb);
  oled.display();
  dirty = true;
}

static void loop() {
  if (!ok) return;
  uint32_t now = millis();
  bool animating = Player::state == PLAYING || now < toastUntil ||
                   Player::current.title.length() * 6 > 60;
  uint32_t interval = animating ? 120 : 1000;
  if (!dirty && now - lastDraw < interval) return;
  lastDraw = now;
  dirty = false;

  oled.clearDisplay();
  oled.setTextSize(1);
  if (JJ_WIFI) drawWifiMode();
  else if (Player::current.id.length() && Player::state != STOPPED) drawNowPlaying();
  else drawIdle();
  if (now < toastUntil) drawToast();
  oled.display();
}

static uint8_t *buffer() { return oled.getBuffer(); }

}  // namespace UI
