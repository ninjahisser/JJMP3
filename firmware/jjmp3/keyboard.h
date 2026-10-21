#pragma once
#include <Arduino.h>
#include <functional>
#include "screen.h"

// Typing with three buttons, iPod style: < > turn a wheel of characters, P types the one in
// the middle. The wheel also holds OK, delete, space and the a / A / 1 sets. Hold P to cancel.
struct KeyboardScreen : Screen {
  String prompt, value;
  std::function<void(const String &)> onDone;
  int set = 0, pos = 4;
  bool secret = false;

  static constexpr const char *SETS[4] = {"abcdefghijklmnopqrstuvwxyz", "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
                                          "0123456789.-_@!#$%&*+=?/:;,'\"()<>[]{}~^`|\\",
                                          // Latin-1 accents, so names like Zoe with an accent can be typed
                                          "àáâäãåçèéêëìíîïñòóôöõùúûüýÿÀÁÂÄÃÅÇÈÉÊËÌÍÎÏÑÒÓÔÖÕÙÚÛÜÝ"};
  static const int NSETS = 4;
  static const int SPECIALS = 4;  // OK, DEL, SPC, set switch

  void open(const String &p, const String &initial, bool hidden, std::function<void(const String &)> f) {
    prompt = p;
    value = initial;
    secret = hidden;
    onDone = f;
    set = 0;
    pos = SPECIALS;  // start on 'a'
    OS::push(this);
  }

  int wheelSize() { return SPECIALS + strlen(SETS[set]); }

  String token(int i) {
    i = (i % wheelSize() + wheelSize()) % wheelSize();
    switch (i) {
      case 0: return "OK";
      case 1: return "DEL";
      case 2: return "SPC";
      case 3: return set == 0 ? "ABC" : set == 1 ? "abc" : set == 2 ? "123" : "aé";
      default: return String(SETS[set][i - SPECIALS]);
    }
  }

  String title() override { return prompt; }

  void key(const KeyEvent &e) override {
    if (e.key == K_LEFT) pos = (pos - 1 + wheelSize()) % wheelSize();
    else if (e.key == K_RIGHT) pos = (pos + 1) % wheelSize();
    else if (e.key == K_PLAY && e.act == A_HOLD) OS::back();
    else if (e.key == K_PLAY && e.act == A_PRESS) {
      if (pos == 0) {
        OS::back();
        if (onDone) onDone(value);
      } else if (pos == 1) {
        if (value.length()) value.remove(value.length() - 1);
      } else if (pos == 2) {
        if (value.length() < 63) value += ' ';
      } else if (pos == 3) {
        set = (set + 1) % NSETS;
        pos = 3;
      } else if (value.length() < 63) {
        value += SETS[set][pos - SPECIALS];
      }
    }
  }

  void draw() override {
    // what's typed so far, its end always in view
    String shown = value;
    if (secret && value.length() > 1) {
      shown = "";
      for (unsigned i = 0; i + 1 < value.length(); i++) shown += '*';
      shown += value[value.length() - 1];
    }
    String line = shown + "_";
    if (line.length() > 20) line = line.substring(line.length() - 20);
    UI::oled.drawRect(0, 17, 128, 13, SSD1306_WHITE);
    UI::oled.setCursor(4, 20);
    UI::oled.print(line);

    // the wheel: the chosen token in a box, neighbours either side
    String mid = token(pos);
    int mw = mid.length() * 12 + 8;
    int mx = (128 - mw) / 2;
    UI::oled.fillRect(mx, 33, mw, 20, SSD1306_WHITE);
    UI::oled.setTextColor(SSD1306_BLACK);
    UI::oled.setTextSize(2);
    UI::oled.setCursor(mx + 4, 36);
    UI::oled.print(mid);
    UI::oled.setTextSize(1);
    UI::oled.setTextColor(SSD1306_WHITE);
    int xl = mx - 4, xr = mx + mw + 4;
    for (int k = 1; k <= 4; k++) {
      String l = token(pos - k), r = token(pos + k);
      xl -= l.length() * 6 + 4;
      if (xl >= 0) {
        UI::oled.setCursor(xl, 40);
        UI::oled.print(l);
      }
      if (xr + (int)r.length() * 6 <= 128) {
        UI::oled.setCursor(xr, 40);
        UI::oled.print(r);
      }
      xr += r.length() * 6 + 4;
    }
    UI::oled.setCursor(10, 56);
    UI::oled.print("P type  hold P: back");
  }
};
static KeyboardScreen keyboardScreen;