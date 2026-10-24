#pragma once
#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "config.h"
#include "net.h"
#include "player.h"
#include "bt.h"
#include "battery.h"
#include "profile.h"

// Drawing on the 128x64 two-colour OLED: rows 0-15 glow yellow (the status band),
// rows 16-63 blue (the screen's content). What to show is decided by os.h.
namespace UI {

static Adafruit_SSD1306 oled(128, 64, &Wire, -1);
static bool ok = false;
static String toastText;
static uint32_t toastUntil = 0;
static uint32_t lastDraw = 0;
static bool dirty = true;
static uint32_t rxDone = 0, rxTotal = 0, rxAt = 0;  // incoming file transfer
static void (*redrawHook)() = nullptr;           // set by the OS: draws the current screen now

static const int BAND = 16;  // height of the yellow band
static const int ROW_H = 12; // list rows in the blue area: 4 visible
static const uint8_t ICON_WIFI[] PROGMEM = {0x7C, 0x82, 0x38, 0x44, 0x10};

static void drawSplash();

/** "Z0Ɛ": the OLED font has no Ɛ, so the last letter is drawn as a mirrored E. */
static void drawBrand(int cx, int y) {
  static const uint8_t REV_E[] PROGMEM = {0xF8, 0x08, 0x08, 0x78, 0x08, 0x08, 0xF8};
  int x = cx - 9;
  oled.setCursor(x, y);
  oled.print("Z0");
  oled.drawBitmap(x + 14, y, REV_E, 5, 7, SSD1306_WHITE);
}

static void centerText(const String &s, int y, int size = 1) {
  oled.setTextSize(size);
  oled.setCursor(max(0, (128 - (int)s.length() * 6 * size) / 2), y);
  oled.print(s);
  oled.setTextSize(1);
}

static void begin() {
  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(800000);  // SSD1306 copes; halves the time a full frame takes
  ok = oled.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR);
  if (!ok) return;
  oled.setTextColor(SSD1306_WHITE);
  oled.setTextWrap(false);
  oled.clearDisplay();
  // Draw the boot screen (I <3 U + name) here, not a placeholder frame: the OS
  // redraws the same splash right after, and two different frames in a row
  // looked like a jarring popup flashing at power-on.
  drawSplash();
  oled.display();
}

static void heart(int x, int y, int r = 3) {
  oled.fillCircle(x + r, y + r, r, SSD1306_WHITE);
  oled.fillCircle(x + 3 * r, y + r, r, SSD1306_WHITE);
  oled.fillTriangle(x, y + r + 1, x + 4 * r, y + r + 1, x + 2 * r, y + 4 * r, SSD1306_WHITE);
}

/** "I <heart> U" across the yellow band, the owner's name in the blue area. */
static void drawSplash() {
  oled.setTextSize(2);
  oled.setCursor(40, 1);
  oled.print("I");
  heart(56, 2, 3);
  oled.setCursor(76, 1);
  oled.print("U");
  String name = Profile::user;
  if (name.length() && name.length() <= 10) centerText(name, 28, 2);
  else if (name.length()) centerText(name, 32);
  else centerText("set your name", 32);
  oled.setTextSize(1);
  drawBrand(64, 54);
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

/** Text in a window [x, x+w), scrolling when it doesn't fit. Callers clear what's left of x afterwards. */
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

// 12x7 battery: outline, nub, fill by level; blinks when nearly empty
static void iconBattery(int x, int y) {
  if (!Battery::present) return;
  oled.drawRect(x, y, 11, 7, SSD1306_WHITE);
  oled.fillRect(x + 11, y + 2, 1, 3, SSD1306_WHITE);
  int fill = (Battery::percent * 9 + 50) / 100;
  if (Battery::percent <= 10 && (millis() / 500) % 2) fill = 0;
  if (fill > 0) oled.fillRect(x + 1, y + 1, fill, 5, SSD1306_WHITE);
  // show percentage when BT connected/playing for quick view
  if (BT::connected()) {
    char p[4]; sprintf(p, "%d", Battery::percent);
    oled.setCursor(x - 18, y + 1);
    oled.print(p);
  }
}

/** Yellow band: status icons, and in the middle the title (or a transfer bar while receiving). */
static void drawBand(const String &center) {
  iconPlayState(1, 4);
  if (BT::connected()) iconBT(12, 4);
  if (Net::connected()) oled.drawBitmap(23, 5, ICON_WIFI, 8, 5, SSD1306_WHITE);
  iconVolume(113, 4);
  iconBattery(99, 4);
  const int X = 34, W = Battery::present ? 62 : 72;
  if (receiving()) {
    oled.drawRoundRect(X, 5, W, 6, 2, SSD1306_WHITE);
    int fill = (uint64_t)(W - 4) * rxDone / max<uint32_t>(1, rxTotal);
    if (fill > 0) oled.fillRect(X + 2, 7, fill, 2, SSD1306_WHITE);
    return;
  }
  unsigned maxChars = W / 6;
  String t = center.length() > maxChars ? center.substring(0, maxChars - 1) + "." : center;
  oled.setCursor(X + max(0, (W - (int)t.length() * 6) / 2), 4);
  oled.print(t);
}

/** One list row in the blue area; the selected row is drawn inverted. */
static void drawRow(int row, const String &label, const String &detail, bool selected, bool scrollbar) {
  int y = BAND + row * ROW_H;
  int w = scrollbar ? 124 : 128;
  int dw = detail.length() * 6;
  if (selected) oled.fillRect(0, y, w, ROW_H, SSD1306_WHITE);
  oled.setTextColor(selected ? SSD1306_BLACK : SSD1306_WHITE);
  int labelW = w - 6 - (dw ? dw + 6 : 0);
  if (selected && (int)label.length() * 6 > labelW) {
    marquee(label, 3, y + 2, labelW);
    // tidy the overflow on both sides of the window
    oled.fillRect(0, y, 3, ROW_H, SSD1306_WHITE);
    oled.fillRect(3 + labelW, y, w - 3 - labelW, ROW_H, SSD1306_WHITE);
  } else {
    String l = (int)label.length() * 6 > labelW ? label.substring(0, max(0, labelW / 6 - 1)) + "." : label;
    oled.setCursor(3, y + 2);
    oled.print(l);
  }
  if (dw) {
    oled.setCursor(w - 3 - dw, y + 2);
    oled.print(detail);
  }
  oled.setTextColor(SSD1306_WHITE);
}

static void drawScrollbar(int top, int visible, int count) {
  if (count <= visible) return;
  int h = 64 - BAND;
  int bar = max(4, h * visible / count);
  int y = BAND + (h - bar) * top / max(1, count - visible);
  oled.drawFastVLine(126, BAND, h, SSD1306_WHITE);
  oled.fillRect(125, y, 3, bar, SSD1306_WHITE);
}

static void drawArt(int x, int y) {
  if (!Player::hasArt) {
    oled.drawCircle(x + 23, y + 23, 22, SSD1306_WHITE);
    oled.drawCircle(x + 23, y + 23, 15, SSD1306_WHITE);
    oled.fillCircle(x + 23, y + 23, 4, SSD1306_WHITE);
    return;
  }
  if (Player::artSize == 48) {
    oled.drawBitmap(x, y, Player::art, 48, 48, SSD1306_WHITE);
    return;
  }
  for (int j = 0; j < 48; j++)  // older 64x64 artwork: sample down to 48x48
    for (int i = 0; i < 48; i++) {
      int sx = i * 4 / 3, sy = j * 4 / 3;
      if (Player::art[sy * 8 + (sx >> 3)] & (0x80 >> (sx & 7))) oled.drawPixel(x + i, y + j, SSD1306_WHITE);
    }
}

static void drawNowPlaying() {
  const int X = 52, W = 76;
  if (!Player::current.id.length()) {
    centerText("Nothing playing", 26);
    centerText("Pick a song in Music", 42);
    return;
  }
  marquee(Player::current.title, X, 19, W);
  marquee(Player::current.artist.length() ? Player::current.artist : String("Unknown"), X, 31, W);
  oled.fillRect(0, BAND, X - 1, 64 - BAND, SSD1306_BLACK);  // art over any scrolled text
  drawArt(0, BAND);
  uint32_t pos = Player::position(), dur = Player::current.dur;
  oled.drawRect(X, 45, W, 4, SSD1306_WHITE);
  if (dur) oled.fillRect(X, 45, min<uint32_t>(W, W * pos / dur), 4, SSD1306_WHITE);
  if (Player::queue.size() > 1) {
    oled.setCursor(X, 54);
    oled.print(String(Player::qpos + 1) + " of " + String(Player::queue.size()));
  }
  if (Battery::present) {  // battery level, bottom right
    String b = String(Battery::percent) + "%";
    oled.setCursor(128 - b.length() * 6, 54);
    oled.print(b);
  }
}

static void drawToast() {
  int w = min(124, (int)toastText.length() * 6 + 10);
  int x = (128 - w) / 2;
  oled.fillRect(x, 26, w, 20, SSD1306_BLACK);
  oled.drawRect(x, 26, w, 20, SSD1306_WHITE);
  oled.setCursor(x + 5, 32);
  oled.print(toastText);
}

// During file transfers: the normal screen, with a loading bar in the yellow band
static void progress(const String &, uint32_t done, uint32_t total) {
  if (!ok) return;
  rxDone = done;
  rxTotal = total;
  rxAt = millis();
  if (redrawHook) redrawHook();
  lastDraw = millis();
}

static void doneReceiving() {
  rxTotal = 0;
  dirty = true;
}

static uint8_t *buffer() { return oled.getBuffer(); }

}  // namespace UI